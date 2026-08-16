//! D0 spike probe harness — NOT production code.
//!
//! Runs only when `FAITE_D0_PROBE=1` is set in the environment. Opens three
//! webviews against the real static export (`/board.html`) and drives a
//! sequence of JS probes to answer the D0 spike questions:
//!   - does the board render + write to IndexedDB (real Dexie db "faite")
//!   - is IndexedDB / localStorage / BroadcastChannel shared across
//!     `WebviewWindow`s on the same origin
//!   - does a hidden webview keep firing `setInterval` and what does
//!     `document.visibilityState` report
//!   - does a cross-origin fetch/WebSocket to https://myfaite.app work from
//!     `tauri://localhost` with the CSP `connect-src`/`wss:` entries added
//!
//! Results are streamed out via a throwaway localhost HTTP POST (no Tauri
//! command/permission plumbing needed) into `../d0-probe-results.jsonl`
//! (repo root, since this binary's cwd is `src-tauri` under `cargo run`).

use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};

const REPORT_PORT: u16 = 8799;

/// Injected via `initialization_script` so it runs before any page script,
/// on every navigation, in every probe window. Ships results out over a
/// plain `fetch(..., {mode:'no-cors'})` POST — deliberately not using
/// `window.__TAURI__.invoke` so this harness doesn't depend on getting the
/// v2 command-permission ACL right for a throwaway spike.
fn init_script(label: &str) -> String {
    format!(
        r#"
window.__D0_LABEL__ = "{label}";
window.__d0report = function(kind, data) {{
  try {{
    fetch("http://127.0.0.1:{port}/report", {{
      method: "POST",
      mode: "no-cors",
      headers: {{ "Content-Type": "text/plain" }},
      body: JSON.stringify({{ kind: kind, data: data, at: Date.now(), origin: location.origin, label: window.__D0_LABEL__ }})
    }}).catch(function (e) {{}});
  }} catch (e) {{}}
}};
window.addEventListener("securitypolicyviolation", function (e) {{
  window.__d0report("csp_violation", {{ directive: e.violatedDirective, blockedURI: e.blockedURI, sourceFile: e.sourceFile }});
}});
window.__d0report("page_load", {{ readyState: document.readyState, visibilityState: document.visibilityState, hidden: document.hidden }});
document.addEventListener("DOMContentLoaded", function () {{
  window.__d0report("dom_content_loaded", {{
    visibilityState: document.visibilityState,
    title: document.title,
    bodyLen: document.body ? document.body.innerHTML.length : -1,
    bodyPreview: document.body ? document.body.innerHTML.slice(0, 300) : null
  }});
}});
window.addEventListener("load", function () {{
  window.__d0report("window_load", {{
    title: document.title,
    href: location.href,
    bodyLen: document.body ? document.body.innerHTML.length : -1,
    bodyPreview: document.body ? document.body.innerHTML.slice(0, 300) : null
  }});
}});
window.onerror = function (msg, src, line, col, err) {{
  window.__d0report("window_onerror", {{ msg: String(msg), src: src, line: line, col: col, stack: err && err.stack }});
}};
window.addEventListener("unhandledrejection", function (e) {{
  window.__d0report("unhandled_rejection", {{ reason: String(e.reason) }});
}});
"#,
        label = label,
        port = REPORT_PORT
    )
}

const BC_LISTENER_JS: &str = r#"
(function () {
  try {
    var bc = new BroadcastChannel("d0-probe-bc");
    bc.onmessage = function (e) { window.__d0report("bc_b_received", { payload: e.data }); };
    window.__d0_bc_b = bc;
    window.__d0report("bc_listener_ready", { ok: true });
  } catch (e) {
    window.__d0report("bc_listener_ready", { ok: false, error: String(e) });
  }
})();
"#;

const TIMER_JS: &str = r#"
(function () {
  var count = 0;
  var start = Date.now();
  window.__d0report("timer_start", { visibilityState: document.visibilityState, hidden: document.hidden });
  setInterval(function () {
    count++;
    window.__d0report("timer_tick", {
      count: count,
      elapsedMs: Date.now() - start,
      visibilityState: document.visibilityState,
      hidden: document.hidden
    });
  }, 5000);
})();
"#;

// Synthetic cross-window storage probe (separate IDB database from the real
// app, so this can never corrupt real board data) + real-app probe (creates
// an actual to-do through the real "Add a to-do" input and reads it back
// straight out of Dexie's "faite" IndexedDB database).
const WRITE_A_JS: &str = r#"
(async function () {
  try {
    localStorage.setItem("d0_probe_ls", "hello-from-A-" + Date.now());
    var bc = new BroadcastChannel("d0-probe-bc");
    bc.postMessage({ hello: "from-A", ts: Date.now() });
    var dbReq = indexedDB.open("d0-probe-db", 1);
    dbReq.onupgradeneeded = function () { dbReq.result.createObjectStore("probe"); };
    var db = await new Promise(function (res, rej) { dbReq.onsuccess = function () { res(dbReq.result); }; dbReq.onerror = rej; });
    var tx = db.transaction("probe", "readwrite");
    tx.objectStore("probe").put({ from: "A", ts: Date.now() }, "probe-key");
    await new Promise(function (res, rej) { tx.oncomplete = res; tx.onerror = rej; });
    db.close();
    window.__d0report("write_a_synthetic", { ok: true });
  } catch (e) {
    window.__d0report("write_a_synthetic", { ok: false, error: String(e) });
  }
})();
"#;

