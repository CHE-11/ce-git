//! Localhost snapshot bridge for the debug build.
//!
//! The window pushes a JSON body. A Cursor MCP server reads it with the token
//! in `target/ce-git-dev.json`. Release builds keep the command registered and
//! reject every push, and they do not listen.

use std::io::{Read, Write};
use std::net::{Ipv4Addr, TcpListener, TcpStream};
use std::path::Path;
#[cfg(debug_assertions)]
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::Value;

#[cfg(debug_assertions)]
const FIRST_PORT: u16 = 47321;
#[cfg(debug_assertions)]
const PORT_ATTEMPTS: u16 = 10;
const MAX_SNAPSHOT_BYTES: usize = 512 * 1024;
const MAX_REQUEST_BYTES: usize = 16 * 1024;
const EMPTY_BODY: &str = r#"{"ready":false}"#;

static BOUND: AtomicBool = AtomicBool::new(false);

pub struct DevFeedback {
    enabled: bool,
    body: Mutex<String>,
}

impl DevFeedback {
    pub fn enabled() -> Self {
        Self {
            enabled: true,
            body: Mutex::new(EMPTY_BODY.to_string()),
        }
    }

    #[cfg_attr(debug_assertions, allow(dead_code))]
    pub fn disabled() -> Self {
        Self {
            enabled: false,
            body: Mutex::new(EMPTY_BODY.to_string()),
        }
    }

    pub fn store(&self, mut snapshot: Value) -> Result<(), String> {
        if !self.accepts() {
            return Err("Dev feedback is unavailable in this build.".into());
        }
        if !snapshot.is_object() {
            return Err("Dev feedback snapshot must be a JSON object.".into());
        }
        scrub(&mut snapshot);
        let body = serde_json::to_string(&snapshot).map_err(|error| error.to_string())?;
        if body.len() > MAX_SNAPSHOT_BYTES {
            return Err("Dev feedback snapshot is too large.".into());
        }
        *self.lock() = body;
        Ok(())
    }

    pub fn current(&self) -> String {
        self.lock().clone()
    }

    fn accepts(&self) -> bool {
        #[cfg(debug_assertions)]
        {
            self.enabled
        }
        #[cfg(not(debug_assertions))]
        {
            let _ = self.enabled;
            false
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, String> {
        self.body
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[cfg(debug_assertions)]
pub fn port_file_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target")
        .join("ce-git-dev.json")
}

/// Removes the port file when this process wrote it.
#[cfg(debug_assertions)]
pub fn clear_port_file() {
    let path = port_file_path();
    let Ok(bytes) = std::fs::read(&path) else {
        return;
    };
    let Ok(value) = serde_json::from_slice::<Value>(&bytes) else {
        let _ = std::fs::remove_file(&path);
        return;
    };
    let own_pid = u64::from(std::process::id());
    if value.get("pid").and_then(Value::as_u64) == Some(own_pid) {
        let _ = std::fs::remove_file(&path);
    }
}

pub fn start(feedback: Arc<DevFeedback>) -> Result<(), String> {
    #[cfg(not(debug_assertions))]
    {
        let _ = feedback;
        return Ok(());
    }
    #[cfg(debug_assertions)]
    {
        bind_and_serve(feedback)
    }
}

/// True only for a debug build launched with `CE_GIT_DEV_FEEDBACK_PROBE`.
#[tauri::command]
pub fn dev_feedback_probe() -> bool {
    #[cfg(debug_assertions)]
    {
        std::env::var_os("CE_GIT_DEV_FEEDBACK_PROBE").is_some()
    }
    #[cfg(not(debug_assertions))]
    {
        false
    }
}

#[tauri::command]
pub fn dev_feedback_push(
    feedback: tauri::State<'_, Arc<DevFeedback>>,
    snapshot: Value,
) -> Result<(), String> {
    feedback.store(snapshot)
}

#[cfg(debug_assertions)]
fn bind_and_serve(feedback: Arc<DevFeedback>) -> Result<(), String> {
    let token = random_token();
    let mut last_error = String::from("no port was free");
    for offset in 0..PORT_ATTEMPTS {
        let port = FIRST_PORT + offset;
        match TcpListener::bind((Ipv4Addr::LOCALHOST, port)) {
            Ok(listener) => {
                write_port_file(&port_file_path(), port, &token, std::process::id())?;
                BOUND.store(true, Ordering::SeqCst);
                std::thread::Builder::new()
                    .name("ce-git-dev-feedback".into())
                    .spawn(move || accept_loop(listener, feedback, token))
                    .map_err(|error| error.to_string())?;
                return Ok(());
            }
            Err(error) => last_error = error.to_string(),
        }
    }
    Err(format!("Couldn't open the dev feedback port: {last_error}"))
}

#[cfg(debug_assertions)]
fn accept_loop(listener: TcpListener, feedback: Arc<DevFeedback>, token: String) {
    for incoming in listener.incoming() {
        let Ok(stream) = incoming else {
            continue;
        };
        let _ = serve_client(stream, &feedback, &token);
    }
}

fn serve_client(mut stream: TcpStream, feedback: &DevFeedback, token: &str) -> std::io::Result<()> {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
    let loopback = stream
        .peer_addr()
        .map(|addr| addr.ip().is_loopback())
        .unwrap_or(false);
    if !loopback {
        return write_json(&mut stream, 403, r#"{"error":"forbidden"}"#);
    }
    let raw = read_headers(&mut stream)?;
    let (status, body) = route(&raw, feedback, token);
    write_json(&mut stream, status, &body)
}

fn read_headers(stream: &mut TcpStream) -> std::io::Result<String> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 1024];
    loop {
        if buf.len() > MAX_REQUEST_BYTES {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "request too large",
            ));
        }
        let read = match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(count) => count,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        };
        buf.extend_from_slice(&chunk[..read]);
        if buf.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
    }
    String::from_utf8(buf)
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))
}

