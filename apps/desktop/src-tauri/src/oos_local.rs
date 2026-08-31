use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::Duration,
};
use tiny_http::{Header, Method, Response, Server, StatusCode};
use uuid::Uuid;

const PROTOCOL: &str = "oos-local/0.1";
const MAX_BODY_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiscoveryFile {
    protocol: String,
    node: DiscoveryNode,
    endpoint: String,
    token: String,
    pid: u32,
    started_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DiscoveryNode {
    id: String,
    name: String,
    version: String,
}

#[derive(Debug, Deserialize)]
struct ContextRequest {
    subject: String,
    purpose: String,
    requested_by: String,
    #[serde(default)]
    wanted: WantedContext,
}

#[derive(Debug, Default, Deserialize)]
struct WantedContext {
    max_items: Option<usize>,
}

pub struct LocalOosEndpoint {
    shutdown: Arc<AtomicBool>,
    discovery_path: PathBuf,
    token: String,
}

impl LocalOosEndpoint {
    pub fn start() -> Result<Self, String> {
        let directory = dirs::home_dir()
            .ok_or_else(|| "Unable to determine the home folder for TOPO local discovery.".to_owned())?
            .join(".topo");
        fs::create_dir_all(&directory)
            .map_err(|error| format!("Could not prepare TOPO local discovery: {error}"))?;

        let discovery_path = directory.join("oos-local.json");
        let server = Server::http("127.0.0.1:0")
            .map_err(|error| format!("Could not start TOPO local endpoint: {error}"))?;
        let endpoint = format!("http://{}", server.server_addr());
        let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
        let shutdown = Arc::new(AtomicBool::new(false));

        let discovery = DiscoveryFile {
            protocol: PROTOCOL.to_owned(),
            node: DiscoveryNode {
                id: "topo".to_owned(),
                name: "TOPO".to_owned(),
                version: env!("CARGO_PKG_VERSION").to_owned(),
            },
            endpoint,
            token: token.clone(),
            pid: std::process::id(),
            started_at: Utc::now().to_rfc3339(),
        };
        write_discovery(&discovery_path, &discovery)?;

        let server_token = token.clone();
        let server_shutdown = shutdown.clone();
        thread::Builder::new()
            .name("topo-oos-local".to_owned())
            .spawn(move || {
                while !server_shutdown.load(Ordering::Relaxed) {
                    let request = match server.recv_timeout(Duration::from_millis(250)) {
                        Ok(Some(request)) => request,
                        Ok(None) => continue,
                        Err(_) => break,
                    };
                    handle_request(request, &server_token);
                }
            })
            .map_err(|error| format!("Could not start TOPO local endpoint thread: {error}"))?;

        Ok(Self {
            shutdown,
            discovery_path,
            token,
        })
    }
}

impl Drop for LocalOosEndpoint {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::Relaxed);

        let owned_by_this_process = fs::read_to_string(&self.discovery_path)
            .ok()
            .and_then(|content| serde_json::from_str::<DiscoveryFile>(&content).ok())
            .is_some_and(|discovery| discovery.token == self.token);

        if owned_by_this_process {
            let _ = fs::remove_file(&self.discovery_path);
        }
    }
}

fn write_discovery(path: &Path, discovery: &DiscoveryFile) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "TOPO local discovery path has no parent folder.".to_owned())?;
    let temporary = parent.join(format!(".oos-local-{}.tmp", std::process::id()));
    let content = serde_json::to_vec_pretty(discovery)
        .map_err(|error| format!("Could not encode TOPO local discovery: {error}"))?;
    fs::write(&temporary, content)
        .map_err(|error| format!("Could not write TOPO local discovery: {error}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("Could not secure TOPO local discovery: {error}"))?;
    }

    if path.exists() {
        let metadata = fs::symlink_metadata(path)
            .map_err(|error| format!("Could not inspect existing TOPO discovery: {error}"))?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            let _ = fs::remove_file(&temporary);
            return Err("TOPO local discovery path is not an ordinary file.".to_owned());
        }
        fs::remove_file(path)
            .map_err(|error| format!("Could not replace stale TOPO discovery: {error}"))?;
    }

    fs::rename(&temporary, path)
        .map_err(|error| format!("Could not publish TOPO local discovery: {error}"))?;
    Ok(())
}

