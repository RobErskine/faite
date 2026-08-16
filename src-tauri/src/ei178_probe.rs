//! EI-178 spike probe — background-sync timer mitigation, NOT production code.
//!
//! Runs only when `FAITE_EI178_PROBE=1` is set. Follow-up to D0's
//! `d0_probe.rs` finding that a hidden (`visible: false`) `WebviewWindow`'s
//! JS `setInterval` fires once and then never again. This probe tests three
//! candidate mitigations from the D2 spike (Linear EI-178) in a single run,
//! plus an optional second axis (`FAITE_EI178_NSACTIVITY=1`) that wraps the
//! whole run in an `NSProcessInfo` activity token to test whether App-Nap
//! opt-out (vs. per-window WebKit occlusion suspension) is the mechanism:
//!
//!   - `hidden_js`          — visible:false, JS `setInterval` (control,
//!                            replicates D0 §3.4).
//!   - `hidden_rust_eval`   — visible:false, NO JS timer. A Rust
//!                            `std::thread` loop calls `window.eval()` into
//!                            it every `TICK_MS` for the run duration. This
//!                            is the direct test of open question #1: does
//!                            `eval()` reach a suspended/hidden webview?
//!   - `offscreen_visible`  — visible:true but positioned far off-screen,
//!                            JS `setInterval`. Tests whether "visible but
//!                            occluded" avoids the suspension `visible:
//!                            false` triggers.
//!   - `minimized`          — visible:true then `.minimize()`d (AppKit
//!                            miniaturize, a different code path than
//!                            `.hide()`), JS `setInterval`.
//!
//! Results stream out via the same throwaway localhost-POST pattern D0 used
//! (`d0_probe.rs`'s doc comment explains why: avoids Tauri command/ACL
//! plumbing for a one-off harness) into `../ei178-probe-results.jsonl`.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};

const REPORT_PORT: u16 = 8798;
const TICK_MS: u64 = 4000;
const TOTAL_RUN_SECS: u64 = 100;

fn init_script(label: &str) -> String {
    format!(
        r#"
window.__EI178_LABEL__ = "{label}";
window.__ei178report = function(kind, data) {{
  try {{
    fetch("http://127.0.0.1:{port}/report", {{
      method: "POST",
      mode: "no-cors",
      headers: {{ "Content-Type": "text/plain" }},
      body: JSON.stringify({{ kind: kind, data: data, at: Date.now(), label: window.__EI178_LABEL__ }})
    }}).catch(function (e) {{}});
  }} catch (e) {{}}
}};
window.__ei178report("page_load", {{ visibilityState: document.visibilityState, hidden: document.hidden }});
"#,
        label = label,
        port = REPORT_PORT
    )
}

/// Self-scheduled JS timer — the mechanism D0 found dies after one tick in
/// a hidden window. Armed once via `.eval()` after the window is created.
const JS_TIMER: &str = r#"
(function () {
  var count = 0;
  var start = Date.now();
  window.__ei178report("timer_start", { visibilityState: document.visibilityState, hidden: document.hidden });
  setInterval(function () {
    count++;
    window.__ei178report("timer_tick", {
      count: count,
      elapsedMs: Date.now() - start,
      visibilityState: document.visibilityState,
      hidden: document.hidden
    });
  }, 4000);
})();
"#;

/// Arms the counter state `hidden_rust_eval` uses; the increments themselves
/// are driven entirely from Rust (see `rust_tick_js` + the eval loop in
/// `run`), not from any JS-side timer.
const JS_RUST_TICK_INIT: &str = r#"
window.__ei178_rust_tick_count = 0;
window.__ei178_rust_tick_start = Date.now();
window.__ei178report("rust_tick_armed", { visibilityState: document.visibilityState, hidden: document.hidden });
"#;

fn rust_tick_js() -> String {
    r#"(function () {
  window.__ei178_rust_tick_count = (window.__ei178_rust_tick_count || 0) + 1;
  window.__ei178report("rust_eval_tick", {
    count: window.__ei178_rust_tick_count,
    elapsedMs: Date.now() - (window.__ei178_rust_tick_start || Date.now()),
    visibilityState: document.visibilityState,
    hidden: document.hidden
  });
})();"#
        .to_string()
}

fn results_path() -> PathBuf {
    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("../ei178-probe-results.jsonl")
}

/// Same dead-simple localhost report server as `d0_probe.rs`, on a
/// different port so a stray D0 probe process can never collide with this
/// one.
fn start_report_server() {
    let path = results_path();
    let _ = std::fs::remove_file(&path);
    std::thread::spawn(move || {
        let listener = match TcpListener::bind(("127.0.0.1", REPORT_PORT)) {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[ei178-probe] failed to bind report server: {e}");
                return;
            }
        };
        for stream in listener.incoming().flatten() {
            let path = path.clone();
            std::thread::spawn(move || {
                if let Err(e) = handle_report_conn(stream, &path) {
                    eprintln!("[ei178-probe] report conn error: {e}");
                }
            });
        }
    });
}

