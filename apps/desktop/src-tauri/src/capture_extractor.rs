use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::{
    collections::BTreeMap,
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    process::Command,
    time::{Duration, Instant},
};
use topo_contracts::{
    CaptureFidelity, CaptureRole, CapturedInteraction, EpistemicType, ExtractedMemoryProposal,
};

const OLLAMA_BASE_URL: &str = "http://127.0.0.1:11434";
const OLLAMA_REQUEST_TIMEOUT_SECS: u64 = 300;
const MAX_TRANSCRIPT_CHARS: usize = 60_000;
const DIAGNOSTIC_LOG_NAME: &str = "extractor-alpha.jsonl";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaStatus {
    pub available: bool,
    pub models: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OllamaTagsResponse {
    #[serde(default)]
    models: Vec<OllamaModel>,
}

#[derive(Debug, Deserialize)]
struct OllamaModel {
    name: String,
}

#[derive(Debug, Deserialize)]
struct OllamaChatResponse {
    message: OllamaChatMessage,
    #[serde(default)]
    done_reason: Option<String>,
    #[serde(default)]
    total_duration: Option<u64>,
    #[serde(default)]
    load_duration: Option<u64>,
    #[serde(default)]
    prompt_eval_count: Option<u64>,
    #[serde(default)]
    prompt_eval_duration: Option<u64>,
    #[serde(default)]
    eval_count: Option<u64>,
    #[serde(default)]
    eval_duration: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct OllamaChatMessage {
    content: String,
}

#[derive(Debug, Deserialize)]
struct ProposalEnvelope {
    #[serde(default)]
    proposals: Vec<ExtractedMemoryProposal>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractorDiagnosticsStatus {
    pub path: String,
}

fn extractor_diagnostics_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Unable to determine the home folder.".to_owned())?;
    Ok(home.join(".topo").join("logs").join(DIAGNOSTIC_LOG_NAME))
}

fn append_extractor_diagnostic(event: Value) {
    let Ok(path) = extractor_diagnostics_path() else {
        return;
    };
    if let Some(parent) = path.parent() {
        if fs::create_dir_all(parent).is_err() {
            return;
        }
    }

    let mut event = match event {
        Value::Object(map) => map,
        _ => Map::new(),
    };
    event.insert(
        "at".to_owned(),
        Value::String(chrono::Utc::now().to_rfc3339()),
    );

    let Ok(line) = serde_json::to_string(&Value::Object(event)) else {
        return;
    };
    let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) else {
        return;
    };
    let _ = writeln!(file, "{line}");
}

#[tauri::command]
pub fn extractor_diagnostics_status() -> Result<ExtractorDiagnosticsStatus, String> {
    Ok(ExtractorDiagnosticsStatus {
        path: extractor_diagnostics_path()?.display().to_string(),
    })
}

#[tauri::command]
pub fn open_extractor_diagnostics_folder() -> Result<(), String> {
    let path = extractor_diagnostics_path()?;
    let parent = path
        .parent()
        .ok_or_else(|| "Unable to determine extractor diagnostics folder.".to_owned())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;

    #[cfg(windows)]
    {
        Command::new("explorer.exe")
            .arg(parent)
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(parent)
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Opening the diagnostics folder is not supported on this platform.".to_owned())
}

fn status_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|error| error.to_string())
}

async fn ollama_status_with_client(client: &Client) -> OllamaStatus {
    match client
        .get(format!("{OLLAMA_BASE_URL}/api/tags"))
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => {
            match response.json::<OllamaTagsResponse>().await {
                Ok(payload) => {
                    let mut models = payload
                        .models
                        .into_iter()
                        .map(|model| model.name)
                        .filter(|name| !name.trim().is_empty())
                        .collect::<Vec<_>>();
                    models.sort();
                    models.dedup();
                    OllamaStatus {
                        available: true,
                        models,
                        error: None,
                    }
                }
                Err(error) => OllamaStatus {
                    available: false,
                    models: Vec::new(),
                    error: Some(format!("Ollama returned an unreadable model list: {error}")),
                },
            }
        }
        Ok(response) => OllamaStatus {
            available: false,
            models: Vec::new(),
            error: Some(format!("Ollama returned HTTP {}.", response.status())),
        },
        Err(error) => OllamaStatus {
            available: false,
            models: Vec::new(),
            error: Some(format!(
                "Ollama is not running on {OLLAMA_BASE_URL}. Start Ollama and try again. ({error})"
            )),
        },
    }
}

