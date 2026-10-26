//! Tauri shell that boots the bundled dsh Web host and shows it in a native window.
//!
//! The host is a Node sidecar launched without a child-process IPC channel, so it reports
//! readiness and accepts commands as newline-delimited JSON on stdout and stdin. This shell
//! keeps its loader page visible until the host's HTTP server answers, then navigates the
//! window to the authenticated engine URL and hands the Web client the engine's stream
//! origin. The served document already carries its injection table, so the carrier never
//! replays it. A host that dies before answering leaves the loader visible and reports the
//! cause instead of an empty window.
//!
//! The loader document is served from a loopback address rather than the `tauri` scheme,
//! because the engine authenticates its browser session with a `SameSite=Strict` cookie that
//! a cross-site navigation cannot carry. Both documents then share one site, so the engine's
//! own authentication redirect keeps the cookie it just issued.
//!
//! The Web client awaits a readiness gate that only the desktop carrier can settle, so every
//! document in this window receives an initialization script that installs the
//! `dshDesktopBoot` bridge and the gate itself.
//!
//! The same bridge reports a session the engine no longer accepts, so the shell navigates the
//! window back to the engine and mints a fresh one from the launch token only it holds.
//!
//! Once the first engine is up, a watchdog supervises the engine for the rest of the session.
//! It watches the host process, probes the engine's request loop, and replaces the host when
//! either stops answering, so a machine that was suspended or had its lid closed never leaves
//! the window on a document that can no longer talk to anything.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::SocketAddr;
use std::net::TcpListener;
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::path::BaseDirectory;
use tauri::webview::PageLoadEvent;
use tauri::webview::PageLoadPayload;
use tauri::{
    AppHandle, Emitter, Event, Listener, Manager, PhysicalPosition, PhysicalSize, RunEvent,
    Webview, WebviewBuilder, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use url::Url;

/// Grace period for the host to exit after a shutdown request before it is killed.
const HOST_GRACE_MS: u64 = 10_000;
/// How long a booting host may take to report readiness before it counts as failed.
const HOST_BOOT_TIMEOUT_MS: u64 = 180_000;
/// How long the engine URL may refuse connections once the host reported readiness.
const ENGINE_PROBE_TIMEOUT_MS: u64 = 90_000;
/// Delay between connection attempts on the engine URL.
const ENGINE_PROBE_INTERVAL_MS: u64 = 150;
/// How often the watchdog re-reads host liveness and probes the engine.
const WATCHDOG_INTERVAL_MS: u64 = 5_000;
/// How long one engine health probe may spend connecting and reading.
const ENGINE_HEALTH_TIMEOUT_MS: u64 = 3_000;
/// Margin that separates a normal slow cycle from a suspended machine, added to the
/// watchdog interval for a cycle that ran long and to the monotonic gap of the clocks.
const WAKE_GAP_MS: u64 = 20_000;
/// How many probe cycles a waking engine gets to answer before the host is replaced.
const MAX_WAKE_PROBES: u32 = 3;
/// Restarts the watchdog allows before it concedes and surfaces the failure.
const MAX_HOST_RESTARTS: u32 = 4;
/// Window event through which the Web client reports a failed boot to the shell.
const BOOT_FAILED_EVENT: &str = "alpha-boot-failed";
/// Window event the engine's denial page reports a lost session through.
const UNAUTHORIZED_EVENT: &str = "alpha-unauthorized";
/// Window event the loader page observes for startup failures.
const FATAL_EVENT: &str = "alpha-fatal";
/// Event through which a component-picker result reaches the Web client.
const COMPONENT_PICKER_EVENT: &str = "alpha-component-picker";
/// Label prefix of the temporary component-picker child webview.
const COMPONENT_PICKER_LABEL: &str = "component-picker";
/// Navigations intercepted from the component-picker child webview.
const COMPONENT_PICKER_ORIGIN: &str = "https://component-picker.alpha.invalid";
/// Result fields carried in a component-picker navigation.
const COMPONENT_PICKER_INPUT: &str = "input";
/// Maximum encoded result accepted from the child webview.
const COMPONENT_PICKER_RESULT_LIMIT: usize = 512 * 1024;
/// Event through which a native Browser document reports a load or a popup.
const BROWSER_DOCUMENT_EVENT: &str = "alpha-browser-document";
/// Label prefix of the persistent Browser document child webview.
const BROWSER_DOCUMENT_LABEL: &str = "browser-document";

/// Picker script installed in whichever webview carries the picked page.
///
/// The script installs once per document and re-arms on every later evaluation,
/// so a picker can start again without reloading the page it picks from.
const COMPONENT_PICKER_SCRIPT: &str = r#"
(() => {
  if (window.self !== window.top) return;
  const existing = globalThis.__ALPHA_COMPONENT_PICKER__;
  if (existing !== undefined) { existing.start(); return; }

  const outline = document.createElement("div");
  outline.setAttribute("data-alpha-component-picker-outline", "");
  Object.assign(outline.style, {
    position: "fixed",
    zIndex: "2147483647",
    pointerEvents: "none",
    display: "none",
    border: "2px solid #3b82f6",
    background: "rgba(59, 130, 246, 0.12)",
    boxSizing: "border-box",
  });
  let previousCursor = "";
  const mount = () => {
    if (document.documentElement === null) return;
    previousCursor = document.documentElement.style.cursor;
    document.documentElement.style.cursor = "crosshair";
    document.documentElement.append(outline);
  };
  const text = (value, limit) => String(value ?? "").slice(0, limit);
  const xpath = (node) => {
    const parts = [];
    for (let current = node; current instanceof Element; current = current.parentElement) {
      const index = current.parentElement
        ? [...current.parentElement.children].filter(child => child.tagName === current.tagName).indexOf(current) + 1
        : 1;
      parts.unshift(`${current.tagName.toLowerCase()}[${String(index)}]`);
    }
    return `/${parts.join("/")}`;
  };
  const cssPath = (node) => {
    const parts = [];
    for (let current = node; current instanceof Element; current = current.parentElement) {
      const id = current.id ? `#${CSS.escape(current.id)}` : "";
      const classes = [...current.classList].slice(0, 2).map(value => `.${CSS.escape(value)}`).join("");
      const sameTag = current.parentElement
        ? [...current.parentElement.children].filter(child => child.tagName === current.tagName)
        : [];
      const position = sameTag.length > 1
        ? `:nth-of-type(${String(sameTag.indexOf(current) + 1)})`
        : "";
      parts.unshift(`${current.tagName.toLowerCase()}${id}${classes}${position}`);
    }
    return parts.join(" > ");
  };
  const parentChain = (node) => {
    const chain = [];
    for (let current = node.parentElement, depth = 1; current !== null; current = current.parentElement, depth += 1) {
      chain.push(`${depth}: ${current.tagName.toLowerCase()}${current.id ? `#${current.id}` : ""}`);
      if (chain.length === 12) break;
    }
    return chain;
  };
  const encode = (value) => {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  const describe = (node) => {
    const rect = node.getBoundingClientRect();
    const styles = getComputedStyle(node);
    const attributes = Object.fromEntries([...node.attributes].map(attribute => [attribute.name, attribute.value]));
    const siblingIndex = node.parentElement
      ? [...node.parentElement.children].indexOf(node) + 1
      : 1;
    const selectedStyles = {};
    for (const key of [
      "display", "position", "width", "height", "margin", "padding", "color", "background-color",
      "font-family", "font-size", "font-weight", "line-height", "border", "border-radius", "opacity",
      "overflow", "z-index",
    ]) selectedStyles[key] = styles.getPropertyValue(key);
    const lines = [
      "Alpha Component Selection",
      `URL: ${location.href}`,
      `Title: ${document.title}`,
      `Tag: ${node.tagName.toLowerCase()}`,
      `XPath: ${xpath(node)}`,
      `CSS Selector: ${cssPath(node)}`,
      `DOM Depth: ${parentChain(node).length}`,
      `Sibling Index: ${String(siblingIndex)}`,
      "Parent Chain:",
      ...parentChain(node).map(value => `  ${value}`),
      `Bounding Rectangle: x=${String(rect.x)}, y=${String(rect.y)}, width=${String(rect.width)}, height=${String(rect.height)}`,
      "Attributes:",
      ...Object.entries(attributes).map(([key, value]) => `  ${key}=${text(value, 500)}`),
      "Computed Styles:",
      ...Object.entries(selectedStyles).map(([key, value]) => `  ${key}: ${String(value)}`),
      `Visible Text: ${text(node.innerText, 4000)}`,
      "Outer HTML:",
      text(node.outerHTML, 12000),
    ];
    return lines.join("\n");
  };
  const targetFrom = (event) => {
    const node = document.elementFromPoint(event.clientX, event.clientY);
    return node instanceof Element ? node : undefined;
  };
  const draw = (node) => {
    if (node === undefined) {
      outline.style.display = "none";
      return;
    }
    const rect = node.getBoundingClientRect();
    outline.style.display = "block";
    outline.style.left = `${String(rect.left)}px`;
    outline.style.top = `${String(rect.top)}px`;
    outline.style.width = `${String(rect.width)}px`;
    outline.style.height = `${String(rect.height)}px`;
  };
  const teardown = () => {
    running = false;
    outline.remove();
    if (document.documentElement !== null) document.documentElement.style.cursor = previousCursor;
    removeEventListener("DOMContentLoaded", mount);
    removeEventListener("mousemove", onMove, true);
    removeEventListener("click", onClick, true);
    removeEventListener("contextmenu", onContextMenu, true);
    removeEventListener("keydown", onKeyDown, true);
    removeEventListener("mousedown", swallow, true);
    removeEventListener("pointerdown", swallow, true);
    removeEventListener("dragstart", swallow, true);
  };
  const finish = (url) => {
    teardown();
    location.href = url;
  };
  const cancel = () => {
    finish("https://component-picker.alpha.invalid/cancel");
  };
  function onMove(event) {
    draw(targetFrom(event));
  }
  function onClick(event) {
    const node = targetFrom(event);
    event.preventDefault();
    event.stopImmediatePropagation();
    if (node === undefined) return;
    finish(`https://component-picker.alpha.invalid/selection?input=${encode(describe(node))}`);
  }
  function onContextMenu(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    cancel();
  }
  function onKeyDown(event) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    cancel();
  }
  function swallow(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  let running = false;
  // The overlay stays out of hit testing, so the page keeps its own hover state
  // while these capture listeners run before any page listener.
  const start = () => {
    if (running) return;
    running = true;
    addEventListener("mousemove", onMove, true);
    addEventListener("click", onClick, true);
    addEventListener("contextmenu", onContextMenu, true);
    addEventListener("keydown", onKeyDown, true);
    addEventListener("mousedown", swallow, true);
    addEventListener("pointerdown", swallow, true);
    addEventListener("dragstart", swallow, true);
    if (document.documentElement === null) addEventListener("DOMContentLoaded", mount, { once: true });
    else mount();
  };
  const stop = () => {
    if (!running) return;
    running = false;
    teardown();
  };
  globalThis.__ALPHA_COMPONENT_PICKER__ = { start, stop };
  start();
})();
"#;

/// Call that withdraws a picker running inside a live Browser document.
const COMPONENT_PICKER_STOP_CALL: &str = "globalThis.__ALPHA_COMPONENT_PICKER__?.stop()";

/// Status code the engine answers for a request that carries no session cookie.
const ENGINE_UNAUTHORIZED: u16 = 401;
/// Bound on the request head the loader reads before it answers anyway.
const LOADER_HEAD_LIMIT: usize = 8 * 1024;
/// How long the loader waits for a request line before it drops the connection.
const LOADER_READ_TIMEOUT_MS: u64 = 500;

/// Bridge installed in every document of the shell window before its own scripts run.
///
/// The shell resolves the readiness promise once it holds the engine payload, either by
/// carrying the payload into the document before navigation or by resolving the deferred
/// after the document loaded. The client reports its own failures back through a window
/// event so the shell can present them outside the Web page, and reports a session the
/// engine denies so the shell can navigate the window back to the engine.
const BOOT_BRIDGE: &str = r#"(() => {
  const resolved = Promise.withResolvers();
  const global = globalThis;
  if (global.self === global.top) {
    const editableTarget = (event) => {
      const path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];
      return path.some((node) =>
        node instanceof global.HTMLInputElement
        || node instanceof global.HTMLTextAreaElement
        || (node instanceof global.HTMLElement && node.isContentEditable)
      );
    };
    global.addEventListener("keydown", (event) => {
      // The window history contains the loader document; a Backspace default
      // action outside an editable target would replay boot.
      if (event.key === "Backspace" && !editableTarget(event)) event.preventDefault();
    }, true);
  }
  global.__DSH_ALPHA_READY__ = resolved;
  global.__DSH_BOOT_READY__ = global.__DSH_BOOT_READY__ ?? Promise.withResolvers();
  const carried = global.__DSH_ALPHA_PAYLOAD__;
  if (carried !== undefined) resolved.resolve(carried);
  global.dshDesktopBoot = {
    ready: () => resolved.promise,
    failed: (message) => {
      console.error("alpha web client:", message);
      const api = global.__TAURI__;
      if (api !== undefined && api.event !== undefined && typeof api.event.emit === "function") {
        void Promise.resolve(api.event.emit("alpha-boot-failed", { message: String(message) }))
          .catch(() => {});
      }
    },
    unauthorized: (href) => {
      const api = global.__TAURI__;
      if (api !== undefined && api.event !== undefined && typeof api.event.emit === "function") {
        void Promise.resolve(api.event.emit("alpha-unauthorized", { href: String(href) }))
          .catch(() => {});
      }
    },
    saveMarkdown: (filename, content) => {
      const api = global.__TAURI__;
      if (api === undefined || api.core === undefined || typeof api.core.invoke !== "function") {
        return Promise.reject(new Error("native save unavailable"));
      }
      return Promise.resolve(
        api.core.invoke("save_markdown", { filename: String(filename), content: String(content) })
      );
    },
    startComponentPicker: (request) => {
      const api = global.__TAURI__;
      if (api === undefined || api.core === undefined || typeof api.core.invoke !== "function") {
        return Promise.reject(new Error("native component picker unavailable"));
      }
      return Promise.resolve(api.core.invoke("start_component_picker", {
        request: {
          requestId: String(request.requestId),
          key: String(request.key ?? ""),
          url: String(request.url),
          x: Number(request.x),
          y: Number(request.y),
          width: Number(request.width),
          height: Number(request.height),
        },
      }));
    },
    cancelComponentPicker: (requestId) => {
      const api = global.__TAURI__;
      if (api === undefined || api.core === undefined || typeof api.core.invoke !== "function") {
        return Promise.reject(new Error("native component picker unavailable"));
      }
      return Promise.resolve(api.core.invoke("cancel_component_picker", {
        requestId: String(requestId),
      }));
    },
    onComponentPicker: (listener) => {
      const api = global.__TAURI__;
      if (api === undefined || api.event === undefined || typeof api.event.listen !== "function") {
        return Promise.resolve(() => {});
      }
      return Promise.resolve(api.event.listen("alpha-component-picker", (event) => {
        listener(event.payload);
      }));
    },
    openBrowserDocument: (request) => {
      const api = global.__TAURI__;
      if (api === undefined || api.core === undefined || typeof api.core.invoke !== "function") {
        return Promise.reject(new Error("native browser document unavailable"));
      }
      return Promise.resolve(api.core.invoke("open_browser_document", {
        request: {
          key: String(request.key),
          url: String(request.url),
          x: Number(request.x),
          y: Number(request.y),
          width: Number(request.width),
          height: Number(request.height),
        },
      }));
    },
    moveBrowserDocument: (request) => {
      const api = global.__TAURI__;
      if (api === undefined || api.core === undefined || typeof api.core.invoke !== "function") {
        return Promise.reject(new Error("native browser document unavailable"));
      }
      return Promise.resolve(api.core.invoke("move_browser_document", {
        key: String(request.key),
        x: Number(request.x),
        y: Number(request.y),
        width: Number(request.width),
        height: Number(request.height),
      }));
    },
    closeBrowserDocument: (key) => {
      const api = global.__TAURI__;
      if (api === undefined || api.core === undefined || typeof api.core.invoke !== "function") {
        return Promise.reject(new Error("native browser document unavailable"));
      }
      return Promise.resolve(api.core.invoke("close_browser_document", {
        key: String(key),
      }));
    },
    onBrowserDocument: (listener) => {
      const api = global.__TAURI__;
      if (api === undefined || api.event === undefined || typeof api.event.listen !== "function") {
        return Promise.resolve(() => {});
      }
      return Promise.resolve(api.event.listen("alpha-browser-document", (event) => {
        listener(event.payload);
      }));
    },
  };
})();
"#;

