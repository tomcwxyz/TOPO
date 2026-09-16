from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"Expected text not found in {path}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))


replace_once(
    "apps/desktop/src-tauri/Cargo.toml",
    'tiny_http = "0.12"\n',
    'tiny_http = "0.12"\ntokio = { version = "1", features = ["macros", "time"] }\n',
)

replace_once(
    "apps/desktop/src-tauri/src/capture_processor_core.rs",
    'use std::collections::{BTreeMap, BTreeSet};\n',
    'use std::{\n    collections::{BTreeMap, BTreeSet},\n    sync::{atomic::AtomicBool, Arc},\n};\n',
)
replace_once(
    "apps/desktop/src-tauri/src/capture_processor_core.rs",
    'pub async fn process_capture_with_ollama(\n    interaction_id: String,\n    model: String,\n) -> Result<CaptureProcessResult, String> {',
    'pub async fn process_capture_with_ollama(\n    interaction_id: String,\n    model: String,\n    cancellation: Arc<AtomicBool>,\n) -> Result<CaptureProcessResult, String> {',
)
replace_once(
    "apps/desktop/src-tauri/src/capture_processor_core.rs",
    '    let proposals =\n        capture_extractor::extract_pages_with_ollama(&loaded.interaction, model.trim()).await?;',
    '    let proposals = capture_extractor::extract_pages_with_ollama(\n        &loaded.interaction,\n        model.trim(),\n        cancellation,\n    )\n    .await?;',
)

extractor = Path("apps/desktop/src-tauri/src/capture_extractor.rs")
text = extractor.read_text()

old_imports = '''    io::Write,
    path::PathBuf,
    time::{Duration, Instant},
};'''
new_imports = '''    io::Write,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};'''
if old_imports not in text:
    raise SystemExit("capture_extractor imports marker missing")
text = text.replace(old_imports, new_imports, 1)

marker = "async fn call_ollama(\n"
if marker not in text:
    raise SystemExit("call_ollama marker missing")
helper = '''async fn wait_for_cancellation(cancellation: Arc<AtomicBool>) {
    while !cancellation.load(Ordering::SeqCst) {
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

'''
text = text.replace(marker, helper + marker, 1)

old_signature = '''    user_content: String,
    format: Value,
) -> Result<OllamaCallResult, String> {'''
new_signature = '''    user_content: String,
    format: Value,
    cancellation: Arc<AtomicBool>,
) -> Result<OllamaCallResult, String> {'''
if old_signature not in text:
    raise SystemExit("call_ollama signature marker missing")
text = text.replace(old_signature, new_signature, 1)

old_model_guard = '''    if model.is_empty() {
        return Err("Choose an Ollama model before extracting capture.".to_owned());
    }

    let started = Instant::now();'''
new_model_guard = '''    if model.is_empty() {
        return Err("Choose an Ollama model before extracting capture.".to_owned());
    }
    if cancellation.load(Ordering::SeqCst) {
        return Err("Extraction stopped by user.".to_owned());
    }

    let started = Instant::now();'''
if old_model_guard not in text:
    raise SystemExit("model guard marker missing")
text = text.replace(old_model_guard, new_model_guard, 1)

start_marker = '    let response = client\n        .post(format!("{OLLAMA_BASE_URL}/api/chat"))'
start = text.find(start_marker, text.find("async fn call_ollama"))
if start < 0:
    raise SystemExit("Ollama request start marker missing")
end = text.find("\n\n    let status = response.status();", start)
if end < 0:
    raise SystemExit("Ollama request end marker missing")
replacement = '''    let response = tokio::select! {
        result = client
            .post(format!("{OLLAMA_BASE_URL}/api/chat"))
            .json(&json!({
                "model": model,
                "stream": false,
                "format": format,
                "keep_alive": "10m",
                "options": { "temperature": 0 },
                "messages": [
                    { "role": "system", "content": system },
                    { "role": "user", "content": user_content }
                ]
            }))
            .send() => {
                result.map_err(|error| {
                    append_extractor_diagnostic(json!({
                        "event": if error.is_timeout() { "extract.timeout" } else { "extract.request_failed" },
                        "interactionId": interaction.id,
                        "model": model,
                        "representation": representation,
                        "elapsedMs": elapsed_ms(started),
                        "error": error.to_string()
                    }));
                    if error.is_timeout() {
                        format!(
                            "Local Ollama model {model} did not finish within {OLLAMA_REQUEST_TIMEOUT_SECS} seconds. Try again while the model is warm or choose a smaller model."
                        )
                    } else {
                        format!("Could not call local Ollama model {model}: {error}")
                    }
                })?
            }
        _ = wait_for_cancellation(cancellation.clone()) => {
            append_extractor_diagnostic(json!({
                "event": "extract.cancelled",
                "interactionId": interaction.id,
                "model": model,
                "representation": representation,
                "elapsedMs": elapsed_ms(started)
            }));
            return Err("Extraction stopped by user.".to_owned());
        }
    };'''
text = text[:start] + replacement + text[end:]

legacy_call = '''        format_interaction(interaction),
        Value::String("json".to_owned()),
    )
    .await?;'''
legacy_replacement = '''        format_interaction(interaction),
        Value::String("json".to_owned()),
        Arc::new(AtomicBool::new(false)),
    )
    .await?;'''
if legacy_call not in text:
    raise SystemExit("legacy call marker missing")
text = text.replace(legacy_call, legacy_replacement, 1)

old_page_signature = '''pub async fn extract_pages_with_ollama(
    interaction: &CapturedInteraction,
    model: &str,
) -> Result<Vec<ExtractedMemoryPageProposal>, String> {'''
new_page_signature = '''pub async fn extract_pages_with_ollama(
    interaction: &CapturedInteraction,
    model: &str,
    cancellation: Arc<AtomicBool>,
) -> Result<Vec<ExtractedMemoryPageProposal>, String> {'''
if old_page_signature not in text:
    raise SystemExit("page extractor signature marker missing")
text = text.replace(old_page_signature, new_page_signature, 1)

first_call = '''        formatted.content.clone(),
        schema.clone(),
    )
    .await?;'''
first_replacement = '''        formatted.content.clone(),
        schema.clone(),
        cancellation.clone(),
    )
    .await?;'''
if first_call not in text:
    raise SystemExit("first Memory Page call marker missing")
text = text.replace(first_call, first_replacement, 1)

repair_call = '''                formatted.content.clone(),
                schema,
            )
            .await?;'''
repair_replacement = '''                formatted.content.clone(),
                schema,
                cancellation,
            )
            .await?;'''
if repair_call not in text:
    raise SystemExit("repair call marker missing")
text = text.replace(repair_call, repair_replacement, 1)
extractor.write_text(text)

replace_once(
    "apps/desktop/src-tauri/src/lib.rs",
    '            capture_processor::process_capture_with_ollama,\n',
    '            capture_processor::process_capture_with_ollama,\n            capture_processor::cancel_capture_extraction,\n',
)