#[tauri::command]
pub async fn ollama_extractor_status() -> OllamaStatus {
    let client = match status_client() {
        Ok(client) => client,
        Err(error) => {
            return OllamaStatus {
                available: false,
                models: Vec::new(),
                error: Some(error),
            }
        }
    };
    ollama_status_with_client(&client).await
}

#[cfg(windows)]
fn start_ollama_process() -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let local_app_data = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    let mut app_candidates = Vec::<PathBuf>::new();
    let mut server_candidates = Vec::<PathBuf>::new();

    if let Some(root) = local_app_data {
        app_candidates.push(root.join("Programs").join("Ollama").join("ollama app.exe"));
        app_candidates.push(root.join("Ollama").join("ollama app.exe"));
        server_candidates.push(root.join("Programs").join("Ollama").join("ollama.exe"));
    }

    for candidate in app_candidates {
        if candidate.is_file() {
            Command::new(&candidate)
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .map_err(|error| format!("Could not start {}: {error}", candidate.display()))?;
            return Ok(());
        }
    }

    if Command::new("ollama app.exe")
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .is_ok()
    {
        return Ok(());
    }

    for candidate in server_candidates {
        if candidate.is_file() {
            Command::new(&candidate)
                .arg("serve")
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .map_err(|error| format!("Could not start {} serve: {error}", candidate.display()))?;
            return Ok(());
        }
    }

    Command::new("ollama")
        .arg("serve")
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|error| {
            format!(
                "TOPO could not find or start Ollama. Open Ollama from the Windows Start menu, then try again. ({error})"
            )
        })
}

#[cfg(not(windows))]
fn start_ollama_process() -> Result<(), String> {
    Err("Start Ollama on this computer, then try again.".to_owned())
}

async fn wait_for_ollama(client: &Client) -> OllamaStatus {
    let mut latest = ollama_status_with_client(client).await;
    if latest.available {
        return latest;
    }

    for _ in 0..8 {
        std::thread::sleep(Duration::from_millis(500));
        latest = ollama_status_with_client(client).await;
        if latest.available {
            return latest;
        }
    }
    latest
}

#[tauri::command]
pub async fn start_ollama_extractor() -> OllamaStatus {
    let client = match status_client() {
        Ok(client) => client,
        Err(error) => {
            return OllamaStatus {
                available: false,
                models: Vec::new(),
                error: Some(error),
            }
        }
    };

    let current = ollama_status_with_client(&client).await;
    if current.available {
        return current;
    }

    if let Err(error) = start_ollama_process() {
        return OllamaStatus {
            available: false,
            models: Vec::new(),
            error: Some(error),
        };
    }

    let mut status = wait_for_ollama(&client).await;
    if !status.available {
        status.error = Some(
            "TOPO started Ollama but its local API did not become ready. Open Ollama from the Windows Start menu or run `ollama serve`, then try again."
                .to_owned(),
        );
    }
    status
}

async fn send_ollama_chat(
    client: &Client,
    model: &str,
    system: &str,
    transcript: &str,
) -> Result<reqwest::Response, reqwest::Error> {
    client
        .post(format!("{OLLAMA_BASE_URL}/api/chat"))
        .json(&json!({
            "model": model,
            "stream": false,
            "format": "json",
            "keep_alive": "10m",
            "options": {
                "temperature": 0.1
            },
            "messages": [
                {
                    "role": "system",
                    "content": system
                },
                {
                    "role": "user",
                    "content": transcript
                }
            ]
        }))
        .send()
        .await
}