/// Host lifecycle owned by the exit handler.
#[derive(Default)]
struct HostState(Mutex<Option<HostProcess>>);

/// Running host plus the stdin writer used to request shutdown.
struct HostProcess {
    child: Child,
    stdin: ChildStdin,
}

/// Launch coordinates the shell reuses when it replaces a host that stopped answering.
#[derive(Clone)]
struct EngineLaunch {
    node: PathBuf,
    runtime: PathBuf,
    project: PathBuf,
}

/// Request to stop supervising; the watchdog polls this every cycle and leaves its loop the
/// moment the shell sets it while exiting.
#[derive(Default, Clone)]
struct Supervision(Arc<AtomicBool>);

/// Engine URL the shell last navigated to.
///
/// The URL carries the launch token of the host that is still serving, so it is the one
/// address that re-establishes a session the engine no longer accepts.
#[derive(Default)]
struct EngineUrl(Mutex<Option<Url>>);

/// Boot payload handed to the Web client; written by the host reader before navigation.
type BootPayload = Arc<Mutex<Option<Value>>>;

/// One host event the stdout reader forwards to the thread that booted it.
enum HostReport {
    /// Host reported readiness with its authenticated URL.
    Ready { url: String },
    /// Host reported a startup failure it will not recover from.
    Fatal(String),
    /// Host closed its output stream without reporting either outcome.
    Closed,
}

