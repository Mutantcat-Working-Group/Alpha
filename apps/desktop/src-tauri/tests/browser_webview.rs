//! Opt-in macOS WebKit regression using an owned loopback server and native window.

#[cfg(target_os = "macos")]
#[path = "../src/browser_webview.rs"]
mod browser_webview;

#[cfg(target_os = "macos")]
mod macos {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{mpsc, Arc, Mutex};
    use std::time::Duration;

    use serde_json::{json, Value};
    use tauri::{Manager, Webview, WebviewBuilder, WebviewUrl, WebviewWindowBuilder};

    const WAIT: Duration = Duration::from_secs(15);
    const CARRIER: &str = r#"<!doctype html><title>Alpha browser regression</title>
<style>body{margin:0}#toolbar{position:absolute;top:38px;height:38px}#carrier{position:absolute;left:60vw;right:0;top:76px;bottom:0}</style>
<div id="toolbar">Browser toolbar</div><div id="carrier"></div>"#;
    const DOCUMENT: &str = r#"<!doctype html><title>Native browser fixture</title>
<h1>Native browser fixture</h1><input id="query"><a href="/next">Next page</a>"#;

    fn evaluate(webview: &Webview, script: &str) -> Value {
        let (send, receive) = mpsc::channel();
        webview
            .eval_with_callback(script, move |value| {
                let _ = send.send(value);
            })
            .unwrap();
        serde_json::from_str(&receive.recv_timeout(WAIT).expect("JavaScript callback")).unwrap()
    }

    fn carrier(main: &Webview) -> Value {
        evaluate(
            main,
            "document.querySelector('#carrier').getBoundingClientRect().toJSON()",
        )
    }

    fn placement(
        app: &tauri::AppHandle,
        rect: &Value,
    ) -> (tauri::PhysicalPosition<i32>, tauri::PhysicalSize<u32>) {
        super::browser_webview::placement(
            app,
            rect["x"].as_f64().unwrap(),
            rect["y"].as_f64().unwrap(),
            rect["width"].as_f64().unwrap(),
            rect["height"].as_f64().unwrap(),
        )
        .unwrap()
    }

    fn observe(child: &Webview, rect: &Value, bottom: f64) -> Value {
        let (send, receive) = mpsc::channel();
        child
            .with_webview(move |native| {
                // Tauri runs this callback on AppKit's main thread while the view is live.
                let view = unsafe { &*(native.inner() as *const objc2_app_kit::NSView) };
                let frame = view.frame();
                let _ = send.send((frame.origin.y, frame.size.width, frame.size.height));
            })
            .unwrap();
        let (actual_bottom, width, height) = receive.recv_timeout(WAIT).unwrap();
        eprintln!("native bottom={actual_bottom}, expected={bottom}, size={width}x{height}, carrier={rect}");
        json!({
            "bottomAligned": (actual_bottom - bottom).abs() <= 1.0,
            "widthMatches": (width - rect["width"].as_f64().unwrap()).abs() <= 1.0,
            "heightMatches": (height - rect["height"].as_f64().unwrap()).abs() <= 1.0,
        })
    }