pub async fn extract_with_ollama(
    interaction: &CapturedInteraction,
    model: &str,
) -> Result<Vec<ExtractedMemoryProposal>, String> {
    let model = model.trim();
    if model.is_empty() {
        return Err("Choose an Ollama model before extracting capture.".to_owned());
    }

    let system = extraction_prompt(&interaction.fidelity);
    let transcript = format_interaction(interaction);
    let started = Instant::now();

    append_extractor_diagnostic(json!({
        "event": "extract.start",
        "interactionId": interaction.id,
        "model": model,
        "turnCount": interaction.turns.len(),
        "transcriptChars": transcript.chars().count(),
        "timeoutSeconds": OLLAMA_REQUEST_TIMEOUT_SECS
    }));

    let client = Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(OLLAMA_REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|error| error.to_string())?;

    let response = match send_ollama_chat(&client, model, &system, &transcript).await {
        Ok(response) => response,
        Err(error) if error.is_connect() => {
            append_extractor_diagnostic(json!({
                "event": "extract.connection_failed",
                "interactionId": interaction.id,
                "model": model,
                "elapsedMs": started.elapsed().as_millis(),
                "error": error.to_string()
            }));

            let start_error = start_ollama_process().err();
            if start_error.is_none() {
                let status_client = status_client()?;
                let status = wait_for_ollama(&status_client).await;
                if status.available {
                    append_extractor_diagnostic(json!({
                        "event": "extract.ollama_restarted",
                        "interactionId": interaction.id,
                        "model": model,
                        "elapsedMs": started.elapsed().as_millis()
                    }));
                    send_ollama_chat(&client, model, &system, &transcript)
                        .await
                        .map_err(|retry_error| {
                            append_extractor_diagnostic(json!({
                                "event": "extract.retry_failed",
                                "interactionId": interaction.id,
                                "model": model,
                                "elapsedMs": started.elapsed().as_millis(),
                                "error": retry_error.to_string()
                            }));
                            format!(
                                "Ollama restarted, but {model} still could not be called at {OLLAMA_BASE_URL} after {}s: {retry_error}",
                                started.elapsed().as_secs()
                            )
                        })?
                } else {
                    let error = status.error.unwrap_or_else(|| {
                        "Ollama did not become ready after TOPO tried to start it.".to_owned()
                    });
                    append_extractor_diagnostic(json!({
                        "event": "extract.ollama_restart_failed",
                        "interactionId": interaction.id,
                        "model": model,
                        "elapsedMs": started.elapsed().as_millis(),
                        "error": error
                    }));
                    return Err(error);
                }
            } else {
                let error = start_error.unwrap();
                append_extractor_diagnostic(json!({
                    "event": "extract.ollama_start_failed",
                    "interactionId": interaction.id,
                    "model": model,
                    "elapsedMs": started.elapsed().as_millis(),
                    "error": error
                }));
                return Err(error);
            }
        }
        Err(error) if error.is_timeout() => {
            append_extractor_diagnostic(json!({
                "event": "extract.timeout",
                "interactionId": interaction.id,
                "model": model,
                "elapsedMs": started.elapsed().as_millis(),
                "timeoutSeconds": OLLAMA_REQUEST_TIMEOUT_SECS
            }));
            return Err(format!(
                "Local Ollama model {model} did not finish within {OLLAMA_REQUEST_TIMEOUT_SECS} seconds. This is usually model loading or slow local generation; try again while the model is warm or choose a smaller model."
            ));
        }
        Err(error) => {
            append_extractor_diagnostic(json!({
                "event": "extract.request_failed",
                "interactionId": interaction.id,
                "model": model,
                "elapsedMs": started.elapsed().as_millis(),
                "error": error.to_string()
            }));
            return Err(format!(
                "Could not call local Ollama model {model} at {OLLAMA_BASE_URL} after {}s: {error}",
                started.elapsed().as_secs()
            ));
        }
    };

    let status = response.status();
    let body = response.text().await.map_err(|error| {
        append_extractor_diagnostic(json!({
            "event": "extract.response_read_failed",
            "interactionId": interaction.id,
            "model": model,
            "elapsedMs": started.elapsed().as_millis(),
            "error": error.to_string()
        }));
        format!("Could not read Ollama response from {model}: {error}")
    })?;

    if !status.is_success() {
        let preview = body.chars().take(500).collect::<String>();
        append_extractor_diagnostic(json!({
            "event": "extract.http_error",
            "interactionId": interaction.id,
            "model": model,
            "elapsedMs": started.elapsed().as_millis(),
            "httpStatus": status.as_u16(),
            "bodyChars": body.chars().count(),
            "bodyPreview": preview
        }));
        return Err(format!(
            "Ollama model {model} returned HTTP {status} after {}s: {}",
            started.elapsed().as_secs(),
            body.chars().take(500).collect::<String>()
        ));
    }

    let payload = serde_json::from_str::<OllamaChatResponse>(&body).map_err(|error| {
        append_extractor_diagnostic(json!({
            "event": "extract.ollama_envelope_invalid",
            "interactionId": interaction.id,
            "model": model,
            "elapsedMs": started.elapsed().as_millis(),
            "responseChars": body.chars().count(),
            "error": error.to_string()
        }));
        format!(
            "Ollama returned an unreadable chat response for {model} after {}s: {error}",
            started.elapsed().as_secs()
        )
    })?;

    let proposals = parse_proposals(&payload.message.content).map_err(|error| {
        append_extractor_diagnostic(json!({
            "event": "extract.proposal_parse_failed",
            "interactionId": interaction.id,
            "model": model,
            "elapsedMs": started.elapsed().as_millis(),
            "modelOutputChars": payload.message.content.chars().count(),
            "modelOutputShape": json_shape_summary(&payload.message.content),
            "error": error
        }));
        format!(
            "{model} returned JSON TOPO could not use after {}s: {error}",
            started.elapsed().as_secs()
        )
    })?;

    let validated = validate_proposals(interaction, proposals).map_err(|error| {
        append_extractor_diagnostic(json!({
            "event": "extract.validation_failed",
            "interactionId": interaction.id,
            "model": model,
            "elapsedMs": started.elapsed().as_millis(),
            "error": error
        }));
        format!(
            "{model} returned proposals that failed TOPO evidence validation after {}s: {error}",
            started.elapsed().as_secs()
        )
    })?;

    append_extractor_diagnostic(json!({
        "event": "extract.success",
        "interactionId": interaction.id,
        "model": model,
        "elapsedMs": started.elapsed().as_millis(),
        "proposalCount": validated.len(),
        "ollama": {
            "doneReason": payload.done_reason,
            "totalDurationNs": payload.total_duration,
            "loadDurationNs": payload.load_duration,
            "promptEvalCount": payload.prompt_eval_count,
            "promptEvalDurationNs": payload.prompt_eval_duration,
            "evalCount": payload.eval_count,
            "evalDurationNs": payload.eval_duration
        }
    }));

    Ok(validated)
}