/// One JSON event emitted by the host on stdout.
#[derive(Deserialize)]
struct HostEvent {
    #[serde(rename = "type")]
    kind: String,
    url: Option<String>,
    message: Option<String>,
}

/// One window event the Web client reports when its boot fails.
#[derive(Deserialize)]
struct BootFailurePayload {
    message: Option<String>,
}

/// One window event the engine's denial page reports when its session is gone.
#[derive(Deserialize)]
struct UnauthorizedPayload {
    href: Option<String>,
}

/// One request from the Web client to start the native component picker.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ComponentPickerRequest {
    request_id: String,
    /// Tab key of the Browser document the picker runs over, when one is open.
    key: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// Active component-picker child webview owned by the shell.
#[derive(Default)]
struct ComponentPickerState(Mutex<ComponentPickerActive>);

/// One temporary picker webview and the request it reports for.
#[derive(Default)]
struct ComponentPickerActive {
    /// Monotonic counter that keeps every picker label unique.
    sequence: u64,
    /// Request the live webview reports for.
    request_id: Option<String>,
    /// Live child webview, absent while no picker runs.
    webview: Option<Webview>,
    /// Tab key of the Browser document hosting the picker, absent for a child webview.
    document_key: Option<String>,
}

/// One result emitted to the Web client after the child webview closes.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ComponentPickerResult {
    request_id: String,
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

/// Save one Markdown transcript through a native save dialog.
///
/// The dialog runs on a blocking worker because the native file dialog spins its own
/// modal loop and the main thread must stay on the event loop.
/// @param app - application handle that owns the dialog.
/// @param filename - default file name offered in the dialog.
/// @param content - Markdown transcript written to the chosen path.
/// @returns the written path, or `None` when the user cancelled the dialog.
#[tauri::command]
async fn save_markdown(
    app: tauri::AppHandle,
    filename: String,
    content: String,
) -> Result<Option<String>, String> {
    let chosen = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("Markdown", &["md"])
            .set_file_name(&filename)
            .blocking_save_file()
    })
    .await
    .map_err(|error| error.to_string())?;
    match chosen {
        None => Ok(None),
        Some(file) => {
            let path = file.into_path().map_err(|error| error.to_string())?;
            std::fs::write(&path, content.as_bytes()).map_err(|error| error.to_string())?;
            Ok(Some(path.to_string_lossy().to_string()))
        }
    }
}

/// Whether one navigation belongs to the component picker's private origin.
/// @param url - navigation the carrier intercepted.
/// @returns whether the picker script produced the navigation.
fn is_component_picker_navigation(url: &Url) -> bool {
    url.as_str().starts_with(&format!("{COMPONENT_PICKER_ORIGIN}/"))
}

/// Report one intercepted component-picker navigation to the Web client.
///
/// Every carrier reports through the same private origin, so the decoding is
/// shared and the navigation itself is never committed.
/// @param app - application handle that owns the main window.
/// @param request_id - request the navigation belongs to.
/// @param url - intercepted navigation on the picker's private origin.
fn emit_picker_navigation(app: &AppHandle, request_id: &str, url: &Url) {
    if url.as_str().starts_with(&format!("{COMPONENT_PICKER_ORIGIN}/cancel")) {
        emit_component_picker_result(app, request_id, "cancelled", None, None);
        return;
    }
    let encoded = url
        .query_pairs()
        .find_map(|(key, value)| (key == COMPONENT_PICKER_INPUT).then(|| value.into_owned()))
        .unwrap_or_default();
    match (encoded.len() <= COMPONENT_PICKER_RESULT_LIMIT)
        .then(|| URL_SAFE_NO_PAD.decode(encoded.as_bytes()).ok())
        .flatten()
    {
        Some(bytes) => match String::from_utf8(bytes) {
            Ok(text) => emit_component_picker_result(app, request_id, "selected", Some(text), None),
            Err(_) => emit_component_picker_result(
                app,
                request_id,
                "error",
                None,
                Some("component picker: result is not UTF-8".to_string()),
            ),
        },
        None => emit_component_picker_result(
            app,
            request_id,
            "error",
            None,
            Some("component picker: result is malformed or too large".to_string()),
        ),
    }
}

/// Live Browser document child webview for one tab key.
/// @param app - application handle that owns the document registry.
/// @param key - tab key the document was opened for.
/// @returns the live child webview, or `None` when no document is open.
fn browser_document(app: &AppHandle, key: &str) -> Option<Webview> {
    let documents = app.try_state::<BrowserDocumentState>()?;
    documents.0.lock().ok()?.documents.get(key).cloned()
}

/// Withdraw the component picker one Browser document hosted.
///
/// A document that is replaced or closed takes the picker with it, and the Web
/// client has already cleared its own picker state by then.
/// @param app - application handle that owns the picker session.
/// @param key - tab key whose document webview went away.
fn withdraw_document_picker(app: &AppHandle, key: &str) {
    let Some(picker) = app.try_state::<ComponentPickerState>() else { return };
    let hosted = picker
        .0
        .lock()
        .ok()
        .is_some_and(|active| active.document_key.as_deref() == Some(key));
    if hosted {
        close_component_picker(&picker, None);
    }
}

/// Re-arm the component picker inside one Browser document that just loaded.
///
/// A picker lives in the document that was open when it started, so a document
/// that navigated while it ran must have the picker installed again.
/// @param app - application handle that owns the picker session.
/// @param key - tab key of the document webview that finished loading.
fn rearm_component_picker(app: &AppHandle, key: &str) {
    let Some(picker) = app.try_state::<ComponentPickerState>() else { return };
    let webview = picker.0.lock().ok().and_then(|active| {
        (active.document_key.as_deref() == Some(key))
            .then(|| active.webview.clone())
            .flatten()
    });
    if let Some(webview) = webview {
        let _ = webview.eval(COMPONENT_PICKER_SCRIPT);
    }
}

/// Request identity of the component picker one Browser document hosts.
///
/// A navigation a document webview intercepts reports for the request that started
/// the picker, so the identity is read under the lock the picker session owns
/// before that lock is taken again to stop the picker.
/// @param app - application handle that owns the picker session.
/// @param key - tab key whose document webview intercepted the navigation.
/// @returns the live request identity, or `None` when that document hosts no picker.
fn document_picker_request(app: &AppHandle, key: &str) -> Option<String> {
    let picker = app.try_state::<ComponentPickerState>()?;
    picker.0.lock().ok().and_then(|active| {
        (active.document_key.as_deref() == Some(key))
            .then(|| active.request_id.clone())
            .flatten()
    })
}

/// Close the active component picker, whichever webview carries it.
///
/// Labels are never reused, so only the request that owns the live webview can
/// close it; a navigation left over from an earlier request never clears the
/// picker that replaced it. A picker hosted inside a Browser document stops the
/// script rather than destroying the page that hosts it.
/// @param state - shell-owned active picker.
/// @param request_id - owning request, or `None` to close whichever picker runs.
fn close_component_picker(state: &ComponentPickerState, request_id: Option<&str>) {
    let mut active = match state.0.lock() {
        Ok(active) => active,
        Err(_) => return,
    };
    if request_id.is_some_and(|expected| active.request_id.as_deref() != Some(expected)) {
        return;
    }
    active.request_id = None;
    let webview = active.webview.take();
    let hosted = active.document_key.take().is_some();
    drop(active);
    match webview {
        // The hosting document keeps its page; only the script inside it stops.
        Some(webview) if hosted => {
            let _ = webview.eval(COMPONENT_PICKER_STOP_CALL);
        }
        Some(webview) => {
            // `Webview::close` re-enters the event loop when the caller already runs on
            // the main thread, and callers here include the child webview's own
            // navigation callback. Deferring the close keeps the controller alive until
            // wry has finished reading that navigation event's arguments.
            tauri::async_runtime::spawn(async move {
                let _ = webview.close();
            });
        }
        None => {}
    }
}

