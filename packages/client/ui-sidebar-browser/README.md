---
description: "Right-Sidebar browser tabs for sandboxed HTTP(S) pages, including loopback services."
kind: "package-reference"
---

# @mutantcat/dsh-client-ui-sidebar-browser

English | [中文](README.zh.md)

## Summary

Browse HTTP(S) pages, including loopback services, inside independent right-Sidebar tabs. Web and Desktop both keep application-managed history. Web renders every page in an iframe; Desktop renders a page the shell can host in a native child webview instead and returns to the iframe when the shell refuses. The package never injects Desktop-native or Node access into visited content.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The shipped Web and Desktop compositions already mount this package. Open **Browser** from the right-Sidebar guide, enter an HTTP(S) URL, or select an HTTP(S) link in Assistant Markdown. A host name without a scheme becomes HTTPS. Public and loopback targets use the same default sandbox. Each guide action or message-link activation creates another Browser tab.

### When to choose it

Choose Browser for a Web page that should remain beside the current Session. Choose [Document Preview](../ui-sidebar-documentpreview/README.md) for local files, and use the explicit external-browser action when a site needs browser capabilities this package withholds or, in Web, refuses iframe embedding.

### Minimal configuration

The package has no configuration. A custom Web composition mounts its Host companion; the Client loader then discovers the browser entry declared by the package manifest:

```yaml
- id: ui-sidebar-browser
  name: '@mutantcat/dsh-client-ui-sidebar-browser'
```

Client plugins can open a tab through `ctx.sidebarRight.openTab('browser', { params: { url } })`. The optional URL passes the same validation as address-bar input before navigation.

The toolbar provides Back, Forward, Reload, Go, Open in system browser, a per-tab sandbox toggle, and a component-picking button. Disabling the sandbox is temporary and displays a warning. The external action accepts a known HTTP(S) target. The tab title is the Web host. The sandbox toggle is unavailable while the Desktop native carrier holds the document, because the iframe `sandbox` attribute does not apply to that carrier.

### Component picking (Desktop)

Desktop enables the component-picking button for a loaded page; Web leaves it disabled, because an iframe cannot read a cross-origin document. Starting the mode places a native child view over the page. Moving the pointer outlines the element under it; clicking one leaves the mode and attaches a plain-text document to the current composer. Escape or a right-click leaves the mode without attaching anything. The document records the page URL and title, tag, XPath, CSS selector, DOM depth, sibling index, parent chain, bounding rectangle, attributes, selected computed styles, visible text, and outer HTML. The picker measures whichever carrier holds the page, so it works over the native child webview as well as over the iframe.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Protocol policy

The address parser accepts HTTP and HTTPS, including loopback targets. It rejects `file:` URLs, script/data/blob input, embedded credentials, the DSH application origin, and malformed addresses. Document Preview owns local-file rendering.

### Iframe carrier

The iframe carrier applies `sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox"` by default. The frame has no direct download or top-navigation flag. Popups leave the sandbox; in Web, an escaped popup retains its opener and can navigate the top-level application. The visited origin can use its own cookies and Web storage but a cross-origin target cannot read DSH DOM, storage, or API responses. The iframe sends no referrer and adds no package-owned Permissions Policy, so browser defaults and user grants apply. The toolbar can remove the sandbox for the current tab occurrence; the choice is not persisted. An unsandboxed page can navigate the top-level application under browser activation rules and use downloads, modal dialogs, and input locks. The package does not proxy or probe remote pages.

Web records toolbar submissions and typed tab opens. A navigation state machine treats the first iframe load for each controlled revision as known and a later load as proof that the page changed to an unreadable URL. In that unknown state the address is marked, Back, Forward, and external-open are disabled, and Reload returns to the last controlled URL. A remounted body reloads the latest application-known URL and uses its optional initial URL only before the first controlled target. History API and fragment changes that emit no iframe load remain invisible. An iframe `error` event displays a transient load-failure notice until the next controlled load without changing URL history.

### Native carrier (Desktop)

Desktop renders the current document in a native child webview when the shell exposes the browser-document bridge. The body replaces the iframe with a placeholder div, reports that rectangle to the shell, and keeps it current through a `ResizeObserver` and the window resize event; closing the tab occurrence closes the child webview. A top-level child webview is not subject to `X-Frame-Options` or a CSP `frame-ancestors` directive, so a page that refuses iframe embedding still renders.