pub fn extraction_prompt(fidelity: &CaptureFidelity) -> String {
    let incomplete = matches!(
        fidelity,
        CaptureFidelity::TaskSummary | CaptureFidelity::PartialVisible
    );

    let mut rules = vec![
        "You identify user-owned context that may be worth remembering across future AI interactions.",
        "Return candidate memories only. A human will review them before they become durable memory.",
        "Every proposal must be grounded in at least one USER turn ID from the transcript.",
        "The transcript uses short turn IDs such as u1, u2 and a1. Copy USER turn IDs exactly into evidenceTurnIds.",
        "Assistant, tool and system messages may provide context but are not evidence about the user.",
        "Questions are weak evidence. Do not infer personal facts merely because the user asked about something.",
        "Keep assertion, preference, observation, inference and derived-pattern epistemic types distinct.",
        "Confidence never changes the epistemic type.",
        "Prefer information that would materially improve a future interaction; ignore incidental trivia.",
        "Use horizon durable for stable preferences/enduring context, project for active project context, temporary for short-lived circumstances.",
        "Do not extract passwords, authentication tokens, API keys, financial credentials or other secrets.",
        "Be conservative with sensitive personal data and set sensitivity when needed.",
        "Use concise dot-separated keys such as writing.locale or project.event.database.",
        "Evidence must be a short verbatim excerpt from a USER turn.",
        "Use the field names exactly as shown. Do not use snake_case, rename proposals, or return a single proposal object.",
        "epistemicType must be exactly one of: assertion, observation, inference, preference, derived-pattern.",
        "proposals must always be a JSON array, even when it contains only one item.",
    ];

    if incomplete {
        rules.push("This capture is incomplete. Only propose directly evidenced assertion or preference memories.");
        rules.push("Do not propose observations, inferences or derived patterns from this incomplete source.");
    }

    format!(
        "{}\n\nReturn JSON only using this object shape:\n{}",
        rules
            .into_iter()
            .map(|rule| format!("- {rule}"))
            .collect::<Vec<_>>()
            .join("\n"),
        r#"{
  "proposals": [
    {
      "key": "writing.locale",
      "value": "en-GB",
      "category": "writing",
      "tags": ["writing"],
      "epistemicType": "preference",
      "confidence": 0.98,
      "sensitivity": "ordinary",
      "horizon": "durable",
      "evidenceTurnIds": ["u1"],
      "evidence": "Please use British English.",
      "validUntil": null
    }
  ]
}

Omit optional fields instead of returning null. Return {"proposals":[]} when nothing is genuinely worth remembering."#
    )
}