/// Emit one component-picker result to the Web client.
/// @param app - application handle that owns the main window.
/// @param request_id - request the result belongs to.
/// @param status - `selected`, `cancelled`, or `error`.
/// @param text - selected component description, present only on success.
/// @param message - failure detail, present only on failure.
fn emit_component_picker_result(
    app: &AppHandle,
    request_id: &str,
    status: &'static str,
    text: Option<String>,
    message: Option<String>,
) {
    let _ = app.emit(
        COMPONENT_PICKER_EVENT,
        ComponentPickerResult { request_id: request_id.to_string(), status, text, message },
    );
}

/// Start the component picker over the page a Browser document already renders.
///
/// A live Browser document for the request's tab key hosts the picker in place:
/// the script is evaluated into the webview that already renders the page, so the
/// page never reloads. Without one, a temporary child webview opens over the
/// Browser iframe. Either carrier is isolated from the main window's boot bridge
/// and reports its result by navigating to the picker's private origin, which the
/// navigation handler intercepts before the URL is committed.
/// @param app - application handle that owns the main window.
/// @param state - shell-owned active picker.
/// @param request - tab key, target URL, iframe rectangle, and request identity.
/// @returns an acknowledgement once the picker is running.
#[tauri::command]
async fn start_component_picker(
    app: tauri::AppHandle,
    state: tauri::State<'_, ComponentPickerState>,
    request: ComponentPickerRequest,
) -> Result<(), String> {
    if request.request_id.is_empty() {
        return Err("component picker: requestId is empty".to_string());
    }
    if !request.x.is_finite()
        || !request.y.is_finite()
        || !request.width.is_finite()
        || !request.height.is_finite()
        || request.width <= 0.0
        || request.height <= 0.0
    {
        return Err("component picker: iframe rectangle is invalid".to_string());
    }
    let target = Url::parse(&request.url).map_err(|error| error.to_string())?;
    if target.scheme() != "http" && target.scheme() != "https" {
        return Err("component picker: only HTTP(S) URLs are supported".to_string());
    }
    close_component_picker(&state, None);
    // A live Browser document for this tab key picks in place: the script is evaluated
    // into the webview that already renders the page, so nothing reloads.
    if let Some(webview) = browser_document(&app, &request.key) {
        if let Err(error) = webview.set_focus() {
            return Err(format!("component picker: focus failed: {error}"));
        }
        if let Err(error) = webview.eval(COMPONENT_PICKER_SCRIPT) {
            return Err(format!("component picker: install failed: {error}"));
        }
        let mut active = state
            .0
            .lock()
            .map_err(|_| "component picker: state lock poisoned".to_string())?;
        active.request_id = Some(request.request_id);
        active.document_key = Some(request.key);
        active.webview = Some(webview);
        return Ok(());
    }
    let label = {
        let mut active = state
            .0
            .lock()
            .map_err(|_| "component picker: state lock poisoned".to_string())?;
        active.sequence = active.sequence.saturating_add(1);
        format!("{COMPONENT_PICKER_LABEL}-{}", active.sequence)
    };
    let window = app
        .get_window("main")
        .ok_or_else(|| "component picker: main window unavailable".to_string())?;
    let event_request_id = request.request_id.clone();
    let handle = app.clone();
    // The reported rectangle is CSS pixels relative to the Browser iframe. wry maps a child
    // webview's logical rectangle through two independent per-HWND DPI reads, so a logical
    // rectangle lands wherever those reads disagree with the window's scale factor. Converting
    // once to physical pixels against the window scale factor and the main webview's measured
    // origin turns both reads into identity and places the child exactly over the iframe.
    let scale_factor = match window.scale_factor() {
        Ok(scale) if scale.is_finite() && scale > 0.0 => scale,
        _ => 1.0,
    };
    let origin = app
        .get_webview("main")
        .and_then(|main| main.bounds().ok())
        .map(|rect| rect.position.to_physical::<i32>(scale_factor))
        .unwrap_or_else(|| PhysicalPosition::new(0, 0));
    let to_physical = |value: f64| (value * scale_factor).round();
    let position = PhysicalPosition::new(
        origin.x + to_physical(request.x) as i32,
        origin.y + to_physical(request.y) as i32,
    );
    let size = PhysicalSize::new(
        to_physical(request.width).max(1.0) as u32,
        to_physical(request.height).max(1.0) as u32,
    );
    let webview = window
        .add_child(
            WebviewBuilder::new(label, WebviewUrl::External(target))
            .initialization_script(COMPONENT_PICKER_SCRIPT)
            .on_navigation(move |url| {
                if !is_component_picker_navigation(url) {
                    return true;
                }
                close_component_picker(
                    &handle.state::<ComponentPickerState>(),
                    Some(&event_request_id),
                );
                emit_picker_navigation(&handle, &event_request_id, url);
                false
            })
            // wry maps this to AppKit's `acceptFirstMouse:`. Its default spends
            // the first click on an inactive window merely activating Alpha.
            .accept_first_mouse(true),
            position,
            size,
        )
        .map_err(|error| error.to_string())?;
    // The child webview must own the keyboard so Escape reaches the picker script.
    if let Err(error) = webview.set_focus() {
        let _ = webview.close();
        return Err(format!("component picker: focus failed: {error}"));
    }
    {
        let mut active = state
            .0
            .lock()
            .map_err(|_| "component picker: state lock poisoned".to_string())?;
        active.request_id = Some(request.request_id);
        active.webview = Some(webview);
    }
    Ok(())
}

/// Cancel the active component picker for one request.
/// @param state - shell-owned active picker.
/// @param request_id - request identity echoed by the Web client.
/// @returns an acknowledgement once the active picker is closed.
#[tauri::command]
fn cancel_component_picker(
    state: tauri::State<'_, ComponentPickerState>,
    request_id: String,
) -> Result<(), String> {
    close_component_picker(&state, Some(&request_id));
    Ok(())
}

/// One request to open a native Browser document child webview.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrowserDocumentRequest {
    key: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// Shell-owned registry of the live Browser document child webviews.
#[derive(Default)]
struct BrowserDocumentState(Mutex<BrowserDocumentRegistry>);

/// Live Browser document child webviews keyed by the Web client's tab key.
#[derive(Default)]
struct BrowserDocumentRegistry {
    /// Monotonic counter that keeps every child webview label unique.
    sequence: u64,
    /// Live child webview per tab key.
    documents: HashMap<String, Webview>,
}

/// One Browser document event emitted to the Web client.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserDocumentEvent {
    key: String,
    /// `loaded` for a finished navigation, `popup` for a blocked new-window request.
    status: &'static str,
    /// Popup target, present only on `popup`.
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<String>,
}

