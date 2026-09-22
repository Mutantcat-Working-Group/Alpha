//! Tauri shell that boots the bundled dsh Web host and shows it in a native window.
//!
//! The host is a Node sidecar launched without a child-process IPC channel, so it reports
//! readiness and accepts commands as newline-delimited JSON on stdout and stdin. This shell
//! keeps its loader page visible until the host's HTTP server answers, then navigates the
//! window to the authenticated engine URL and hands the Web client the boot payload the
//! readiness event carried. A host that dies before answering leaves the loader visible and
//! reports the cause instead of an empty window.
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
//! Once the first engine is up, a watchdog supervises the engine for the rest of the session.
//! It watches the host process, probes the engine's request loop, and replaces the host when
//! either stops answering, so a machine that was suspended or had its lid closed never leaves
//! the window on a document that can no longer talk to anything.

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

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::path::BaseDirectory;
use tauri::webview::PageLoadEvent;
use tauri::webview::PageLoadPayload;
use tauri::{
    AppHandle, Emitter, Event, Listener, Manager, RunEvent, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
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
/// Wall-clock lead over elapsed monotonic time that reports a suspended machine.
const WAKE_GAP_MS: u64 = 20_000;
/// Restarts the watchdog allows before it concedes and surfaces the failure.
const MAX_HOST_RESTARTS: u32 = 4;
/// Window event through which the Web client reports a failed boot to the shell.
const BOOT_FAILED_EVENT: &str = "alpha-boot-failed";
/// Window event the loader page observes for startup failures.
const FATAL_EVENT: &str = "alpha-fatal";

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
/// event so the shell can present them outside the Web page.
const BOOT_BRIDGE: &str = r#"(() => {
  const resolved = Promise.withResolvers();
  const global = globalThis;
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

/// Boot payload handed to the Web client; written by the host reader before navigation.
type BootPayload = Arc<Mutex<Option<Value>>>;

/// One host event the stdout reader forwards to the thread that booted it.
enum HostReport {
    /// Host reported readiness with its authenticated URL and boot payload.
    Ready { url: String, injections: Option<Value> },
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
    injections: Option<Value>,
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
        .setup(|app| {
            app.manage(HostState::default());
            app.manage(Supervision::default());
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
/// Bundled applications carry the sidecar as plain `node`; a development build
/// keeps the target-triple suffix in the target directory.
fn node_sidecar() -> Result<PathBuf, String> {
    let executable = std::env::current_exe()
        .map_err(|error| format!("Alpha could not locate its executable: {error}"))?;
    let directory = executable
        .parent()
        .ok_or_else(|| "Alpha could not resolve its install directory.".to_string())?;
    let mut candidates = vec![directory.join("node")];
    let mut suffixed = directory.join(format!("node-{}", target_triple()));
    if cfg!(target_os = "windows") {
        suffixed.set_extension("exe");
    }
    candidates.push(suffixed);
    if let Some(found) = candidates.iter().find(|candidate| candidate.exists()) {
        return Ok(found.clone());
    }
    Err(format!(
        "Alpha could not locate its Node runtime at {}",
        candidates.last().map(|path| path.display().to_string()).unwrap_or_default()
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
    .initialization_script(BOOT_BRIDGE)
    // A document loaded after the first navigation still needs the payload the shell holds,
    // because the initialization script alone only sees one carried into that document.
    .on_page_load(move |loaded: WebviewWindow, page: PageLoadPayload<'_>| {
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
        let message = serde_json::from_str::<HostEvent>(event.payload())
            .ok()
            .and_then(|reported| reported.message)
            .unwrap_or_else(|| "Alpha could not start its engine.".to_string());
        let reporter = failure_handle.clone();
        failure_handle.run_on_main_thread(move || report_fatal(&reporter, &message)).ok();
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
    let (url, injections) = await_ready(&reports)?;
    let held = payload.lock().ok().and_then(|slot| slot.clone()).or(injections);
    let Some(held) = held else {
        return Err("Alpha engine readiness carried no boot payload.".to_string());
    };
    let target = url.clone();
    let navigator = window.clone();
    let reporter = handle.clone();
    let slot = Arc::clone(payload);
    // Navigation owns the window, so the payload is published from the main thread.
    let _ = handle.run_on_main_thread(move || {
        if let Err(message) = navigate_engine(&navigator, target, &slot, Some(&held)) {
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
                        injections: event.injections.clone(),
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
/// @returns The engine URL and boot payload, or the failure the host reported.
fn await_ready(reports: &Receiver<HostReport>) -> Result<(Url, Option<Value>), String> {
    match reports.recv_timeout(Duration::from_millis(HOST_BOOT_TIMEOUT_MS)) {
        Ok(HostReport::Ready { url, injections }) => {
            let parsed = Url::parse(&url)
                .map_err(|_| "Alpha engine reported an unreadable URL.".to_string())?;
            Ok((parsed, injections))
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
/// the two clocks running apart, and the window is navigated back to the engine once it
/// answers, because the document the Web client holds froze with the machine.
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
    let mut mono = Instant::now();
    let mut wall = SystemTime::now();
    // The flag records that the shell is exiting, so supervision runs until it is set.
    while !supervision.0.load(Ordering::Relaxed) {
        std::thread::sleep(Duration::from_millis(WATCHDOG_INTERVAL_MS));
        if supervision.0.load(Ordering::Relaxed) {
            break;
        }
        let slept = slept_since(&mut mono, &mut wall);
        if host_running(&handle) && engine_healthy(&url) {
            failures = 0;
            if slept {
                revive(&handle, &window, &url);
            }
            continue;
        }
        // A host that outlived a suspension may answer only once the machine finished
        // waking, so one failed probe after a wake is tolerated before the engine is
        // replaced and a running session is interrupted for nothing.
        if slept && host_running(&handle) {
            continue;
        }
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
    injections: Option<&Value>,
) -> Result<(), String> {
    // The engine document is a different origin from the loader, so the payload cannot
    // travel with the navigation: publishing it in the shared slot lets the page-load
    // hook carry it into every document that loads after readiness.
    let object = payload_object(injections, &url);
    if let Ok(mut slot) = payload.lock() {
        *slot = Some(object.clone());
    }
    inject_payload(window, &object);
    if !engine_answers(&url) {
        return Err("Alpha could not reach its engine after it reported readiness.".to_string());
    }
    if let Err(error) = window.navigate(url) {
        return Err(format!("Alpha could not open its engine: {error}"));
    }
    Ok(())
}

/// Shape the readiness payload the Web client consumes for boot.
fn payload_object(payload: Option<&Value>, url: &Url) -> Value {
    match payload {
        Some(injections) => json!({
            "injections": injections,
            "streamBaseUrl": url.origin().unicode_serialization(),
        }),
        None => Value::Null,
    }
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
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        "x86_64-unknown-linux-gnu"
    }
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        "aarch64-unknown-linux-gnu"
    }
}
