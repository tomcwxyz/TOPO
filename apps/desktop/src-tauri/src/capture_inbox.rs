use serde::Serialize;
use std::{fs, path::PathBuf};
use topo_contracts::CapturedInteraction;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureInboxItem {
    id: String,
    product: String,
    client: String,
    mode: String,
    capture_method: String,
    fidelity: String,
    title: Option<String>,
    captured_at: String,
    turn_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureInboxStatus {
    directory: String,
    pending: usize,
    invalid: usize,
    items: Vec<CaptureInboxItem>,
}

pub(crate) fn inbox_path() -> Result<PathBuf, String> {
    let home =
        dirs::home_dir().ok_or_else(|| "Unable to determine the home directory.".to_owned())?;
    Ok(home.join(".topo").join("capture-inbox"))
}

fn enum_text<T: Serialize>(value: &T) -> Result<String, String> {
    serde_json::to_value(value)
        .map_err(|error| error.to_string())?
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| "Expected capture enum to serialise as a string.".to_owned())
}

pub(crate) fn queue_capture(interaction: &CapturedInteraction) -> Result<PathBuf, String> {
    queue_capture_at(&inbox_path()?, interaction)
}

pub(crate) fn queue_capture_at(
    directory: &std::path::Path,
    interaction: &CapturedInteraction,
) -> Result<PathBuf, String> {
    validate_interaction(interaction)?;
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

fn validate_interaction(interaction: &CapturedInteraction) -> Result<(), String> {
    if interaction.id.trim().is_empty()
        || interaction.provider.trim().is_empty()
        || interaction.subject.trim().is_empty()
    {
        return Err("Captured interaction id, provider and subject are required.".to_owned());
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
fn secure_directory(path: &std::path::Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|error| format!("Could not secure TOPO capture inbox: {error}"))
}

#[cfg(not(unix))]
fn secure_directory(_path: &std::path::Path) -> Result<(), String> {
    Ok(())
}

#[cfg(unix)]
fn secure_file(path: &std::path::Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("Could not secure TOPO capture file: {error}"))
}

#[cfg(not(unix))]
fn secure_file(_path: &std::path::Path) -> Result<(), String> {
    Ok(())
}

pub fn read_capture_inbox_at(directory: PathBuf) -> Result<CaptureInboxStatus, String> {
    if !directory.exists() {
        return Ok(CaptureInboxStatus {
            directory: directory.display().to_string(),
            pending: 0,
            invalid: 0,
            items: Vec::new(),
        });
    }

    let mut items = Vec::new();
    let mut invalid = 0usize;

    let entries =
        fs::read_dir(&directory).map_err(|error| format!("Could not read capture inbox: {error}"))?;

    for entry in entries {
        let entry = match entry {
            Ok(value) => value,
            Err(_) => {
                invalid += 1;
                continue;
            }
        };
        let path = entry.path();
        let metadata = match fs::symlink_metadata(&path) {
            Ok(value) => value,
            Err(_) => {
                invalid += 1;
                continue;
            }
        };
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            continue;
        }
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }

        let interaction = match fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<CapturedInteraction>(&bytes).ok())
        {
            Some(value) => value,
            None => {
                invalid += 1;
                continue;
            }
        };

        items.push(CaptureInboxItem {
            id: interaction.id,
            product: enum_text(&interaction.product)?,
            client: enum_text(&interaction.client)?,
            mode: enum_text(&interaction.mode)?,
            capture_method: enum_text(&interaction.capture_method)?,
            fidelity: enum_text(&interaction.fidelity)?,
            title: interaction.title,
            captured_at: interaction.captured_at,
            turn_count: interaction.turns.len(),
        });
    }

    items.sort_by(|left, right| {
        right
            .captured_at
            .cmp(&left.captured_at)
            .then_with(|| left.id.cmp(&right.id))
    });

    Ok(CaptureInboxStatus {
        directory: directory.display().to_string(),
        pending: items.len(),
        invalid,
        items,
    })
}

pub(crate) struct LoadedCapture {
    pub path: PathBuf,
    pub interaction: CapturedInteraction,
}