/// Convert one reported carrier rectangle into physical pixels.
///
/// wry maps a child webview's logical rectangle through two independent per-HWND DPI
/// reads, so a logical rectangle lands wherever those reads disagree with the window's
/// scale factor. Converting once against the window scale factor and the main webview's
/// measured origin turns both reads into identity and places the child over the carrier.
/// @param app - application handle that owns the main window.
/// @param x - carrier rectangle left edge in CSS pixels.
/// @param y - carrier rectangle top edge in CSS pixels.
/// @param width - carrier rectangle width in CSS pixels.
/// @param height - carrier rectangle height in CSS pixels.
/// @returns the physical position and size, or the refusal reason.
fn browser_document_placement(
    app: &AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(PhysicalPosition<i32>, PhysicalSize<u32>), String> {
    if !x.is_finite()
        || !y.is_finite()
        || !width.is_finite()
        || !height.is_finite()
        || width <= 0.0
        || height <= 0.0
    {
        return Err("browser document: carrier rectangle is invalid".to_string());
    }
    let window = app
        .get_window("main")
        .ok_or_else(|| "browser document: main window unavailable".to_string())?;
    let scale_factor = match window.scale_factor() {
        Ok(scale) if scale.is_finite() && scale > 0.0 => scale,
        _ => 1.0,
    };
    let origin = app
        .get_webview("main")
        .and_then(|main| main.bounds().ok())
        .map(|rect| rect.position.to_physical::<i32>(scale_factor))
        .unwrap_or_else(|| PhysicalPosition::new(0, 0));
    let to_physical = |value: f64| (value * scale_factor).round();
    let position = PhysicalPosition::new(
        origin.x + to_physical(x) as i32,
        origin.y + to_physical(y) as i32,
    );
    let size = PhysicalSize::new(
        to_physical(width).max(1.0) as u32,
        to_physical(height).max(1.0) as u32,
    );
    Ok((position, size))
}

/// Close every live Browser document child webview.
/// @param state - shell-owned registry of live document webviews.
fn close_browser_documents(state: &BrowserDocumentState) {
    let webviews: Vec<Webview> = match state.0.lock() {
        Ok(mut registry) => registry.documents.drain().map(|(_, webview)| webview).collect(),
        Err(_) => return,
    };
    for webview in webviews {
        // `Webview::close` re-enters the event loop when the caller already runs on the
        // main thread, and this runs from the shell's own exit handler.
        tauri::async_runtime::spawn(async move {
            let _ = webview.close();
        });
    }
}

/// Open one native Browser document child webview over the Browser carrier.
///
/// The child webview is isolated from the main window's boot bridge, so the page it
/// renders cannot reach the application, and it is not subject to the framing refusals
/// that leave an iframe carrier blank. A finished navigation is reported back through
/// the Browser document event, and a blocked new-window request reports its target so
/// the client can hand it to the system browser.
/// @param app - application handle that owns the main window.
/// @param state - shell-owned registry of live document webviews.
/// @param request - tab key, target URL, and carrier rectangle in CSS pixels.
/// @returns an acknowledgement once the child webview is created.
#[tauri::command]
async fn open_browser_document(
    app: tauri::AppHandle,
    state: tauri::State<'_, BrowserDocumentState>,
    request: BrowserDocumentRequest,
) -> Result<(), String> {
    if request.key.is_empty() {
        return Err("browser document: key is empty".to_string());
    }
    let target = Url::parse(&request.url).map_err(|error| error.to_string())?;
    if target.scheme() != "http" && target.scheme() != "https" {
        return Err("browser document: only HTTP(S) URLs are supported".to_string());
    }
    let (position, size) =
        browser_document_placement(&app, request.x, request.y, request.width, request.height)?;
    let window = app
        .get_window("main")
        .ok_or_else(|| "browser document: main window unavailable".to_string())?;
    let label = {
        let mut registry = state
            .0
            .lock()
            .map_err(|_| "browser document: state lock poisoned".to_string())?;
        registry.sequence = registry.sequence.saturating_add(1);
        let sequence = registry.sequence;
        let previous = registry.documents.remove(&request.key);
        drop(registry);
        // The replacement takes the key, so a picker the old document hosted loses
        // the webview its script runs in.
        withdraw_document_picker(&app, &request.key);
        if let Some(previous) = previous {
            // Deferring the close keeps the controller alive until wry has finished
            // reading this command's arguments, matching the picker's own close.
            tauri::async_runtime::spawn(async move {
                let _ = previous.close();
            });
        }
        format!("{BROWSER_DOCUMENT_LABEL}-{sequence}")
    };
    let webview = window
        .add_child(
            WebviewBuilder::new(label, WebviewUrl::External(target))
                .on_page_load({
                    let emitter = app.clone();
                    let key = request.key.clone();
                    move |_webview, payload| {
                        if payload.event() != PageLoadEvent::Finished {
                            return;
                        }
                        rearm_component_picker(&emitter, &key);
                        let _ = emitter.emit(
                            BROWSER_DOCUMENT_EVENT,
                            BrowserDocumentEvent { key: key.clone(), status: "loaded", url: None },
                        );
                    }
                })
                .on_new_window({
                    let emitter = app.clone();
                    let key = request.key.clone();
                    move |url, _features| {
                        let _ = emitter.emit(
                            BROWSER_DOCUMENT_EVENT,
                            BrowserDocumentEvent {
                                key: key.clone(),
                                status: "popup",
                                url: Some(url.to_string()),
                            },
                        );
                        tauri::webview::NewWindowResponse::Deny
                    }
                })
                .on_navigation({
                    let handle = app.clone();
                    let key = request.key.clone();
                    move |url| {
                        if !is_component_picker_navigation(url) {
                            return true;
                        }
                        if let Some(request_id) = document_picker_request(&handle, &key) {
                            close_component_picker(
                                &handle.state::<ComponentPickerState>(),
                                Some(&request_id),
                            );
                            emit_picker_navigation(&handle, &request_id, url);
                        }
                        false
                    }
                })
                // wry maps this to AppKit's `acceptFirstMouse:`. Its default spends
                // the first click on an inactive window merely activating Alpha.
                .accept_first_mouse(true),
            position,
            size,
        )
        .map_err(|error| error.to_string())?;
    {
        let mut registry = state
            .0
            .lock()
            .map_err(|_| "browser document: state lock poisoned".to_string())?;
        registry.documents.insert(request.key, webview);
    }
    Ok(())
}

/// Reposition one open native Browser document child webview.
/// @param app - application handle that owns the main window.
/// @param state - shell-owned registry of live document webviews.
/// @param key - tab key the child webview was opened for.
/// @param x - carrier rectangle left edge in CSS pixels.
/// @param y - carrier rectangle top edge in CSS pixels.
/// @param width - carrier rectangle width in CSS pixels.
/// @param height - carrier rectangle height in CSS pixels.
/// @returns an acknowledgement, or a refusal when the rectangle is unusable.
#[tauri::command]
fn move_browser_document(
    app: tauri::AppHandle,
    state: tauri::State<'_, BrowserDocumentState>,
    key: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let (position, size) = browser_document_placement(&app, x, y, width, height)?;
    let webview = state
        .0
        .lock()
        .map_err(|_| "browser document: state lock poisoned".to_string())?
        .documents
        .get(&key)
        .cloned();
    let Some(webview) = webview else {
        return Ok(());
    };
    webview.set_position(position).map_err(|error| error.to_string())?;
    webview.set_size(size).map_err(|error| error.to_string())?;
    Ok(())
}

/// Close one native Browser document child webview, withdrawing a picker it hosted.
///
/// A document that hosted the component picker takes the picker with it; the Web
/// client has already cleared its own picker state by then.
/// @param state - shell-owned registry of live document webviews.
/// @param key - tab key the child webview was opened for.
/// @returns an acknowledgement once the child webview is closed.
#[tauri::command]
fn close_browser_document(
    app: tauri::AppHandle,
    state: tauri::State<'_, BrowserDocumentState>,
    key: String,
) -> Result<(), String> {
    let webview = state
        .0
        .lock()
        .map_err(|_| "browser document: state lock poisoned".to_string())?
        .documents
        .remove(&key);
    withdraw_document_picker(&app, &key);
    if let Some(webview) = webview {
        tauri::async_runtime::spawn(async move {
            let _ = webview.close();
        });
    }
    Ok(())
}

/// Build and run the Alpha desktop shell.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            save_markdown,
            start_component_picker,
            cancel_component_picker,
            open_browser_document,
            move_browser_document,
            close_browser_document
        ])
        .setup(|app| {
            app.manage(HostState::default());
            app.manage(Supervision::default());
            app.manage(EngineUrl::default());
            app.manage(ComponentPickerState::default());
            app.manage(BrowserDocumentState::default());
            let handle = app.handle().clone();
            match resolve_launch(&handle) {
                Ok((node, runtime, project)) => {
                    boot_host(handle, node, runtime, project, Arc::new(Mutex::new(None)))
                }
                Err(error) => report_fatal(&handle, &error),
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the Alpha application")
        .run(|handle, event| {
            if matches!(event, RunEvent::Exit) {
                // The watchdog must not relaunch a host the shell is deliberately stopping.
                if let Some(supervision) = handle.try_state::<Supervision>() {
                    supervision.0.store(true, Ordering::Relaxed);
                }
                if let Some(picker) = handle.try_state::<ComponentPickerState>() {
                    close_component_picker(&picker, None);
                }
                if let Some(documents) = handle.try_state::<BrowserDocumentState>() {
                    close_browser_documents(&documents);
                }
                stop_current_host(handle);
            }
        });
}

/// Resolve the Node sidecar and the bundled runtime directories inside the installed app.
fn resolve_launch(handle: &AppHandle) -> Result<(PathBuf, PathBuf, PathBuf), String> {
    let node = node_sidecar()?;
    let runtime = bundled_runtime(handle)?;
    let project = application_data_dir(handle)?;
    if !runtime.join("node_modules").exists() {
        return Err("Alpha could not locate its bundled runtime packages.".to_string());
    }
    Ok((node, runtime, project))
}

/// Locate the prepared engine payload inside the installed application.
///
/// macOS and Windows map the staged payload to `runtime` in the application's resource
/// directory. The Linux AppImage receives it beside the desktop entry instead, because the
/// linuxdeploy run the bundle performs resolves the dependencies of every ELF file under
/// `usr/lib` and aborts when a payload library needs one the build host does not carry.
/// `usr/share` is never inspected, so the payload stays out of that resolution.
/// @param handle - Application handle that resolves platform resource paths.
/// @returns The directory the bundle layout places the payload in.
fn bundled_runtime(handle: &AppHandle) -> Result<PathBuf, String> {
    if cfg!(target_os = "linux") {
        let executable = std::env::current_exe()
            .map_err(|error| format!("Alpha could not locate its executable: {error}"))?;
        let directory = executable
            .parent()
            .ok_or_else(|| "Alpha could not resolve its install directory.".to_string())?;
        let product = handle
            .config()
            .product_name
            .clone()
            .ok_or_else(|| "Alpha's bundle configuration declares no product name.".to_string())?;
        // The executable sits in `usr/bin`, so the payload hangs off its parent.
        let usr = directory
            .parent()
            .ok_or_else(|| "Alpha could not resolve its install directory.".to_string())?;
        return Ok(usr.join("share").join(product).join("runtime"));
    }
    handle
        .path()
        .resolve("runtime", BaseDirectory::Resource)
        .map_err(|error| format!("Alpha could not locate its bundled runtime: {error}"))
}

/// Locate the per-target Node sidecar placed next to the application executable.
/// Bundled applications carry the sidecar as plain `node`, `node.exe` on
/// Windows; a development build keeps the target-triple suffix in the target
/// directory.
fn node_sidecar() -> Result<PathBuf, String> {
    let executable = std::env::current_exe()
        .map_err(|error| format!("Alpha could not locate its executable: {error}"))?;
    let directory = executable
        .parent()
        .ok_or_else(|| "Alpha could not resolve its install directory.".to_string())?;
    let mut candidates = vec![directory.join("node")];
    if cfg!(target_os = "windows") {
        candidates.push(directory.join("node.exe"));
    }
    let mut suffixed = directory.join(format!("node-{}", target_triple()));
    if cfg!(target_os = "windows") {
        suffixed.set_extension("exe");
    }
    candidates.push(suffixed);
    if let Some(found) = candidates.iter().find(|candidate| candidate.exists()) {
        return Ok(found.clone());
    }
    Err(format!(
        "Alpha could not locate its Node runtime (tried {})",
        candidates.iter().map(|path| path.display().to_string()).collect::<Vec<_>>().join(", ")
    ))
}

/// Application data directory used as the host working directory and profile root.
fn application_data_dir(handle: &AppHandle) -> Result<PathBuf, String> {
    handle
        .path()
        .resolve("", BaseDirectory::AppLocalData)
        .or_else(|_| handle.path().resolve("", BaseDirectory::AppData))
        .map_err(|error| format!("Alpha could not resolve its data directory: {error}"))
}

/// Serve the loader document from a loopback address for the life of the process.
///
/// The engine authenticates its browser session with a `SameSite=Strict` cookie, so a
/// navigation that left the `tauri` scheme for the engine would drop the cookie the engine
/// issues on its authentication redirect. A loopback address sits in the engine's site, and
/// a site match is what carries that cookie across the redirect. The operating system picks
/// the port, and every request on it answers with the same document.
/// @returns The URL that loads the loader document.
fn serve_loader() -> Result<Url, String> {
    let document: &'static str = include_str!("../frontend/index.html");
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|error| format!("Alpha could not open its loader: {error}"))?;
    let address = listener
        .local_addr()
        .map_err(|error| format!("Alpha could not read its loader address: {error}"))?;
    std::thread::spawn(move || {
        for opened in listener.incoming() {
            let Ok(mut stream) = opened else { continue };
            std::thread::spawn(move || serve_loader_connection(&mut stream, document));
        }
    });
    Url::parse(&format!("http://{address}/"))
        .map_err(|error| format!("Alpha could not build its loader URL: {error}"))
}

/// Answer one loopback request with the loader document and close the connection.
/// @param stream - Accepted connection that is sending its request head.
/// @param document - Loader document bytes returned for the request.
fn serve_loader_connection(stream: &mut TcpStream, document: &str) {
    // A connection the page opens without sending anything must not hold a reader thread,
    // and the answer is the same whatever path or method the page asked for.
    if stream
        .set_read_timeout(Some(Duration::from_millis(LOADER_READ_TIMEOUT_MS)))
        .is_err()
    {
        return;
    }
    let Ok(sender) = stream.try_clone() else {
        return;
    };
    let mut request = BufReader::new(sender);
    let mut read = 0usize;
    loop {
        let mut line = String::new();
        match request.read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => read += line.len(),
            Err(_) => return,
        }
        if line.trim().is_empty() || read >= LOADER_HEAD_LIMIT {
            break;
        }
    }
    let response = format!(
        "content-type: text/html; charset=utf-8\r\ncontent-length: {}\r\ncache-control: no-store\r\nconnection: close\r\n\r\n{document}",
        document.len()
    );
    let _ = stream.write_all(format!("HTTP/1.1 200 OK\r\n{response}").as_bytes());
    let _ = stream.flush();
}

