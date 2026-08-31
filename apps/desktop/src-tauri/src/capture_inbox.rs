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

fn inbox_path() -> Result<PathBuf, String> {
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

#[tauri::command]
pub fn capture_inbox_status() -> Result<CaptureInboxStatus, String> {
    read_capture_inbox_at(inbox_path()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

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