pub(crate) fn load_capture(interaction_id: &str) -> Result<LoadedCapture, String> {
    let directory = inbox_path()?;
    if !directory.exists() {
        return Err("Capture inbox is empty.".to_owned());
    }

    for entry in fs::read_dir(&directory)
        .map_err(|error| format!("Could not read capture inbox: {error}"))?
    {
        let entry = entry.map_err(|error| format!("Could not read capture entry: {error}"))?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("Could not inspect capture entry: {error}"))?;
        if metadata.file_type().is_symlink()
            || !metadata.is_file()
            || path.extension().and_then(|value| value.to_str()) != Some("json")
        {
            continue;
        }

        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(_) => continue,
        };
        let interaction = match serde_json::from_slice::<CapturedInteraction>(&bytes) {
            Ok(interaction) => interaction,
            Err(_) => continue,
        };

        if interaction.id == interaction_id {
            return Ok(LoadedCapture { path, interaction });
        }
    }

    Err(format!("Captured interaction not found: {interaction_id}"))
}

pub(crate) fn archive_capture(path: &std::path::Path) -> Result<(), String> {
    let home =
        dirs::home_dir().ok_or_else(|| "Unable to determine the home directory.".to_owned())?;
    let directory = home.join(".topo").join("capture-processed");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not prepare processed capture archive: {error}"))?;

    let filename = path
        .file_name()
        .ok_or_else(|| "Capture file has no filename.".to_owned())?;
    let destination = directory.join(filename);

    if destination.exists() {
        fs::remove_file(&destination)
            .map_err(|error| format!("Could not replace archived capture: {error}"))?;
    }

    fs::rename(path, destination)
        .map_err(|error| format!("Could not archive processed capture: {error}"))
}

#[tauri::command]
pub fn capture_inbox_status() -> Result<CaptureInboxStatus, String> {
    read_capture_inbox_at(inbox_path()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn agent_interaction() -> CapturedInteraction {
        serde_json::from_value(json!({
            "id": "hermes-agent-session-1",
            "kind": "agent-session",
            "product": "hermes",
            "client": "agent-runtime",
            "mode": "agent",
            "captureMethod": "agent-hook",
            "fidelity": "conversation-turns",
            "provider": "hermes",
            "subject": "self",
            "capturedAt": "2026-08-31T22:00:00Z",
            "turns": [
                { "id": "u1", "role": "user", "content": "Keep this project local-first." },
                { "id": "a1", "role": "assistant", "content": "Understood." }
            ],
            "retention": "review-window"
        }))
        .unwrap()
    }

    #[test]
    fn queued_snapshot_replaces_earlier_version_atomically() {
        let directory = tempfile::tempdir().unwrap();
        let first = agent_interaction();
        let path = queue_capture_at(directory.path(), &first).unwrap();

        let mut newer = first.clone();
        newer.turns.push(topo_contracts::CapturedTurn {
            id: "u2".to_owned(),
            role: topo_contracts::CaptureRole::User,
            content: "And use British English.".to_owned(),
            occurred_at: None,
        });
        queue_capture_at(directory.path(), &newer).unwrap();

        let stored: CapturedInteraction =
            serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
        assert_eq!(stored.turns.len(), 3);
    }

    #[test]
    fn queued_capture_requires_user_authored_evidence() {
        let directory = tempfile::tempdir().unwrap();
        let mut invalid = agent_interaction();
        invalid
            .turns
            .retain(|turn| turn.role != topo_contracts::CaptureRole::User);
        assert!(queue_capture_at(directory.path(), &invalid).is_err());
    }

    #[test]
    fn empty_missing_inbox_is_valid() {
        let directory = tempfile::tempdir().unwrap().path().join("missing");
        let status = read_capture_inbox_at(directory).unwrap();
        assert_eq!(status.pending, 0);
        assert_eq!(status.invalid, 0);
    }

    #[test]
    fn reads_a_shared_capture_interaction() {
        let directory = tempfile::tempdir().unwrap();
        let payload = json!({
            "id": "chatgpt-web-thread",
            "kind": "conversation",
            "product": "chatgpt",
            "client": "web",
            "mode": "work",
            "captureMethod": "browser-extension",
            "fidelity": "conversation-turns",
            "provider": "openai",
            "subject": "self",
            "capturedAt": "2026-08-31T21:00:00Z",
            "turns": [
                { "id": "u1", "role": "user", "content": "Keep going." },
                { "id": "a1", "role": "assistant", "content": "I will." }
            ],
            "retention": "review-window"
        });
        fs::write(
            directory.path().join("chatgpt-web-thread.json"),
            serde_json::to_vec(&payload).unwrap(),
        )
        .unwrap();

        let status = read_capture_inbox_at(directory.path().to_path_buf()).unwrap();
        assert_eq!(status.pending, 1);
        assert_eq!(status.items[0].product, "chatgpt");
        assert_eq!(status.items[0].mode, "work");
        assert_eq!(status.items[0].turn_count, 2);
    }
}