/// Create the window, boot the first engine, and hand the session to the watchdog.
fn boot_host(handle: AppHandle, node: PathBuf, runtime: PathBuf, project: PathBuf, payload: BootPayload) {
    let launch = EngineLaunch { node, runtime, project };
    let loader = match serve_loader() {
        Ok(loader) => loader,
        Err(error) => {
            report_fatal(&handle, &error);
            return;
        }
    };
    let window = match build_window(&handle, Arc::clone(&payload), loader) {
        Ok(window) => window,
        Err(error) => {
            report_fatal(&handle, &error);
            return;
        }
    };
    let supervision = handle.try_state::<Supervision>().map(|state| state.inner().clone());
    // Booting and supervising share one thread so every navigation is requested off the
    // main thread, and a failed first engine stops the host instead of stranding it.
    std::thread::spawn(move || {
        let Some(supervision) = supervision else {
            report_fatal_async(&handle, "Alpha lost its supervision state.".to_string());
            return;
        };
        let url = match start_engine(&handle, &window, &launch, &payload) {
            Ok(url) => url,
            Err(message) => {
                stop_current_host(&handle);
                report_fatal_async(&handle, message);
                return;
            }
        };
        supervise(supervision, handle, window, launch, payload, url);
    });
}

/// Build the shell window and attach the events the loader page and the Web client use.
/// @param handle - Shell that owns the window and reports startup failures.
/// @param payload - Shared slot holding the payload later documents are handed.
/// @param loader - Loopback URL of the loader document the window opens first.
/// @returns The shell window, or the reason the system refused to create it.
fn build_window(
    handle: &AppHandle,
    payload: BootPayload,
    loader: Url,
) -> Result<WebviewWindow, String> {
    let payload_for_pages = Arc::clone(&payload);
    let window = WebviewWindowBuilder::new(
        handle,
        "main",
        WebviewUrl::External(loader),
    )
    .title("Alpha")
    .inner_size(1280.0, 800.0)
    .min_inner_size(900.0, 600.0)
    // Tauri replaces the webview's own drag-drop handler by default, which
    // suppresses the HTML5 drag and drop events the attachment intake listens
    // for. Disabling it hands file drops back to the page.
    .disable_drag_drop_handler()
    .initialization_script(BOOT_BRIDGE)
    // A document loaded after the first navigation still needs the payload the shell holds,
    // because the initialization script alone only sees one carried into that document.
    .on_page_load(move |loaded: WebviewWindow, page: PageLoadPayload<'_>| {
        // A document that replaces the one that positioned the picker must not
        // leave the child webview behind, because nothing can place it again.
        if page.event() == PageLoadEvent::Started {
            if let Some(picker) = loaded.app_handle().try_state::<ComponentPickerState>() {
                close_component_picker(&picker, None);
            }
            return;
        }
        if page.event() != PageLoadEvent::Finished {
            return;
        }
        let held = payload_for_pages.lock().ok().and_then(|slot| slot.clone());
        if let Some(held) = held {
            inject_payload(&loaded, &held);
        }
    })
    .build()
    .map_err(|error| format!("Alpha could not open its window: {error}"))?;
    let close_handle = handle.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
            close_handle.exit(0);
        }
    });
    let failure_handle = handle.clone();
    window.listen(BOOT_FAILED_EVENT, move |event: Event| {
        let message = serde_json::from_str::<BootFailurePayload>(event.payload())
            .ok()
            .and_then(|reported| reported.message)
            .filter(|message| !message.trim().is_empty())
            .unwrap_or_else(|| "Alpha could not start its engine.".to_string());
        let reporter = failure_handle.clone();
        failure_handle.run_on_main_thread(move || report_fatal(&reporter, &message)).ok();
    });
    let unauthorized_handle = handle.clone();
    window.listen(UNAUTHORIZED_EVENT, move |event: Event| {
        // The engine denies a browser navigation that carries no session cookie, and only
        // the shell holds the launch token that establishes one. The host that answered
        // readiness last is still serving, so navigating to it again mints a fresh session.
        let denied = serde_json::from_str::<UnauthorizedPayload>(event.payload())
            .ok()
            .and_then(|reported| reported.href)
            .unwrap_or_default();
        let held = unauthorized_handle
            .try_state::<EngineUrl>()
            .and_then(|state| state.0.lock().ok().and_then(|slot| slot.clone()));
        let Some(target) = held else { return };
        eprintln!("alpha: engine denied {denied}; reopening {target}");
        let reporter = unauthorized_handle.clone();
        let _ = unauthorized_handle.run_on_main_thread(move || {
            let Some(window) = reporter.get_webview_window("main") else { return };
            if let Err(error) = window.navigate(target) {
                report_fatal(&reporter, &format!("Alpha could not reopen its engine: {error}"));
            }
        });
    });
    Ok(window)
}