fn json_response(value: Value, status: u16) -> Response<std::io::Cursor<Vec<u8>>> {
    let body = serde_json::to_vec(&value).unwrap_or_else(|_| b"{\"error\":\"encoding\"}".to_vec());
    let mut response = Response::from_data(body).with_status_code(StatusCode(status));
    if let Ok(header) = Header::from_bytes("Content-Type", "application/json") {
        response.add_header(header);
    }
    response
}

fn authorised(request: &tiny_http::Request, token: &str) -> bool {
    let expected = format!("Bearer {token}");
    request
        .headers()
        .iter()
        .find(|header| header.field.equiv("Authorization"))
        .is_some_and(|header| header.value.as_str() == expected)
}

fn handle_request(mut request: tiny_http::Request, token: &str) {
    if !authorised(&request, token) {
        let _ = request.respond(json_response(json!({ "error": "unauthorised" }), 401));
        return;
    }

    match (request.method(), request.url()) {
        (&Method::Get, "/v0/capabilities") => {
            let _ = request.respond(json_response(
                json!({
                    "protocol": "oos/0.1-draft",
                    "node": {
                        "id": "topo",
                        "name": "TOPO",
                        "version": env!("CARGO_PKG_VERSION")
                    },
                    "provides": ["context"],
                    "emits": [],
                    "accepts": [],
                    "queries": ["context"],
                    "actions": [],
                    "extensions": {
                        "transport": PROTOCOL,
                        "scope": "local-only",
                        "sensitivity_ceiling": "personal"
                    }
                }),
                200,
            ));
        }
        (&Method::Post, "/v0/context") => {
            let mut body = String::new();
            if request
                .as_reader()
                .take((MAX_BODY_BYTES + 1) as u64)
                .read_to_string(&mut body)
                .is_err()
                || body.len() > MAX_BODY_BYTES
            {
                let _ = request.respond(json_response(
                    json!({ "error": "request body exceeds 64 KiB" }),
                    413,
                ));
                return;
            }

            let parsed = match serde_json::from_str::<ContextRequest>(&body) {
                Ok(parsed) => parsed,
                Err(error) => {
                    let _ = request.respond(json_response(
                        json!({ "error": format!("invalid context request: {error}") }),
                        400,
                    ));
                    return;
                }
            };

            let max_items = parsed.wanted.max_items.unwrap_or(20);
            match super::resolve_local_context(
                &parsed.subject,
                &parsed.purpose,
                &parsed.requested_by,
                max_items,
            ) {
                Ok(packet) => {
                    let _ = request.respond(json_response(packet, 200));
                }
                Err(error) => {
                    let _ = request.respond(json_response(json!({ "error": error }), 400));
                }
            }
        }
        _ => {
            let _ = request.respond(json_response(json!({ "error": "not found" }), 404));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovery_file_is_private_on_unix() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("oos-local.json");
        let discovery = DiscoveryFile {
            protocol: PROTOCOL.to_owned(),
            node: DiscoveryNode {
                id: "topo".to_owned(),
                name: "TOPO".to_owned(),
                version: "0.1.0-test".to_owned(),
            },
            endpoint: "http://127.0.0.1:12345".to_owned(),
            token: "test-token".to_owned(),
            pid: 1,
            started_at: "2026-08-31T09:00:00Z".to_owned(),
        };

        write_discovery(&path, &discovery).unwrap();

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        }
    }

    #[test]
    fn discovery_cleanup_does_not_remove_a_newer_endpoint() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("oos-local.json");
        let newer = DiscoveryFile {
            protocol: PROTOCOL.to_owned(),
            node: DiscoveryNode {
                id: "topo".to_owned(),
                name: "TOPO".to_owned(),
                version: "0.1.0-test".to_owned(),
            },
            endpoint: "http://127.0.0.1:12345".to_owned(),
            token: "newer-token".to_owned(),
            pid: 2,
            started_at: "2026-08-31T09:01:00Z".to_owned(),
        };
        write_discovery(&path, &newer).unwrap();

        {
            let endpoint = LocalOosEndpoint {
                shutdown: Arc::new(AtomicBool::new(false)),
                discovery_path: path.clone(),
                token: "older-token".to_owned(),
            };
            drop(endpoint);
        }

        assert!(path.exists());
    }
}