The shell reports each completed navigation as a load for the revision the carrier holds, and the same navigation state machine consumes that report. A page-initiated popup is denied at the shell and reported with its target URL, which the client opens through `window.open`. The carrier keeps no page identity across a body remount, isolates no cookies per tab, and exposes no debugging target. When the shell refuses to open the carrier, the document returns to the iframe.

### Controller

Each tab receives one `BrowserController` class. Its public commands are `loadUrl`, `goBack`, `goForward`, and `reload`; address validation and history mutation stay behind that object. Its `BrowserNavigation` class owns the serializable URL state machine. The `BrowserFrame` interface owns transient sandbox and document state plus carrier operations, and `IframeImpl` implements that interface for the current iframe carrier. Slot injection exposes keyed frame state through `useBrowserFrame` and supplies plain callbacks, so the React body receives neither the controller nor an observable source; it keeps only the editable draft and the DOM node that holds the page.

The controller interface does not depend on iframe APIs. `openNativeDocument`, `moveNativeDocument`, and `closeNativeDocument` address the Desktop carrier through the shell bridge, and a refused open marks the frame so the body returns that document to the iframe. The per-tab native view object that would own attachment, detachment, and target identity remains deferred and is documented in the same Sidebar Browser decision.

### Component picker carrier

Component picking reads the page outside the iframe. The toolbar reports the iframe rectangle to the native shell, which opens one temporary child webview at that position, injects the picker script, and closes the child once the result arrives. A picked element reports through a private navigation origin that the shell intercepts before the URL commits, and the encoded document reaches the Web client as an event. The Web client then asks `IConversation.attachTextDocument` to admit the document as a composer attachment. `BrowserFrame` carries the picker mode beside the sandbox and document state.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Right Sidebar](../../../docs/subsystems/sidebar-right.md) — tab composition, navigation, and lifecycle.
- [Document Preview](../ui-sidebar-documentpreview/README.md) — local source, Markdown, images, HTML, and PDF rendering.
- [Sidebar Browser decision](../../../.agents/notes/implemented/feature/2026-09-16-sidebar-browser.md) — current iframe behavior, controller ownership, and deferred native carrier work.

-----

<a id="model-experience"></a>
## Model Experience

None, as Browser tabs are user-facing presentation state and register no tool, prompt section, or Session event.

#### KV Cache effect

None; browsing does not enter a model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The isolation policy deliberately gives up some browser compatibility:

- In Web, many sites refuse iframe embedding or need downloads or top-level navigation withheld from the frame by the default sandbox. An HTTPS application can also block public HTTP pages as mixed content. Disabling the sandbox trades its restrictions for compatibility but does not bypass mixed-content or private-network policy. The unsandboxed frame can navigate the top-level application under browser activation rules and use downloads, modal dialogs, and input locks. It does not isolate the visited origin's cookies per Browser tab or prevent an in-frame page from choosing its own next URL.
- In Web, a popup that escapes the sandbox retains its opener and can use that chain to navigate the top-level application. Desktop handles popup creation separately.
- A later iframe load reveals that navigation occurred but not the new cross-origin URL. History API and fragment changes may remain invisible; Web Back and Forward are unavailable after the state becomes unknown.
- Browsers conceal many iframe failures for security: DNS, TLS, mixed-content, CSP, and `X-Frame-Options` failures may emit `load` or no actionable event instead of `error`. The load-failure notice is best-effort.
- Browser history survives body remounts and ordinary page reloads, but closing the tab or unloading `ui-sidebar-right` aborts its occurrence and removes the stored history bucket.
- Local files are rejected and remain owned by Document Preview.
- Component picking is Desktop-only, and it describes the picked page's top document: content inside a nested frame or shadow root is reported through the element that hosts it. Web shows the button disabled.
- The Desktop native carrier is one child webview per tab occurrence, so it keeps no page identity across a body remount, isolates no cookies per tab, and exposes no debugging target. Per-tab cookie partitions, native history, and a target-specific CDP connection remain deferred, as does the per-tab native view object that would own attachment, detachment, and target identity; component picking uses its own temporary child webview, which closes with the mode.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. `BrowserNavigation` is the sole URL-state writer; the store receives its immutable snapshots, and focused controller and component tests exercise publication and cleanup directly.