/// Boot one host and navigate the window to the engine it reports.
/// @param handle - Shell owning the host state and the window.
/// @param window - Window the engine document is shown in.
/// @param launch - Node sidecar and bundled runtime coordinates.
/// @param payload - Shared slot holding the payload later documents are handed.
/// @returns The authenticated engine URL the host reported readiness on.
fn start_engine(
    handle: &AppHandle,
    window: &WebviewWindow,
    launch: &EngineLaunch,
    payload: &BootPayload,
) -> Result<Url, String> {
    let reports = spawn_host(handle, launch)?;
    let url = await_ready(&reports)?;
    // A document the engine denies must be able to return to the host that answered, so the
    // shell keeps the URL that carries this host's launch token.
    if let Some(state) = handle.try_state::<EngineUrl>() {
        if let Ok(mut slot) = state.0.lock() {
            *slot = Some(url.clone());
        }
    }
    let held = payload_object(&url);
    let target = url.clone();
    let navigator = window.clone();
    let reporter = handle.clone();
    let slot = Arc::clone(payload);
    // Navigation owns the window, so the payload is published from the main thread.
    let _ = handle.run_on_main_thread(move || {
        if let Err(message) = navigate_engine(&navigator, target, &slot, &held) {
            report_fatal(&reporter, &message);
        }
    });
    Ok(url)
}

/// Start one host process, register it for shutdown, and read its output for its lifetime.
///
/// The reader drains the host's stdout until the process is gone. Releasing the read end
/// after readiness would answer every later host write with a broken pipe, so the drain
/// outlives the readiness the booting thread is waiting for.
/// @param handle - Shell whose host state owns this process.
/// @param launch - Node sidecar and bundled runtime coordinates.
/// @returns Receiver delivering the readiness or failure the host reports first.
fn spawn_host(handle: &AppHandle, launch: &EngineLaunch) -> Result<Receiver<HostReport>, String> {
    let entry = launch
        .runtime
        .join("node_modules")
        .join("@mutantcat")
        .join("dsh-desktop-host")
        .join("lib")
        .join("index.js");
    let primary_runtime = launch.runtime.join("primary-runtime").to_string_lossy().to_string();
    let package_manager = launch.runtime.join("pnpm").join("bin").join("pnpm.mjs");
    let node_bin = launch.runtime.join("bin");
    let mut command = Command::new(&launch.node);
    command
        .arg("--expose-internals")
        .arg(&entry)
        .arg(&launch.runtime)
        .arg(&launch.project)
        .arg(primary_runtime)
        .arg("runtime")
        .arg(package_manager)
        .arg(node_bin)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // A console-subsystem Node child would flash a console window on Windows.
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    let mut child =
        command.spawn().map_err(|error| format!("Alpha could not start its engine: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Alpha lost its engine output stream.".to_string())?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Alpha lost its engine input stream.".to_string())?;
    if let Some(stderr) = child.stderr.take() {
        // A chatty host must never block on a full stderr pipe.
        std::thread::spawn(move || {
            for _line in BufReader::new(stderr).lines().map_while(Result::ok) {}
        });
    }
    if let Some(state) = handle.try_state::<HostState>() {
        if let Ok(mut slot) = state.0.lock() {
            *slot = Some(HostProcess { child, stdin });
        }
    }
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let Ok(event) = serde_json::from_slice::<HostEvent>(trimmed.as_bytes()) else {
                continue;
            };
            match event.kind.as_str() {
                "ready" => {
                    // A booting thread that already left is not an error: the drain continues.
                    let _ = sender.send(HostReport::Ready {
                        url: event.url.clone().unwrap_or_default(),
                    });
                }
                "fatal" => {
                    let _ = sender.send(HostReport::Fatal(event.message.unwrap_or_else(|| {
                        "Alpha engine failed to start.".to_string()
                    })));
                }
                _ => {}
            }
        }
        let _ = sender.send(HostReport::Closed);
    });
    Ok(receiver)
}

/// Wait for the host to report the outcome of its boot.
/// @param reports - Receiver the host's stdout reader forwards into.
/// @returns The engine URL, or the failure the host reported.
fn await_ready(reports: &Receiver<HostReport>) -> Result<Url, String> {
    match reports.recv_timeout(Duration::from_millis(HOST_BOOT_TIMEOUT_MS)) {
        Ok(HostReport::Ready { url }) => {
            let parsed = Url::parse(&url)
                .map_err(|_| "Alpha engine reported an unreadable URL.".to_string())?;
            Ok(parsed)
        }
        Ok(HostReport::Fatal(message)) => Err(message),
        Ok(HostReport::Closed) | Err(_) => {
            Err("Alpha engine closed before it was ready.".to_string())
        }
    }
}

/// Supervise the engine for the rest of the session.
///
/// The host is the only process that owns the engine, so its exit, or a request loop that
/// stops answering, leaves the window on a document that talks to nothing. Both are
/// repaired by replacing the host and navigating again. A suspended machine is reported by
/// the clocks running apart or by a watchdog cycle that froze with the machine, and the
/// window is navigated back to the engine once it answers, because the document the Web
/// client holds froze with the machine.
/// @param supervision - Stop flag the shell sets once it is exiting.
/// @param handle - Shell owning the host state and the window.
/// @param window - Window the engine document is shown in.
/// @param launch - Node sidecar and bundled runtime coordinates.
/// @param payload - Shared slot holding the payload later documents are handed.
/// @param url - Engine URL the first host reported.
fn supervise(
    supervision: Supervision,
    handle: AppHandle,
    window: WebviewWindow,
    launch: EngineLaunch,
    payload: BootPayload,
    url: Url,
) {
    let mut url = url;
    let mut failures: u32 = 0;
    let mut woke = false;
    let mut wake_probes: u32 = 0;
    let mut mono = Instant::now();
    let mut wall = SystemTime::now();
    // The flag records that the shell is exiting, so supervision runs until it is set.
    while !supervision.0.load(Ordering::Relaxed) {
        let cycle = Instant::now();
        std::thread::sleep(Duration::from_millis(WATCHDOG_INTERVAL_MS));
        if supervision.0.load(Ordering::Relaxed) {
            break;
        }
        // Windows advances the monotonic clock through a suspension, so the clock
        // divergence read below never appears there; a watchdog cycle that ran long
        // does, because the thread froze with the rest of the machine. The same read
        // catches a shell the system throttled hard, such as an occluded window held
        // back by App Nap, which returns from a long cycle rather than a clock skew.
        let slept = slept_since(&mut mono, &mut wall)
            || cycle.elapsed() > Duration::from_millis(WATCHDOG_INTERVAL_MS + WAKE_GAP_MS);
        if slept {
            woke = true;
            wake_probes = 0;
        }
        if host_running(&handle) && engine_healthy(&url) {
            failures = 0;
            if woke {
                revive(&handle, &window, &url);
                woke = false;
            }
            continue;
        }
        // A host that outlived a suspension may answer only once the machine finished
        // waking, so a few failed probes after a wake are tolerated before the engine
        // is replaced and a running session is interrupted for nothing.
        if woke && host_running(&handle) && wake_probes < MAX_WAKE_PROBES {
            wake_probes += 1;
            continue;
        }
        woke = false;
        // Either the process is gone or the request loop stopped answering: replace it.
        match restart_host(&handle, &window, &launch, &payload) {
            Ok(fresh) => {
                url = fresh;
                failures = 0;
                // The window shows no trace of the swap, so the only sign the engine was
                // replaced reaches the log.
                eprintln!("alpha: engine restarted at {url}");
            }
            Err(message) => {
                failures += 1;
                if failures > MAX_HOST_RESTARTS {
                    report_fatal_async(&handle, message);
                    return;
                }
            }
        }
    }
}