const CREATE_REAL_TODO_A_JS: &str = r#"
(async function () {
  function findInput() {
    return document.querySelector('input[placeholder="Add a to-do"]');
  }
  try {
    var input = null;
    for (var i = 0; i < 60; i++) {
      input = findInput();
      if (input) break;
      await new Promise(function (r) { setTimeout(r, 200); });
    }
    if (!input) {
      window.__d0report("create_real_todo", {
        ok: false,
        error: "input not found after 12s poll",
        title: document.title,
        readyState: document.readyState,
        bodyLen: document.body ? document.body.innerHTML.length : -1,
        bodyPreview: document.body ? document.body.innerHTML.slice(0, 500) : null
      });
      return;
    }
    var title = "D0 probe todo " + Date.now();
    var proto = Object.getPrototypeOf(input);
    var desc = Object.getOwnPropertyDescriptor(proto, "value");
    desc.set.call(input, title);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
    await new Promise(function (r) { setTimeout(r, 150); });
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await new Promise(function (r) { setTimeout(r, 900); });

    var dbReq = indexedDB.open("faite");
    var db = await new Promise(function (res, rej) { dbReq.onsuccess = function () { res(dbReq.result); }; dbReq.onerror = rej; });
    var storeNames = Array.from(db.objectStoreNames);
    var found = null;
    var total = 0;
    if (storeNames.indexOf("todos") !== -1) {
      var tx = db.transaction("todos", "readonly");
      var all = await new Promise(function (res, rej) {
        var out = [];
        var cur = tx.objectStore("todos").openCursor();
        cur.onsuccess = function (e) {
          var c = e.target.result;
          if (c) { out.push(c.value); c.continue(); } else { res(out); }
        };
        cur.onerror = rej;
      });
      total = all.length;
      found = all.find(function (t) { return t.title === title; }) || null;
    }
    db.close();
    window.__d0report("create_real_todo", {
      ok: !!found,
      title: title,
      totalTodos: total,
      objectStoreNames: storeNames,
      foundTitle: found ? found.title : null
    });
  } catch (e) {
    window.__d0report("create_real_todo", { ok: false, error: String(e) });
  }
})();
"#;

const READ_B_JS: &str = r#"
(async function () {
  try {
    var ls = localStorage.getItem("d0_probe_ls");
    var dbReq = indexedDB.open("d0-probe-db", 1);
    dbReq.onupgradeneeded = function () { dbReq.result.createObjectStore("probe"); };
    var db = await new Promise(function (res, rej) { dbReq.onsuccess = function () { res(dbReq.result); }; dbReq.onerror = rej; });
    var tx = db.transaction("probe", "readonly");
    var getReq = tx.objectStore("probe").get("probe-key");
    var val = await new Promise(function (res, rej) { getReq.onsuccess = function () { res(getReq.result); }; getReq.onerror = rej; });
    db.close();
    window.__d0report("read_b_synthetic", { ok: true, localStorage: ls, indexedDbValue: val });
  } catch (e) {
    window.__d0report("read_b_synthetic", { ok: false, error: String(e) });
  }
})();
"#;

const READ_REAL_TODOS_B_JS: &str = r#"
(async function () {
  try {
    var dbReq = indexedDB.open("faite");
    var db = await new Promise(function (res, rej) { dbReq.onsuccess = function () { res(dbReq.result); }; dbReq.onerror = rej; });
    var storeNames = Array.from(db.objectStoreNames);
    var total = 0;
    var titles = [];
    if (storeNames.indexOf("todos") !== -1) {
      var tx = db.transaction("todos", "readonly");
      var all = await new Promise(function (res, rej) {
        var out = [];
        var cur = tx.objectStore("todos").openCursor();
        cur.onsuccess = function (e) {
          var c = e.target.result;
          if (c) { out.push(c.value); c.continue(); } else { res(out); }
        };
        cur.onerror = rej;
      });
      total = all.length;
      titles = all.map(function (t) { return t.title; }).filter(function (t) { return typeof t === "string" && t.indexOf("D0 probe todo") === 0; });
    }
    db.close();
    window.__d0report("read_real_todos_b", { ok: titles.length > 0, totalTodos: total, matchingTitles: titles });
  } catch (e) {
    window.__d0report("read_real_todos_b", { ok: false, error: String(e) });
  }
})();
"#;

const FETCH_PROBE_JS: &str = r#"
(async function () {
  try {
    var res = await fetch("https://myfaite.app/api/auth/get-session", { credentials: "include" });
    var text = await res.text();
    window.__d0report("fetch_probe", { ok: true, status: res.status, bodyPreview: text.slice(0, 200) });
  } catch (e) {
    window.__d0report("fetch_probe", { ok: false, error: String(e) });
  }
})();
"#;