    pub fn run() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let user_agent = Arc::new(Mutex::new(String::new()));
        let request_agent = user_agent.clone();
        let server = std::thread::spawn(move || {
            for incoming in listener.incoming() {
                let mut stream = incoming.unwrap();
                stream.set_read_timeout(Some(WAIT)).unwrap();
                let mut request = Vec::new();
                let mut buffer = [0; 4096];
                while !request.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
                    let count = stream.read(&mut buffer).unwrap_or(0);
                    if count == 0 {
                        break;
                    }
                    request.extend_from_slice(&buffer[..count]);
                }
                let request = String::from_utf8_lossy(&request);
                if request.starts_with("GET /stop ") {
                    break;
                }
                let document = request.starts_with("GET /document ");
                if document {
                    *request_agent.lock().unwrap() = request
                        .lines()
                        .find(|line| line.to_ascii_lowercase().starts_with("user-agent:"))
                        .unwrap_or_default()
                        .to_string();
                }
                let body = if document { DOCUMENT } else { CARRIER };
                let response = format!("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                let _ = stream.write_all(response.as_bytes());
            }
        });
        let (complete, result) = mpsc::channel();
        tauri::Builder::default()
            .setup(move |app| {
                let (ready, loaded) = mpsc::channel();
                WebviewWindowBuilder::new(app, "main", WebviewUrl::External(format!("http://{address}/").parse().unwrap()))
                    .title("Alpha browser regression")
                    .inner_size(900.0, 600.0)
                    .on_page_load(move |_, page| {
                        if page.event() == tauri::webview::PageLoadEvent::Finished { let _ = ready.send(()); }
                    })
                    .build()?;
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        loaded.recv_timeout(WAIT).expect("main document loaded");
                        let main = handle.get_webview("main").unwrap();
                        let window = handle.get_window("main").unwrap();
                        let rect = carrier(&main);
                        let (position, size) = placement(&handle, &rect);
                        let (ready, loaded) = mpsc::channel();
                        let child = super::browser_webview::add_child(
                            &window,
                            WebviewBuilder::new("browser-fixture", WebviewUrl::External(format!("http://{address}/document").parse().unwrap()))
                                .on_page_load(move |_, page| {
                                    if page.event() == tauri::webview::PageLoadEvent::Finished { let _ = ready.send(()); }
                                }),
                            position, size,
                        ).unwrap();
                        loaded.recv_timeout(WAIT).expect("browser document loaded");
                        let initial = observe(&child, &rect, 0.0);
                        let page = evaluate(&child, "({title:document.title,inputWritable:(document.querySelector('#query').value='typed')==='typed'})");
                        evaluate(&main, "document.querySelector('#carrier').style.cssText='top:116px;bottom:20px;left:50vw'");
                        let rect = carrier(&main);
                        let (position, size) = placement(&handle, &rect);
                        child.set_position(position).unwrap();
                        child.set_size(size).unwrap();
                        let moved = observe(&child, &rect, 20.0);
                        let (resized, resize) = mpsc::channel();
                        window.on_window_event(move |event| {
                            if matches!(event, tauri::WindowEvent::Resized(_)) { let _ = resized.send(()); }
                        });
                        window.set_size(tauri::LogicalSize::new(1100.0, 750.0)).unwrap();
                        resize.recv_timeout(WAIT).expect("window resized");
                        let rect = carrier(&main);
                        let (position, size) = placement(&handle, &rect);
                        child.set_position(position).unwrap();
                        child.set_size(size).unwrap();
                        let resized = observe(&child, &rect, 20.0);
                        let agent = user_agent.lock().unwrap().clone();
                        let snapshot = json!({"initial":initial,"moved":moved,"resized":resized,"page":page,
                            "request":{"safariCompatible":agent.contains(" Safari"),"branded":agent.contains("Alpha/")}});
                        println!("{}", serde_json::to_string_pretty(&snapshot).unwrap());
                        let expected: Value = serde_json::from_str(include_str!("../../tests/expected/browser-webview.json")).unwrap();
                        assert_eq!(snapshot, expected);
                        child.close().unwrap();
                    }));
                    let _ = complete.send(outcome.is_ok());
                    handle.exit(0);
                });
                Ok(())
            })
            .build(tauri::generate_context!())
            .unwrap()
            .run_return(|_, _| {});
        let mut stop = std::net::TcpStream::connect(address).unwrap();
        stop.write_all(b"GET /stop HTTP/1.1\r\n\r\n").unwrap();
        server.join().unwrap();
        assert!(
            result.recv_timeout(WAIT).unwrap(),
            "native browser snapshot failed"
        );
    }
}

fn main() {
    if !std::env::args().any(|argument| argument == "--run") {
        println!("Native browser regression requires a macOS desktop; pass -- --run to execute.");
        return;
    }
    #[cfg(target_os = "macos")]
    macos::run();
    #[cfg(not(target_os = "macos"))]
    panic!("native browser regression requires macOS");
}