fn handle_report_conn(mut stream: std::net::TcpStream, path: &PathBuf) -> std::io::Result<()> {
    let mut buf = [0u8; 8192];
    let mut data: Vec<u8> = Vec::new();
    loop {
        let n = stream.read(&mut buf)?;
        if n == 0 {
            break;
        }
        data.extend_from_slice(&buf[..n]);
        let text = String::from_utf8_lossy(&data);
        if let Some(idx) = text.find("\r\n\r\n") {
            let headers = &text[..idx];
            let body_len_so_far = data.len() - (idx + 4);
            let content_length = headers
                .lines()
                .find_map(|l| {
                    let lower = l.to_ascii_lowercase();
                    lower.starts_with("content-length").then(|| {
                        l.split(':').nth(1).unwrap_or("0").trim().parse::<usize>().unwrap_or(0)
                    })
                })
                .unwrap_or(0);
            if body_len_so_far >= content_length {
                break;
            }
        }
    }
    let text = String::from_utf8_lossy(&data).to_string();
    if let Some(idx) = text.find("\r\n\r\n") {
        let body = text[idx + 4..].trim().to_string();
        if !body.is_empty() {
            if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
                let _ = writeln!(f, "{body}");
            }
            println!("[ei178-probe] {body}");
        }
    }
    let _ = stream.write_all(
        b"HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
    );
    Ok(())
}

fn elapsed(start: std::time::Instant) -> String {
    format!("{:.2}s", start.elapsed().as_secs_f64())
}

/// macOS-only: opt the whole process out of App Nap for the run, via
/// `NSProcessInfo.beginActivityWithOptions(_:reason:)`. Returns the token —
/// callers must hold it for as long as the opt-out should last; dropping it
/// lets App Nap resume (per Apple's docs and lapcatsoftware.com's writeup,
/// both cited in the spike doc).
#[cfg(target_os = "macos")]
fn begin_ns_activity() -> objc2::rc::Retained<objc2::runtime::ProtocolObject<dyn objc2_foundation::NSObjectProtocol>> {
    use objc2_foundation::{NSActivityOptions, NSProcessInfo, NSString};
    let info = NSProcessInfo::processInfo();
    let reason = NSString::from_str("EI-178 background-sync timer spike probe");
    info.beginActivityWithOptions_reason(NSActivityOptions::UserInitiated, &reason)
}

pub fn run(app: &AppHandle) {
    let ns_activity_requested = std::env::var("FAITE_EI178_NSACTIVITY").is_ok();
    start_report_server();
    println!("[ei178-probe] report server listening on 127.0.0.1:{REPORT_PORT}");
    println!("[ei178-probe] results file: {}", results_path().display());
    println!("[ei178-probe] ns_activity_requested={ns_activity_requested}");

    let handle = app.clone();
    std::thread::spawn(move || {
        let t0 = std::time::Instant::now();

        #[cfg(target_os = "macos")]
        let _activity_token = if ns_activity_requested {
            let token = begin_ns_activity();
            println!("[ei178-probe][rust t={}] NSActivity begun (UserInitiated)", elapsed(t0));
            Some(token)
        } else {
            None
        };

        let win_hidden_js = WebviewWindowBuilder::new(&handle, "hidden_js", WebviewUrl::App("probe.html".into()))
            .title("EI178 hidden + JS timer")
            .inner_size(300.0, 200.0)
            .visible(false)
            .initialization_script(init_script("hidden_js"))
            .build()
            .expect("create window hidden_js");

        let win_hidden_rust = WebviewWindowBuilder::new(&handle, "hidden_rust_eval", WebviewUrl::App("probe.html".into()))
            .title("EI178 hidden + Rust eval tick")
            .inner_size(300.0, 200.0)
            .visible(false)
            .initialization_script(init_script("hidden_rust_eval"))
            .build()
            .expect("create window hidden_rust_eval");

        let win_offscreen = WebviewWindowBuilder::new(&handle, "offscreen_visible", WebviewUrl::App("probe.html".into()))
            .title("EI178 offscreen-but-visible + JS timer")
            .inner_size(300.0, 200.0)
            .position(-8000.0, -8000.0)
            .initialization_script(init_script("offscreen_visible"))
            .build()
            .expect("create window offscreen_visible");

        let win_minimized = WebviewWindowBuilder::new(&handle, "minimized", WebviewUrl::App("probe.html".into()))
            .title("EI178 minimized + JS timer")
            .inner_size(300.0, 200.0)
            .position(40.0, 60.0)
            .initialization_script(init_script("minimized"))
            .build()
            .expect("create window minimized");

        println!("[ei178-probe][rust t={}] windows created", elapsed(t0));

        std::thread::sleep(Duration::from_secs(1));
        let _ = win_minimized.minimize();
        println!("[ei178-probe][rust t={}] minimized window miniaturized", elapsed(t0));

        std::thread::sleep(Duration::from_secs(1));
        let _ = win_hidden_js.eval(JS_TIMER);
        let _ = win_offscreen.eval(JS_TIMER);
        let _ = win_minimized.eval(JS_TIMER);
        let _ = win_hidden_rust.eval(JS_RUST_TICK_INIT);
        println!("[ei178-probe][rust t={}] timers armed on hidden_js / offscreen_visible / minimized; rust_tick armed on hidden_rust_eval", elapsed(t0));

        // Rust-driven ticks into the hidden_rust_eval window for the rest of
        // the run — the direct test of whether `window.eval()` reaches a
        // suspended/hidden webview at all, and how promptly.
        let deadline = t0 + Duration::from_secs(TOTAL_RUN_SECS);
        loop {
            std::thread::sleep(Duration::from_millis(TICK_MS));
            if std::time::Instant::now() >= deadline {
                break;
            }
            let scheduled_at = elapsed(t0);
            match win_hidden_rust.eval(&rust_tick_js()) {
                Ok(_) => println!(
                    "[ei178-probe][rust t={}] eval() dispatched ok (scheduled_at={scheduled_at})",
                    elapsed(t0)
                ),
                Err(e) => println!(
                    "[ei178-probe][rust t={}] eval() FAILED (scheduled_at={scheduled_at}): {e}",
                    elapsed(t0)
                ),
            }
        }

        println!("[ei178-probe][rust t={}] probe sequence complete, exiting", elapsed(t0));
        handle.exit(0);
    });
}