fn route(raw: &str, feedback: &DevFeedback, token: &str) -> (u16, String) {
    let mut lines = raw.split("\r\n");
    let Some(request) = lines.next() else {
        return (400, r#"{"error":"bad request"}"#.into());
    };
    let mut parts = request.split_whitespace();
    let method = parts.next().unwrap_or("");
    let path = parts.next().unwrap_or("").split('?').next().unwrap_or("");
    if method != "GET" {
        return (405, r#"{"error":"method not allowed"}"#.into());
    }
    if path != "/feedback" {
        return (404, r#"{"error":"not found"}"#.into());
    }
    let mut authorization = "";
    for line in lines {
        if line.is_empty() {
            break;
        }
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        if name.eq_ignore_ascii_case("authorization") {
            authorization = value.trim();
        }
    }
    if !bearer_matches(authorization, token) {
        return (401, r#"{"error":"unauthorized"}"#.into());
    }
    (200, feedback.current())
}

fn bearer_matches(value: &str, token: &str) -> bool {
    let Some((scheme, rest)) = value.split_once(' ') else {
        return false;
    };
    if !scheme.eq_ignore_ascii_case("bearer") {
        return false;
    }
    let presented = rest.trim();
    if presented.len() != token.len() {
        return false;
    }
    let diff = presented
        .bytes()
        .zip(token.bytes())
        .fold(0u8, |diff, (left, right)| diff | (left ^ right));
    diff == 0
}

fn write_json(stream: &mut TcpStream, status: u16, body: &str) -> std::io::Result<()> {
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Error",
    };
    let header = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(header.as_bytes())?;
    stream.write_all(body.as_bytes())?;
    stream.flush()
}

fn write_port_file(path: &Path, port: u16, token: &str, pid: u32) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let payload = serde_json::json!({
        "port": port,
        "token": token,
        "pid": pid,
    });
    let bytes = serde_json::to_vec_pretty(&payload).map_err(|error| error.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, &bytes).map_err(|error| error.to_string())?;
    if std::fs::rename(&tmp, path).is_err() {
        let _ = std::fs::remove_file(path);
        std::fs::rename(&tmp, path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn scrub(value: &mut Value) {
    match value {
        Value::Object(map) => {
            for (key, child) in map.iter_mut() {
                if is_secret_key(key) {
                    *child = Value::String("[redacted]".into());
                } else {
                    scrub(child);
                }
            }
        }
        Value::Array(items) => {
            for item in items {
                scrub(item);
            }
        }
        _ => {}
    }
}

fn is_secret_key(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "key"
            | "apikey"
            | "api_key"
            | "token"
            | "authorization"
            | "password"
            | "secret"
            | "openai_api_key"
    )
}

#[cfg(debug_assertions)]
fn random_token() -> String {
    let mut bytes = [0u8; 32];
    fill_random(&mut bytes);
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

#[cfg(all(debug_assertions, windows))]
fn fill_random(buf: &mut [u8]) {
    #[link(name = "advapi32")]
    unsafe extern "system" {
        fn SystemFunction036(random_buffer: *mut u8, random_buffer_length: u32) -> u8;
    }
    let Ok(len) = u32::try_from(buf.len()) else {
        fallback_random(buf);
        return;
    };
    let filled = unsafe { SystemFunction036(buf.as_mut_ptr(), len) };
    if filled == 0 {
        fallback_random(buf);
    }
}

#[cfg(all(debug_assertions, unix))]
fn fill_random(buf: &mut [u8]) {
    use std::fs::File;
    if File::open("/dev/urandom")
        .and_then(|mut file| file.read_exact(buf))
        .is_err()
    {
        fallback_random(buf);
    }
}

#[cfg(debug_assertions)]
fn fallback_random(buf: &mut [u8]) {
    let mut state = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or(0)
        ^ u128::from(std::process::id()) << 32;
    for byte in buf {
        state = state.wrapping_mul(0x9E37_79B9_7F4A_7C15).wrapping_add(1);
        *byte = (state >> 33) as u8;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::net::SocketAddr;

    #[test]
    fn disabled_feedback_rejects_snapshots() {
        let feedback = DevFeedback::disabled();
        let error = feedback.store(json!({"title": "ce-git"})).unwrap_err();
        assert!(error.contains("unavailable"));
        assert_eq!(feedback.current(), EMPTY_BODY);
    }

    #[test]
    fn scrub_replaces_secret_fields() {
        let feedback = DevFeedback::enabled();
        #[cfg(not(debug_assertions))]
        {
            let _ = feedback;
        }
        #[cfg(debug_assertions)]
        {
            feedback
                .store(json!({
                    "title": "ce-git",
                    "key": "hidden-value",
                    "workspace": { "apiKey": "hidden-value", "name": "repo" }
                }))
                .unwrap();
            let stored: Value = serde_json::from_str(&feedback.current()).unwrap();
            assert_eq!(stored["key"], "[redacted]");
            assert_eq!(stored["workspace"]["apiKey"], "[redacted]");
            assert_eq!(stored["workspace"]["name"], "repo");
        }
    }

    #[test]
    fn route_requires_the_bearer_token() {
        let feedback = DevFeedback::enabled();
        let (status, _) = route("GET /feedback HTTP/1.1\r\n\r\n", &feedback, "secret-token");
        assert_eq!(status, 401);
        let (status, _) = route(
            "GET /feedback HTTP/1.1\r\nAuthorization: Bearer wrong-token\r\n\r\n",
            &feedback,
            "secret-token",
        );
        assert_eq!(status, 401);
        let (status, body) = route(
            "GET /feedback HTTP/1.1\r\nAuthorization: Bearer secret-token\r\n\r\n",
            &feedback,
            "secret-token",
        );
        assert_eq!(status, 200);
        assert_eq!(body, EMPTY_BODY);
    }

    #[test]
    fn route_rejects_other_paths_and_methods() {
        let feedback = DevFeedback::enabled();
        let (status, _) = route(
            "POST /feedback HTTP/1.1\r\nAuthorization: Bearer secret-token\r\n\r\n",
            &feedback,
            "secret-token",
        );
        assert_eq!(status, 405);
        let (status, _) = route(
            "GET /snapshot HTTP/1.1\r\nAuthorization: Bearer secret-token\r\n\r\n",
            &feedback,
            "secret-token",
        );
        assert_eq!(status, 404);
    }

    #[test]
    fn serve_client_returns_the_stored_snapshot() {
        let feedback = DevFeedback::enabled();
        #[cfg(debug_assertions)]
        feedback
            .store(json!({"ready": true, "title": "ce-git"}))
            .unwrap();
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            serve_client(stream, &feedback, "secret-token").unwrap();
        });
        let mut stream = TcpStream::connect(SocketAddr::from((Ipv4Addr::LOCALHOST, port))).unwrap();
        stream
            .write_all(
                b"GET /feedback HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer secret-token\r\nConnection: close\r\n\r\n",
            )
            .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        assert!(response.contains("200 OK"), "{response}");
        #[cfg(debug_assertions)]
        assert!(response.contains("\"title\":\"ce-git\""), "{response}");
        server.join().unwrap();
    }

    #[test]
    fn port_file_round_trip() {
        let dir = std::env::temp_dir().join(format!("ce-git-dev-feedback-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("ce-git-dev.json");
        write_port_file(&path, 47321, "abc", 42).unwrap();
        let stored: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(stored["port"], 47321);
        assert_eq!(stored["token"], "abc");
        assert_eq!(stored["pid"], 42);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(debug_assertions)]
    #[test]
    fn listener_flag_starts_clear() {
        assert!(!BOUND.load(Ordering::SeqCst));
    }

    #[cfg(not(debug_assertions))]
    #[test]
    fn start_does_not_open_a_port() {
        let feedback = Arc::new(DevFeedback::enabled());
        let error = feedback.store(json!({"title": "ce-git"})).unwrap_err();
        assert!(error.contains("unavailable"));
        start(Arc::clone(&feedback)).unwrap();
        assert!(!BOUND.load(Ordering::SeqCst));
    }
}
