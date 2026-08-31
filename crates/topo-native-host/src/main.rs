use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{self, Read, Write},
    path::{Path, PathBuf},
};
use topo_contracts::CapturedInteraction;

const MAX_MESSAGE_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Deserialize)]
struct NativeRequest {
    #[serde(rename = "type")]
    message_type: String,
    interaction: CapturedInteraction,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeResponse {
    ok: bool,
    queued: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn main() {
    if let Err(error) = run() {
        let _ = write_response(&NativeResponse {
            ok: false,
            queued: false,
            error: Some(error),
        });
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let request = read_request()?;
    if request.message_type != "capture.interaction" {
        return Err(format!(
            "Unsupported TOPO native message type: {}",
            request.message_type
        ));
    }

    validate_interaction(&request.interaction)?;
    let inbox = capture_inbox_path()?;
    queue_interaction(&inbox, &request.interaction)?;

    write_response(&NativeResponse {
        ok: true,
        queued: true,
        error: None,
    })
}

fn capture_inbox_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Unable to determine the home directory.".to_owned())?;
    Ok(home.join(".topo").join("capture-inbox"))
}

fn validate_interaction(interaction: &CapturedInteraction) -> Result<(), String> {
    if interaction.id.trim().is_empty() {
        return Err("Captured interaction id is required.".to_owned());
    }
    if interaction.provider.trim().is_empty() || interaction.subject.trim().is_empty() {
        return Err("Captured interaction provider and subject are required.".to_owned());
    }
    if interaction.turns.is_empty() {
        return Err("Captured interaction has no turns.".to_owned());
    }
    if !interaction
        .turns
        .iter()
        .any(|turn| matches!(turn.role, topo_contracts::CaptureRole::User))
    {
        return Err("Captured interaction has no user-authored turn.".to_owned());
    }
    if interaction
        .turns
        .iter()
        .any(|turn| turn.id.trim().is_empty() || turn.content.trim().is_empty())
    {
        return Err("Captured interaction contains an empty turn.".to_owned());
    }
    Ok(())
}

fn queue_interaction(directory: &Path, interaction: &CapturedInteraction) -> Result<PathBuf, String> {
    fs::create_dir_all(directory)
        .map_err(|error| format!("Could not prepare TOPO capture inbox: {error}"))?;
    secure_directory(directory)?;

    let filename = format!("{}.json", safe_filename(&interaction.id));
    let destination = directory.join(filename);
    let temporary = directory.join(format!(
        ".{}.{}.tmp",
        safe_filename(&interaction.id),
        std::process::id()
    ));
    let content = serde_json::to_vec_pretty(interaction)
        .map_err(|error| format!("Could not encode TOPO capture: {error}"))?;

    fs::write(&temporary, content)
        .map_err(|error| format!("Could not write TOPO capture: {error}"))?;
    secure_file(&temporary)?;

    if destination.exists() {
        let metadata = fs::symlink_metadata(&destination)
            .map_err(|error| format!("Could not inspect existing TOPO capture: {error}"))?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            let _ = fs::remove_file(&temporary);
            return Err("TOPO capture destination is not an ordinary file.".to_owned());
        }
        fs::remove_file(&destination)
            .map_err(|error| format!("Could not replace queued TOPO capture: {error}"))?;
    }

    fs::rename(&temporary, &destination)
        .map_err(|error| format!("Could not publish TOPO capture: {error}"))?;
    Ok(destination)
}

fn safe_filename(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    for character in value.chars() {
        if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
            output.push(character);
        } else {
            output.push('_');
        }
    }
    if output.is_empty() {
        "capture".to_owned()
    } else {
        output.chars().take(180).collect()
    }
}

#[cfg(unix)]
fn secure_directory(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|error| format!("Could not secure TOPO capture inbox: {error}"))
}

#[cfg(not(unix))]
fn secure_directory(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(unix)]
fn secure_file(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("Could not secure TOPO capture file: {error}"))
}

