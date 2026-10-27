//! Throwaway probe for the child-webview move path. `cargo run --bin geomprobe`.

use std::time::Duration;

use tauri::{
    Manager, PhysicalPosition, PhysicalSize, WebviewBuilder, WebviewUrl, WebviewWindowBuilder,
};

/// Print one AppKit view and its whole subtree.
///
/// # Safety
/// Runs on the main thread with a live AppKit.
unsafe fn dump(label: &str, view: &objc2_app_kit::NSView, depth: usize) {
    let frame = view.frame();
    println!(
        "PROBE tree {}{label} class={} frame=({:.1},{:.1},{:.1},{:.1})",
        "  ".repeat(depth),
        view.class().name().to_string_lossy(),
        frame.origin.x,
        frame.origin.y,
        frame.size.width,
        frame.size.height
    );
    let subs = view.subviews();
    for index in 0..subs.count() {
        let sub = subs.objectAtIndex(index);
        unsafe { dump(&format!("sub{index}"), &sub, depth + 1) };
    }
}

/// Walk the application's windows and report every view frame.
fn dump_tree() {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSApplication;
    let Some(mtm) = MainThreadMarker::new() else { return };
    let app = NSApplication::sharedApplication(mtm);
    let windows = app.windows();
    if let Some(window) = windows.firstObject() {
        let frame = window.frame();
        println!(
            "PROBE tree window frame=({:.1},{:.1},{:.1},{:.1})",
            frame.origin.x, frame.origin.y, frame.size.width, frame.size.height
        );
        if let Some(content) = window.contentView() {
            unsafe { dump("contentView", &content, 1) };
        }
    }
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let page: tauri::Url = "https://example.com/".parse().expect("url");
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(page))
                .title("Probe")
                .inner_size(1280.0, 800.0)
                .build()
                .expect("window");
            std::thread::sleep(Duration::from_millis(1200));
            let host = app.get_window("main").expect("window");
            let page: tauri::Url = "https://example.com/".parse().expect("url");
            let child = host
                .add_child(
                    WebviewBuilder::new("probe-child", WebviewUrl::External(page)),
                    PhysicalPosition::new(200, 600),
                    PhysicalSize::new(600, 400),
                )
                .expect("child");
            std::thread::sleep(Duration::from_millis(800));
            println!("PROBE created bounds={:?}", child.bounds());
            dump_tree();
            // The shell's move path: set_position + set_size, both logical (200, 600) / (200, 100).
            child
                .set_position(PhysicalPosition::new(400, 1200))
                .expect("set_position");
            child.set_size(PhysicalSize::new(400, 200)).expect("set_size");
            std::thread::sleep(Duration::from_millis(800));
            println!("PROBE moved bounds={:?}", child.bounds());
            dump_tree();
            let _ = window;
            std::process::exit(0);
        })
        .run(tauri::generate_context!())
        .expect("probe run");
}