fn turn_aliases(interaction: &CapturedInteraction) -> Vec<String> {
    let mut user = 0usize;
    let mut assistant = 0usize;
    let mut system = 0usize;
    let mut tool = 0usize;

    interaction
        .turns
        .iter()
        .map(|turn| match turn.role {
            CaptureRole::User => {
                user += 1;
                format!("u{user}")
            }
            CaptureRole::Assistant => {
                assistant += 1;
                format!("a{assistant}")
            }
            CaptureRole::System => {
                system += 1;
                format!("s{system}")
            }
            CaptureRole::Tool => {
                tool += 1;
                format!("t{tool}")
            }
        })
        .collect()
}

pub fn format_interaction(interaction: &CapturedInteraction) -> String {
    let mut output = String::new();
    let aliases = turn_aliases(interaction);

    for (turn, alias) in interaction.turns.iter().zip(aliases.iter()) {
        let role = match turn.role {
            CaptureRole::User => "USER",
            CaptureRole::Assistant => "ASSISTANT",
            CaptureRole::System => "SYSTEM",
            CaptureRole::Tool => "TOOL",
        };
        let per_turn_limit = if matches!(turn.role, CaptureRole::User) {
            5_000
        } else {
            2_000
        };
        let mut content = turn.content.chars().take(per_turn_limit).collect::<String>();
        if turn.content.chars().count() > per_turn_limit {
            content.push_str(" …[truncated]");
        }

        let line = format!("[TURN {alias}][{role}]: {content}\n");
        if output.len() + line.len() > MAX_TRANSCRIPT_CHARS {
            output.push_str("[... transcript truncated by TOPO ...]\n");
            break;
        }
        output.push_str(&line);
    }

    output
}

pub fn parse_proposals(text: &str) -> Result<Vec<ExtractedMemoryProposal>, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    let root = parse_model_json(trimmed)?;
    let raw_items = proposal_items(root)?;
    let mut proposals = Vec::with_capacity(raw_items.len());

    for (index, mut item) in raw_items.into_iter().enumerate() {
        normalise_proposal_json(&mut item);
        match serde_json::from_value::<ExtractedMemoryProposal>(item.clone()) {
            Ok(proposal) => proposals.push(proposal),
            Err(error) => {
                return Err(format!(
                    "proposal {} did not match the TOPO contract: {error}. Fields seen: {}",
                    index + 1,
                    object_keys(&item).join(", ")
                ));
            }
        }
    }

    Ok(proposals)
}

fn parse_model_json(text: &str) -> Result<Value, String> {
    if let Ok(value) = serde_json::from_str::<Value>(text) {
        return Ok(value);
    }

    let fragment = extract_json_fragment(text)
        .ok_or_else(|| "Extractor response did not contain a JSON object or array.".to_owned())?;
    serde_json::from_str::<Value>(&fragment).map_err(|error| {
        format!("Extractor response contained malformed JSON: {error}")
    })
}

fn extract_json_fragment(text: &str) -> Option<String> {
    let object_start = text.find('{');
    let array_start = text.find('[');
    let (start, closing) = match (object_start, array_start) {
        (Some(object), Some(array)) if object <= array => (object, '}'),
        (Some(_object), Some(array)) => (array, ']'),
        (Some(object), None) => (object, '}'),
        (None, Some(array)) => (array, ']'),
        (None, None) => return None,
    };
    let end = text.rfind(closing)?;
    (end > start).then(|| text[start..=end].to_owned())
}

fn proposal_items(root: Value) -> Result<Vec<Value>, String> {
    match root {
        Value::Array(items) => Ok(items),
        Value::Object(mut map) => {
            for key in ["proposals", "memories", "candidates", "memoryProposals"] {
                if let Some(value) = map.remove(key) {
                    return match value {
                        Value::Array(items) => Ok(items),
                        Value::Object(item) => Ok(vec![Value::Object(item)]),
                        other => Err(format!(
                            "Extractor field {key} must be an array, got {}.",
                            value_kind(&other)
                        )),
                    };
                }
            }

            if map.contains_key("key") {
                Ok(vec![Value::Object(map)])
            } else {
                Err(format!(
                    "Extractor JSON had no proposals array. Top-level fields seen: {}",
                    map.keys().cloned().collect::<Vec<_>>().join(", ")
                ))
            }
        }
        other => Err(format!(
            "Extractor JSON root must be an object or array, got {}.",
            value_kind(&other)
        )),
    }
}