/// Whether the machine was suspended since the previous clock reading.
///
/// The monotonic clock stops for the duration of a system sleep and the wall clock does
/// not, so a wall-clock lead reports a suspension without a platform power listener.
/// @param mono - Monotonic reading from the previous observation, updated in place.
/// @param wall - Wall-clock reading from the previous observation, updated in place.
/// @returns True when the wall clock ran ahead of elapsed monotonic time by a wide margin.
fn slept_since(mono: &mut Instant, wall: &mut SystemTime) -> bool {
    let mono_gap = mono.elapsed();
    let now_wall = SystemTime::now();
    let wall_gap = now_wall.duration_since(*wall).unwrap_or(Duration::ZERO);
    *mono = Instant::now();
    *wall = now_wall;
    wall_gap > mono_gap + Duration::from_millis(WAKE_GAP_MS)
}

/// Whether the registered host process is still running.
/// @param handle - Shell whose host state holds the process.
/// @returns True while a host is registered and has not been reaped.
fn host_running(handle: &AppHandle) -> bool {
    let Some(state) = handle.try_state::<HostState>() else {
        return false;
    };
    let Ok(mut slot) = state.0.lock() else {
        return false;
    };
    match slot.as_mut() {
        Some(host) => !matches!(host.child.try_wait(), Ok(Some(_))),
        None => false,
    }
}

/// Whether the engine still answers a request outside any session.
///
/// The engine answers every request without its session cookie with the same unauthorized
/// code, so that code proves the request loop is serving without touching session state.
/// Anything else, including the error code a failing route handler falls back to, counts as
/// an engine that can no longer serve the document the window is holding.
/// @param url - Engine URL whose host and port are probed.
/// @returns True when the engine answered the unauthorized code.
fn engine_healthy(url: &Url) -> bool {
    let host = url.host_str().unwrap_or("127.0.0.1");
    let port = url.port_or_known_default().unwrap_or(80);
    let Ok(address) = format!("{host}:{port}").parse::<SocketAddr>() else {
        return false;
    };
    let Ok(mut stream) =
        TcpStream::connect_timeout(&address, Duration::from_millis(ENGINE_HEALTH_TIMEOUT_MS))
    else {
        return false;
    };
    let budget = Duration::from_millis(ENGINE_HEALTH_TIMEOUT_MS);
    let _ = stream.set_read_timeout(Some(budget));
    let _ = stream.set_write_timeout(Some(budget));
    let request = format!(
        "GET / HTTP/1.1\r\nHost: {host}:{port}\r\nAccept: */*\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut status = String::new();
    if BufReader::new(stream).read_line(&mut status).is_err() {
        return false;
    }
    status
        .split_whitespace()
        .nth(1)
        .and_then(|value| value.parse::<u16>().ok())
        == Some(ENGINE_UNAUTHORIZED)
}

/// Stop the current host and boot a fresh one on the same window.
/// @param handle - Shell owning the host state and the window.
/// @param window - Window the replacement engine is shown in.
/// @param launch - Node sidecar and bundled runtime coordinates.
/// @param payload - Shared slot holding the payload later documents are handed.
/// @returns The engine URL the replacement host reported.
fn restart_host(
    handle: &AppHandle,
    window: &WebviewWindow,
    launch: &EngineLaunch,
    payload: &BootPayload,
) -> Result<Url, String> {
    stop_current_host(handle);
    start_engine(handle, window, launch, payload)
}

/// Navigate the window back to the engine that is already answering.
///
/// A document the Web client is holding froze with the machine, so its connections to the
/// engine are stale even though the engine answers again. A fresh document rebuilds them
/// from the session the engine already holds.
/// @param handle - Shell that owns the window.
/// @param window - Window to navigate.
/// @param url - Engine URL that answered the health probe.
fn revive(handle: &AppHandle, window: &WebviewWindow, url: &Url) {
    let target = url.clone();
    let navigator = window.clone();
    let reporter = handle.clone();
    let _ = handle.run_on_main_thread(move || {
        if let Err(error) = navigator.navigate(target) {
            report_fatal(&reporter, &format!("Alpha could not reopen its engine: {error}"));
        }
    });
}

/// Navigate the window to the engine once its server accepts connections.
/// @returns Nothing, or the reason the window could not be pointed at the engine.
fn navigate_engine(
    window: &WebviewWindow,
    url: Url,
    payload: &BootPayload,
    object: &Value,
) -> Result<(), String> {
    // The engine document is a different origin from the loader, so the payload cannot
    // travel with the navigation: publishing it in the shared slot lets the page-load
    // hook carry it into every document that loads after readiness.
    if let Ok(mut slot) = payload.lock() {
        *slot = Some(object.clone());
    }
    inject_payload(window, object);
    if !engine_answers(&url) {
        return Err("Alpha could not reach its engine after it reported readiness.".to_string());
    }
    if let Err(error) = window.navigate(url) {
        return Err(format!("Alpha could not open its engine: {error}"));
    }
    Ok(())
}

/// Shape the readiness payload the Web client consumes for boot.
///
/// The engine's served document already carries its injection table, so the
/// carrier publishes only the stream origin and never replays the table.
fn payload_object(url: &Url) -> Value {
    json!({ "streamBaseUrl": url.origin().unicode_serialization() })
}

/// Publish the readiness payload to the current document.
///
/// The initialization script resolves its deferred from the carried global, so publishing
/// both covers a document that is still loading and one that already ran its scripts.
fn inject_payload(window: &WebviewWindow, payload: &Value) {
    if !payload.is_object() {
        return;
    }
    let literal = serde_json::to_string(payload).unwrap_or_else(|_| "null".to_string());
    let script = format!(
        "globalThis.__DSH_ALPHA_PAYLOAD__ = {literal}; globalThis.__DSH_ALPHA_READY__?.resolve({literal});"
    );
    let _ = window.eval(script);
}

/// Wait until the engine URL accepts a TCP connection.
fn engine_answers(url: &Url) -> bool {
    let host = url.host_str().unwrap_or("127.0.0.1");
    let port = url.port_or_known_default().unwrap_or(80);
    let deadline = Instant::now() + Duration::from_millis(ENGINE_PROBE_TIMEOUT_MS);
    while Instant::now() < deadline {
        if TcpStream::connect((host, port)).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(ENGINE_PROBE_INTERVAL_MS));
    }
    false
}

/// Report a startup failure from a host-reader thread on the main thread.
fn report_fatal_async(handle: &AppHandle, message: String) {
    let reporter = handle.clone();
    let _ = handle.run_on_main_thread(move || report_fatal(&reporter, &message));
}

/// Present a fatal startup error on the loader page and through a native dialog.
fn report_fatal(handle: &AppHandle, message: &str) {
    eprintln!("alpha: {message}");
    let _ = handle.emit(FATAL_EVENT, message.to_string());
    handle
        .dialog()
        .message(message.to_string())
        .title("Alpha")
        .buttons(MessageDialogButtons::Ok)
        .show(|_accepted| {
            // Nothing recovers a dead engine, so the shell exits once the error is read.
            std::process::exit(1);
        });
}

/// Stop the host with a graceful handoff, escalating only when it does not exit in time.
fn stop_current_host(handle: &AppHandle) {
    let Some(state) = handle.try_state::<HostState>() else {
        return;
    };
    let Some(mut host) = state.0.lock().ok().and_then(|mut slot| slot.take()) else {
        return;
    };
    let _ = host.stdin.write_all(b"{\"type\":\"shutdown\"}\n");
    let _ = host.stdin.flush();
    drop(host.stdin);
    let start = Instant::now();
    loop {
        match host.child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) => {
                if start.elapsed() >= Duration::from_millis(HOST_GRACE_MS) {
                    let _ = host.child.kill();
                    let _ = host.child.wait();
                    return;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(_) => return,
        }
    }
}

/// Rust target triple for the current build; matches the Tauri sidecar file suffix.
fn target_triple() -> &'static str {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        "aarch64-apple-darwin"
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        "x86_64-apple-darwin"
    }
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        "x86_64-pc-windows-msvc"
    }
    #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
    {
        "aarch64-pc-windows-msvc"
    }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        "x86_64-unknown-linux-gnu"
    }
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        "aarch64-unknown-linux-gnu"
    }
    // `cargo check` on a host the shell does not ship for still needs a value.
    #[cfg(not(any(
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "x86_64"),
        all(target_os = "windows", target_arch = "x86_64"),
        all(target_os = "windows", target_arch = "aarch64"),
        all(target_os = "linux", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "aarch64"),
    )))]
    {
        "unknown"
    }
}
