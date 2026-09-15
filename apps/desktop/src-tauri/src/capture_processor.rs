use serde_json::{json, Value};

#[path = "capture_processor_core.rs"]
mod core;

fn recoverable_capture_error(error: &str) -> bool {
    error == "Capture inbox is empty."
        || error.starts_with("Captured interaction not found:")
        || error.starts_with("Choose an Ollama model")
        || error.starts_with("Local Ollama model ")
        || error.starts_with("Could not call local Ollama model ")
        || error.starts_with("Ollama model ")
        || error.starts_with("Ollama returned an unreadable chat response")
        || error.contains("returned Memory Page JSON TOPO could not use")
        || error.contains("returned Memory Pages that failed TOPO evidence validation")
}

fn recoverable_result(
    interaction_id: String,
    model: &str,
    error: String,
) -> Value {
    let missing = error == "Capture inbox is empty."
        || error.starts_with("Captured interaction not found:");
    json!({
        "interactionId": interaction_id,
        "extractor": format!("ollama:{}", model.trim()),
        "duplicateSnapshot": false,
        "proposalsExtracted": 0,
        "candidatesCreated": 0,
        "supportingEvidenceAdded": 0,
        "potentialChanges": 0,
        "duplicatePagesSuppressed": 0,
        "representation": "memory-page",
        "status": if missing { "skipped" } else { "failed" },
        "error": error
    })
}

/// Fault-tolerance boundary around the existing transactional capture processor.
///
/// Model/schema failures are isolated to one capture and leave that capture in
/// the inbox for retry. A stale desktop list may also ask for an interaction
/// that a prior attempt already archived; that becomes a harmless skipped
/// result. Persistence/storage failures still propagate because continuing after
/// those could hide a real integrity problem.
#[tauri::command(rename_all = "camelCase")]
pub async fn process_capture_with_ollama(
    interaction_id: String,
    model: String,
) -> Result<Value, String> {
    match core::process_capture_with_ollama(interaction_id.clone(), model.clone()).await {
        Ok(result) => {
            let mut value = serde_json::to_value(result).map_err(|error| error.to_string())?;
            if let Value::Object(ref mut object) = value {
                object.insert("status".to_owned(), Value::String("processed".to_owned()));
            }
            Ok(value)
        }
        Err(error) if recoverable_capture_error(&error) => {
            Ok(recoverable_result(interaction_id, &model, error))
        }
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_contract_failure_is_recoverable() {
        assert!(recoverable_capture_error(
            "qwen3:4b returned Memory Page JSON TOPO could not use: proposal 1 did not match"
        ));
    }

    #[test]
    fn stale_inbox_item_is_recoverable() {
        let value = recoverable_result(
            "chatgpt-web-example".to_owned(),
            "qwen3:4b",
            "Captured interaction not found: chatgpt-web-example".to_owned(),
        );
        assert_eq!(value["status"], "skipped");
    }

    #[test]
    fn storage_errors_are_not_swallowed() {
        assert!(!recoverable_capture_error("database disk image is malformed"));
    }
}
