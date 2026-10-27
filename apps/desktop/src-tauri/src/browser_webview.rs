//! Native placement and construction of browser and component-picker child webviews.

use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, Webview, WebviewBuilder, Window};

/// Convert a CSS carrier rectangle to window-relative physical pixels.
/// On macOS, WebKit insets the main document by the native view's safe area; child
/// webviews use the enclosing content view's coordinates without that inset.
/// @param app - application handle that owns the main window.
/// @param x - carrier rectangle left edge in CSS pixels.
/// @param y - carrier rectangle top edge in CSS pixels.
/// @param width - carrier rectangle width in CSS pixels.
/// @param height - carrier rectangle height in CSS pixels.
/// @returns the physical position and size, or the refusal reason.
pub(crate) fn placement(
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
        return Err("native child webview: rectangle is invalid".to_string());
    }
    let window = app
        .get_window("main")
        .ok_or_else(|| "native child webview: main window unavailable".to_string())?;
    let scale_factor = match window.scale_factor() {
        Ok(scale) if scale.is_finite() && scale > 0.0 => scale,
        _ => 1.0,
    };
    let to_physical = |value: f64| (value * scale_factor).round();
    let (origin_x, origin_y) = viewport_origin(app)?;
    let position = PhysicalPosition::new(
        to_physical(origin_x + x) as i32,
        to_physical(origin_y + y) as i32,
    );
    let size = PhysicalSize::new(
        to_physical(width).max(1.0) as u32,
        to_physical(height).max(1.0) as u32,
    );
    Ok((position, size))
}

/// Read the main document's logical origin in the window's content view.
/// AppKit geometry is accessed only from Tauri's main-thread callback.
#[cfg(target_os = "macos")]
fn viewport_origin(app: &AppHandle) -> Result<(f64, f64), String> {
    let main = app
        .get_webview("main")
        .ok_or_else(|| "native child webview: main webview unavailable".to_string())?;
    let (send, receive) = std::sync::mpsc::channel();
    main.with_webview(move |native| {
        // Tauri keeps the WKWebView alive for this main-thread callback.
        let view = unsafe { &*(native.inner() as *const objc2_app_kit::NSView) };
        let result = unsafe { view.superview() }
            .map(|parent| {
                let frame = view.frame();
                let inset = view.safeAreaInsets();
                let top = if parent.isFlipped() {
                    frame.origin.y
                } else {
                    parent.bounds().size.height - frame.origin.y - frame.size.height
                };
                (frame.origin.x + inset.left, top + inset.top)
            })
            .ok_or_else(|| "native child webview: main view is detached".to_string());
        let _ = send.send(result);
    })
    .map_err(|error| error.to_string())?;
    receive.recv().map_err(|error| error.to_string())?
}

/// Other platforms expose the main document at the content view's origin.
#[cfg(not(target_os = "macos"))]
fn viewport_origin(_app: &AppHandle) -> Result<(f64, f64), String> {
    Ok((0.0, 0.0))
}

/// Attach a browser document to the shell window.
/// The caller runs outside the main thread, as required by Tauri's child creation API.
/// @param window - shell window hosting the document.
/// @param builder - document URL and navigation handlers.
/// @param position - document origin in physical pixels.
/// @param size - document dimensions in physical pixels.
/// @returns the attached child webview, or its creation error.
pub(crate) fn add_child(
    window: &Window,
    builder: WebviewBuilder<tauri::Wry>,
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
) -> Result<Webview, String> {
    #[cfg(target_os = "macos")]
    let builder = {
        let (send, receive) = std::sync::mpsc::channel();
        window
            .run_on_main_thread(move || {
                let main_thread =
                    objc2::MainThreadMarker::new().expect("Tauri main-thread callback");
                // Preserve WebKit's platform/version tokens and append browser compatibility
                // plus product identity. Bare WKWebView UAs trigger HTTPS downgrade pages.
                let configuration =
                    unsafe { objc2_web_kit::WKWebViewConfiguration::new(main_thread) };
                let application = objc2_foundation::NSString::from_str(concat!(
                    "Safari Alpha/",
                    env!("CARGO_PKG_VERSION")
                ));
                unsafe {
                    configuration.setApplicationNameForUserAgent(Some(&application));
                }
                let _ = send.send(builder.with_webview_configuration(configuration));
            })
            .map_err(|error| error.to_string())?;
        receive.recv().map_err(|error| error.to_string())?
    };
    window
        .add_child(builder, position, size)
        .map_err(|error| error.to_string())
}