#[cfg(not(unix))]
fn secure_file(_path: &Path) -> Result<(), String> {
    Ok(())
}

fn read_request() -> Result<NativeRequest, String> {
    let mut stdin = io::stdin().lock();
    let mut header = [0_u8; 4];
    stdin
        .read_exact(&mut header)
        .map_err(|error| format!("Could not read native message header: {error}"))?;

    let length = u32::from_le_bytes(header) as usize;
    if length == 0 || length > MAX_MESSAGE_BYTES {
        return Err(format!("Invalid native message length: {length}"));
    }

    let mut body = vec![0_u8; length];
    stdin
        .read_exact(&mut body)
        .map_err(|error| format!("Could not read native message body: {error}"))?;

    serde_json::from_slice(&body)
        .map_err(|error| format!("Invalid TOPO native message: {error}"))
}

fn write_response(response: &NativeResponse) -> Result<(), String> {
    let body = serde_json::to_vec(response)
        .map_err(|error| format!("Could not encode native response: {error}"))?;
    let length = u32::try_from(body.len())
        .map_err(|_| "Native response is too large.".to_owned())?;

    let mut stdout = io::stdout().lock();
    stdout
        .write_all(&length.to_le_bytes())
        .and_then(|_| stdout.write_all(&body))
        .and_then(|_| stdout.flush())
        .map_err(|error| format!("Could not write native response: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use topo_contracts::{
        CaptureClient, CaptureFidelity, CaptureKind, CaptureMethod, CaptureMode, CaptureProduct,
        CaptureRole, CapturedTurn, SourceRetention,
    };

    fn interaction() -> CapturedInteraction {
        CapturedInteraction {
            id: "chatgpt-web-thread-123".to_owned(),
            kind: CaptureKind::Conversation,
            product: CaptureProduct::Chatgpt,
            client: CaptureClient::Web,
            mode: CaptureMode::Chat,
            capture_method: CaptureMethod::BrowserExtension,
            fidelity: CaptureFidelity::ConversationTurns,
            provider: "openai".to_owned(),
            subject: "self".to_owned(),
            title: Some("TOPO capture".to_owned()),
            external_id: Some("thread-123".to_owned()),
            source_url: Some("https://chatgpt.com/c/thread-123".to_owned()),
            captured_at: "2026-08-31T20:00:00Z".to_owned(),
            turns: vec![
                CapturedTurn {
                    id: "u1".to_owned(),
                    role: CaptureRole::User,
                    content: "Use British English.".to_owned(),
                    occurred_at: None,
                },
                CapturedTurn {
                    id: "a1".to_owned(),
                    role: CaptureRole::Assistant,
                    content: "Understood.".to_owned(),
                    occurred_at: None,
                },
            ],
            retention: SourceRetention::ReviewWindow,
            metadata: Some(
                serde_json::from_value(json!({"extensionVersion":"0.1.0"})).unwrap(),
            ),
        }
    }

    #[test]
    fn queues_latest_snapshot_atomically_by_interaction_id() {
        let directory = tempfile::tempdir().unwrap();
        let first = interaction();
        let path = queue_interaction(directory.path(), &first).unwrap();

        let mut newer = first.clone();
        newer.turns.push(CapturedTurn {
            id: "u2".to_owned(),
            role: CaptureRole::User,
            content: "Keep going.".to_owned(),
            occurred_at: None,
        });
        queue_interaction(directory.path(), &newer).unwrap();

        let stored: CapturedInteraction =
            serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
        assert_eq!(stored.turns.len(), 3);
    }

    #[test]
    fn rejects_capture_without_user_evidence() {
        let mut invalid = interaction();
        invalid.turns.retain(|turn| turn.role != CaptureRole::User);
        assert!(validate_interaction(&invalid).is_err());
    }

    #[test]
    fn filename_cannot_escape_capture_directory() {
        assert_eq!(safe_filename("../../bad/thread"), ".._.._bad_thread");
    }
}
