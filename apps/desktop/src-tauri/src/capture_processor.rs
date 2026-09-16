use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
};

#[path = "capture_processor_core.rs"]
mod core;

static ACTIVE_EXTRACTIONS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();

fn active_extractions() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    ACTIVE_EXTRACTIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn register_extraction(interaction_id: &str) -> Result<Arc<AtomicBool>, String> {
    let mut active = active_extractions()
        .lock()
        .map_err(|_| "TOPO could not access the active extraction registry.".to_owned())?;
    if let Some((active_id, _)) = active.iter().next() {
        if active_id == interaction_id {
            return Err(format!(
                "Extraction is already running for captured interaction {interaction_id}."
            ));
        }
        return Err(format!(
            "Another local extraction is already running for captured interaction {active_id}. Stop or finish it before starting another."
        ));
    }
    let cancellation = Arc::new(AtomicBool::new(false));
    active.insert(interaction_id.to_owned(), cancellation.clone());
    Ok(cancellation)
}

fn unregister_extraction(interaction_id: &str) {
    if let Ok(mut active) = active_extractions().lock() {
        active.remove(interaction_id);
    }
}

fn recoverable_capture_error(error: &str) -> bool {
    error == "Capture inbox is empty."
        || error == "Extraction stopped by user."
        || error.starts_with("Captured interaction not found:")
        || error.starts_with("Extraction is already running for captured interaction")
        || error.starts_with("Another local extraction is already running")
        || error.starts_with("Choose an Ollama model")
        || error.starts_with("Local Ollama model ")
        || error.starts_with("Could not call local Ollama model ")
        || error.starts_with("Could not read Ollama response from")
        || error.starts_with("Ollama model ")
        || error.contains("returned Memory Page JSON TOPO could not use")
        || error.contains("returned Memory Pages that failed TOPO evidence validation")
}

fn recoverable_result(interaction_id: String, model: &str, error: String) -> Value {
    let missing = error == "Capture inbox is empty."
        || error.starts_with("Captured interaction not found:");
    let cancelled = error == "Extraction stopped by user.";
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
        "status": if cancelled { "cancelled" } else if missing { "skipped" } else { "failed" },
        "error": error
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn cancel_capture_extraction(interaction_id: String) -> Result<bool, String> {
    let active = active_extractions()
        .lock()
        .map_err(|_| "TOPO could not access the active extraction registry.".to_owned())?;
    let Some(cancellation) = active.get(&interaction_id) else {
        return Ok(false);
    };
    cancellation.store(true, Ordering::SeqCst);
    Ok(true)
}

/// Fault-tolerance boundary around the transactional capture processor.
///
/// Model/schema failures and explicit user cancellation are isolated to one
/// capture and leave that capture in the inbox for retry. A stale desktop list
/// may also ask for an interaction that a prior attempt already archived; that
/// becomes a harmless skipped result. Persistence/storage failures still
/// propagate because continuing after those could hide a real integrity problem.
#[tauri::command(rename_all = "camelCase")]
pub async fn process_capture_with_ollama(
    interaction_id: String,
    model: String,
) -> Result<Value, String> {
    let cancellation = match register_extraction(&interaction_id) {
        Ok(cancellation) => cancellation,
        Err(error) if recoverable_capture_error(&error) => {
            return Ok(recoverable_result(interaction_id, &model, error));
        }
        Err(error) => return Err(error),
    };
    let result = core::process_capture_with_ollama(
        interaction_id.clone(),
        model.clone(),
        cancellation,
    )
    .await;
    unregister_extraction(&interaction_id);

    match result {
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
    fn ollama_response_read_failure_is_recoverable() {
        assert!(recoverable_capture_error(
            "Could not read Ollama response from http://127.0.0.1:11434/api/chat: request or response body error"
        ));
    }

    #[test]
    fn cancellation_is_recoverable_and_distinct() {
        let value = recoverable_result(
            "chatgpt-web-example".to_owned(),
            "qwen3:4b",
            "Extraction stopped by user.".to_owned(),
        );
        assert_eq!(value["status"], "cancelled");
        assert!(recoverable_capture_error("Extraction stopped by user."));
    }

    #[test]
    fn concurrent_extraction_is_recoverable() {
        assert!(recoverable_capture_error(
            "Another local extraction is already running for captured interaction one. Stop or finish it before starting another."
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