fn move_alias(map: &mut Map<String, Value>, from: &str, to: &str) {
    if map.contains_key(to) {
        return;
    }
    if let Some(value) = map.remove(from) {
        map.insert(to.to_owned(), value);
    }
}

fn normalise_proposal_json(value: &mut Value) {
    let Value::Object(map) = value else {
        return;
    };

    for (from, to) in [
        ("epistemic_type", "epistemicType"),
        ("evidence_turn_ids", "evidenceTurnIds"),
        ("evidence_turns", "evidenceTurnIds"),
        ("valid_until", "validUntil"),
    ] {
        move_alias(map, from, to);
    }

    if let Some(Value::String(turn_id)) = map.get("evidenceTurnIds").cloned() {
        map.insert(
            "evidenceTurnIds".to_owned(),
            Value::Array(vec![Value::String(turn_id)]),
        );
    }

    if let Some(Value::String(tag)) = map.get("tags").cloned() {
        map.insert("tags".to_owned(), Value::Array(vec![Value::String(tag)]));
    }

    if let Some(Value::String(confidence)) = map.get("confidence").cloned() {
        if let Ok(number) = confidence.parse::<f64>() {
            if let Some(number) = serde_json::Number::from_f64(number) {
                map.insert("confidence".to_owned(), Value::Number(number));
            }
        }
    }

    if let Some(Value::Number(number)) = map.get("confidence").cloned() {
        if let Some(number) = number.as_f64() {
            if number > 1.0 && number <= 100.0 {
                if let Some(normalised) = serde_json::Number::from_f64(number / 100.0) {
                    map.insert("confidence".to_owned(), Value::Number(normalised));
                }
            }
        }
    }

    for key in ["epistemicType", "sensitivity", "horizon"] {
        if let Some(Value::String(raw)) = map.get_mut(key) {
            *raw = raw
                .trim()
                .to_ascii_lowercase()
                .replace(['_', ' '], "-");
        }
    }

    if let Some(Value::String(epistemic_type)) = map.get_mut("epistemicType") {
        *epistemic_type = match epistemic_type.as_str() {
            "information" | "fact" | "statement" => "assertion".to_owned(),
            other => other.to_owned(),
        };
    }
}

fn object_keys(value: &Value) -> Vec<String> {
    match value {
        Value::Object(map) => map.keys().cloned().collect(),
        _ => Vec::new(),
    }
}