const WS_PROBE_JS: &str = r#"
(function () {
  try {
    var ws = new WebSocket("wss://myfaite.app/api/sync/ws");
    var settled = false;
    ws.onopen = function () {
      settled = true;
      window.__d0report("ws_probe", { ok: true, event: "open" });
      try { ws.close(); } catch (e) {}
    };
    ws.onerror = function () {
      window.__d0report("ws_probe_error", { readyState: ws.readyState });
    };
    ws.onclose = function (e) {
      window.__d0report("ws_probe_close", { code: e.code, reason: e.reason, wasClean: e.wasClean, settledBeforeClose: settled });
    };
    setTimeout(function () {
      if (!settled) window.__d0report("ws_probe_timeout", { readyState: ws.readyState });
    }, 5000);
  } catch (e) {
    window.__d0report("ws_probe", { ok: false, error: String(e) });
  }
})();
"#;

fn results_path() -> PathBuf {
    // cwd under `cargo run`/the built binary launched from src-tauri is
    // src-tauri itself; land the log at the repo-worktree root.
    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("../d0-probe-results.jsonl")
}

/// Dead-simple localhost HTTP server: reads a POST body up to `Content-Length`
/// and appends it as one JSON line. Spike-quality parsing — good enough for
/// same-machine, same-process, small JSON payloads from our own JS.
fn start_report_server() {
    let path = results_path();
    let _ = std::fs::remove_file(&path);
    std::thread::spawn(move || {
        let listener = match TcpListener::bind(("127.0.0.1", REPORT_PORT)) {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[d0-probe] failed to bind report server: {e}");
                return;
            }
        };
        for stream in listener.incoming().flatten() {
            let path = path.clone();
            std::thread::spawn(move || {
                if let Err(e) = handle_report_conn(stream, &path) {
                    eprintln!("[d0-probe] report conn error: {e}");
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
            println!("[d0-probe] {body}");
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

pub fn run(app: &AppHandle) {
    start_report_server();
    println!("[d0-probe] report server listening on 127.0.0.1:{REPORT_PORT}");
    println!("[d0-probe] results file: {}", results_path().display());

    let handle = app.clone();
    std::thread::spawn(move || {
        let t0 = std::time::Instant::now();
        println!("[d0-probe][rust t={}] starting window builds", elapsed(t0));

        let win_a = WebviewWindowBuilder::new(&handle, "board_a", WebviewUrl::App("board.html".into()))
            .title("D0 Probe A")
            .inner_size(900.0, 700.0)
            .position(40.0, 60.0)
            .initialization_script(init_script("board_a"))
            .build()
            .expect("create window board_a");
        println!("[d0-probe][rust t={}] board_a built", elapsed(t0));

        let win_b = WebviewWindowBuilder::new(&handle, "board_b", WebviewUrl::App("board.html".into()))
            .title("D0 Probe B")
            .inner_size(900.0, 700.0)
            .position(980.0, 60.0)
            .initialization_script(init_script("board_b"))
            .build()
            .expect("create window board_b");
        println!("[d0-probe][rust t={}] board_b built", elapsed(t0));

        let win_hidden = WebviewWindowBuilder::new(&handle, "hidden_probe", WebviewUrl::App("board.html".into()))
            .title("D0 Probe Hidden")
            .inner_size(400.0, 300.0)
            .visible(false)
            .initialization_script(init_script("hidden_probe"))
            .build()
            .expect("create window hidden_probe");

        println!("[d0-probe][rust t={}] windows created", elapsed(t0));

        std::thread::sleep(Duration::from_secs(2));
        println!("[d0-probe][rust t={}] evaling BC_LISTENER + TIMER_JS", elapsed(t0));
        let _ = win_b.eval(BC_LISTENER_JS);
        let _ = win_hidden.eval(TIMER_JS);

        std::thread::sleep(Duration::from_secs(2));
        println!("[d0-probe][rust t={}] evaling WRITE_A + CREATE_REAL_TODO", elapsed(t0));
        let _ = win_a.eval(WRITE_A_JS);
        let _ = win_a.eval(CREATE_REAL_TODO_A_JS);

        // give the real-todo creation (up to 12s input poll + ~1s settle) room
        // to finish before B reads it back.
        std::thread::sleep(Duration::from_secs(14));
        println!("[d0-probe][rust t={}] evaling READ_B + READ_REAL_TODOS_B", elapsed(t0));
        let _ = win_b.eval(READ_B_JS);
        let _ = win_b.eval(READ_REAL_TODOS_B_JS);

        std::thread::sleep(Duration::from_secs(2));
        println!("[d0-probe][rust t={}] evaling FETCH_PROBE + WS_PROBE", elapsed(t0));
        let _ = win_a.eval(FETCH_PROBE_JS);
        let _ = win_a.eval(WS_PROBE_JS);

        // let the hidden window's setInterval accumulate ticks (5s period)
        // for the rest of a ~50s total run.
        std::thread::sleep(Duration::from_secs(20));

        println!("[d0-probe][rust t={}] probe sequence complete, exiting", elapsed(t0));
        handle.exit(0);
    });
}