fn value_kind(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

fn json_shape_summary(text: &str) -> Value {
    match parse_model_json(text) {
        Ok(Value::Object(map)) => {
            let top_level = map.keys().cloned().collect::<Vec<_>>();
            let proposal_shape = ["proposals", "memories", "candidates", "memoryProposals"]
                .iter()
                .find_map(|key| map.get(*key))
                .and_then(|value| match value {
                    Value::Array(items) => items.first(),
                    Value::Object(_) => Some(value),
                    _ => None,
                })
                .map(object_keys)
                .unwrap_or_default();
            json!({
                "root": "object",
                "topLevelFields": top_level,
                "proposalFields": proposal_shape
            })
        }
        Ok(Value::Array(items)) => json!({
            "root": "array",
            "items": items.len(),
            "proposalFields": items.first().map(object_keys).unwrap_or_default()
        }),
        Ok(other) => json!({
            "root": value_kind(&other)
        }),
        Err(error) => json!({
            "root": "invalid-json",
            "chars": text.chars().count(),
            "error": error
        }),
    }
}

pub fn validate_proposals(
    interaction: &CapturedInteraction,
    proposals: Vec<ExtractedMemoryProposal>,
) -> Result<Vec<ExtractedMemoryProposal>, String> {
    let turns = interaction
        .turns
        .iter()
        .map(|turn| (turn.id.as_str(), turn))
        .collect::<BTreeMap<_, _>>();
    let aliases = interaction
        .turns
        .iter()
        .zip(turn_aliases(interaction))
        .map(|(turn, alias)| (alias, turn.id.as_str()))
        .collect::<BTreeMap<_, _>>();
    let incomplete = matches!(
        interaction.fidelity,
        CaptureFidelity::TaskSummary | CaptureFidelity::PartialVisible
    );

    let mut valid = Vec::with_capacity(proposals.len());

    for mut proposal in proposals {
        if proposal.key.trim().is_empty() || proposal.evidence.trim().is_empty() {
            return Err("Extractor returned an empty key or evidence string.".to_owned());
        }
        if !(0.0..=1.0).contains(&proposal.confidence) || !proposal.confidence.is_finite() {
            return Err(format!(
                "Extractor returned invalid confidence for {}.",
                proposal.key
            ));
        }
        if secret_like_key(&proposal.key) {
            continue;
        }
        if proposal.evidence_turn_ids.is_empty() {
            return Err(format!(
                "Extractor returned {} without evidence turn IDs.",
                proposal.key
            ));
        }

        let resolved_evidence_turn_ids = proposal
            .evidence_turn_ids
            .iter()
            .map(|turn_id| {
                if turns.contains_key(turn_id.as_str()) {
                    return Ok(turn_id.clone());
                }

                aliases
                    .get(&turn_id.to_ascii_lowercase())
                    .map(|captured_id| (*captured_id).to_owned())
                    .ok_or_else(|| {
                        format!(
                            "Extractor referenced unknown evidence turn {turn_id} for {}.",
                            proposal.key
                        )
                    })
            })
            .collect::<Result<Vec<_>, String>>()?;
        proposal.evidence_turn_ids = resolved_evidence_turn_ids;

        let has_user_evidence = proposal.evidence_turn_ids.iter().any(|turn_id| {
            turns
                .get(turn_id.as_str())
                .map(|turn| matches!(turn.role, CaptureRole::User))
                .unwrap_or(false)
        });
        if !has_user_evidence {
            return Err(format!(
                "Extractor proposal {} is not grounded in a user-authored turn.",
                proposal.key
            ));
        }

        if incomplete
            && !matches!(
                proposal.epistemic_type,
                EpistemicType::Assertion | EpistemicType::Preference
            )
        {
            continue;
        }

        if let Some(valid_until) = &proposal.valid_until {
            chrono::DateTime::parse_from_rfc3339(valid_until).map_err(|_| {
                format!(
                    "Extractor returned invalid validUntil for {}.",
                    proposal.key
                )
            })?;
        }

        valid.push(proposal);
    }

    Ok(valid)
}

fn secret_like_key(key: &str) -> bool {
    let normalised = key.to_ascii_lowercase().replace(['-', '.'], "_");
    [
        "password",
        "passwd",
        "api_key",
        "apikey",
        "auth_token",
        "access_token",
        "refresh_token",
        "secret",
        "credential",
        "private_key",
    ]
    .iter()
    .any(|needle| normalised.contains(needle))
}

#[cfg(test)]
mod tests {
    use super::*;
    use topo_contracts::{
        CaptureClient, CaptureKind, CaptureMethod, CaptureMode, CaptureProduct, Sensitivity,
        SourceRetention,
    };

    fn interaction(fidelity: CaptureFidelity) -> CapturedInteraction {
        CapturedInteraction {
            id: "chatgpt-web-example".to_owned(),
            kind: CaptureKind::Conversation,
            product: CaptureProduct::Chatgpt,
            client: CaptureClient::Web,
            mode: CaptureMode::Chat,
            capture_method: CaptureMethod::BrowserExtension,
            fidelity,
            provider: "openai".to_owned(),
            subject: "self".to_owned(),
            title: Some("Example".to_owned()),
            external_id: Some("example".to_owned()),
            source_url: None,
            captured_at: "2026-08-31T20:00:00Z".to_owned(),
            turns: vec![
                topo_contracts::CapturedTurn {
                    id: "user-0-8c19d2af".to_owned(),
                    role: CaptureRole::User,
                    content: "Please use British English.".to_owned(),
                    occurred_at: None,
                },
                topo_contracts::CapturedTurn {
                    id: "assistant-1-1bc44902".to_owned(),
                    role: CaptureRole::Assistant,
                    content: "Understood.".to_owned(),
                    occurred_at: None,
                },
            ],
            retention: SourceRetention::ReviewWindow,
            metadata: None,
        }
    }

    fn preference() -> ExtractedMemoryProposal {
        ExtractedMemoryProposal {
            key: "writing.locale".to_owned(),
            value: Value::String("en-GB".to_owned()),
            category: Some("writing".to_owned()),
            tags: Some(vec!["writing".to_owned()]),
            epistemic_type: EpistemicType::Preference,
            confidence: 0.98,
            sensitivity: Some(Sensitivity::Ordinary),
            horizon: None,
            evidence_turn_ids: vec!["u1".to_owned()],
            evidence: "Please use British English.".to_owned(),
            valid_until: None,
        }
    }

    #[test]
    fn parses_enveloped_json() {
        let proposals = parse_proposals(
            r#"{"proposals":[{"key":"writing.locale","value":"en-GB","epistemicType":"preference","confidence":0.98,"evidenceTurnIds":["u1"],"evidence":"Please use British English."}]}"#,
        )
        .unwrap();
        assert_eq!(proposals.len(), 1);
        assert_eq!(proposals[0].key, "writing.locale");
    }

    #[test]
    fn accepts_single_proposal_and_common_local_model_aliases() {
        let proposals = parse_proposals(
            r#"{
              "key":"writing.locale",
              "value":"en-GB",
              "epistemic_type":"preference",
              "confidence":"98",
              "evidence_turn_ids":"u1",
              "evidence":"Please use British English."
            }"#,
        )
        .unwrap();
        assert_eq!(proposals.len(), 1);
        assert_eq!(proposals[0].confidence, 0.98);
        assert_eq!(proposals[0].evidence_turn_ids, vec!["u1".to_owned()]);
    }

    #[test]
    fn normalises_information_to_assertion() {
        let proposals = parse_proposals(
            r#"{"proposals":[{"key":"project.event.example","value":"North East niche businesses","epistemicType":"information","confidence":0.9,"evidenceTurnIds":["u1"],"evidence":"Give me the nichest of niche actual businesses"}]}"#,
        )
        .unwrap();
        assert_eq!(proposals.len(), 1);
        assert_eq!(proposals[0].epistemic_type, EpistemicType::Assertion);
    }

    #[test]
    fn accepts_memories_wrapper_from_small_local_models() {
        let proposals = parse_proposals(
            r#"{"memories":[{"key":"writing.locale","value":"en-GB","epistemicType":"preference","confidence":0.98,"evidenceTurnIds":["u1"],"evidence":"Please use British English."}]}"#,
        )
        .unwrap();
        assert_eq!(proposals.len(), 1);
    }

    #[test]
    fn contract_error_names_missing_field() {
        let error = parse_proposals(
            r#"{"proposals":[{"key":"writing.locale","value":"en-GB"}]}"#,
        )
        .unwrap_err();
        assert!(error.contains("epistemicType"));
        assert!(error.contains("Fields seen"));
    }

    #[test]
    fn resolves_model_alias_to_captured_turn_id() {
        let result = validate_proposals(
            &interaction(CaptureFidelity::ConversationTurns),
            vec![preference()],
        )
        .unwrap();
        assert_eq!(
            result[0].evidence_turn_ids,
            vec!["user-0-8c19d2af".to_owned()]
        );
    }

    #[test]
    fn rejects_assistant_only_evidence() {
        let mut proposal = preference();
        proposal.evidence_turn_ids = vec!["a1".to_owned()];
        assert!(validate_proposals(
            &interaction(CaptureFidelity::ConversationTurns),
            vec![proposal]
        )
        .is_err());
    }

    #[test]
    fn incomplete_capture_drops_inference() {
        let mut proposal = preference();
        proposal.epistemic_type = EpistemicType::Inference;
        let result =
            validate_proposals(&interaction(CaptureFidelity::PartialVisible), vec![proposal])
                .unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn secret_like_keys_are_filtered() {
        let mut proposal = preference();
        proposal.key = "project.api_key".to_owned();
        let result =
            validate_proposals(&interaction(CaptureFidelity::ConversationTurns), vec![proposal])
                .unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn transcript_preserves_turn_ids_and_roles() {
        let transcript = format_interaction(&interaction(CaptureFidelity::ConversationTurns));
        assert!(transcript.contains("[TURN u1][USER]"));
        assert!(transcript.contains("[TURN a1][ASSISTANT]"));
    }

    #[test]
    fn partial_prompt_forbids_inference() {
        let prompt = extraction_prompt(&CaptureFidelity::TaskSummary);
        assert!(prompt.contains("This capture is incomplete"));
        assert!(prompt.contains("Do not propose observations, inferences or derived patterns"));
    }
}
