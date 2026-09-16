use reqwest::Client;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    time::{Duration, Instant},
};
use topo_contracts::{
    CaptureFidelity, CaptureRole, CapturedInteraction, EpistemicType,
    ExtractedMemoryPageProposal, ExtractedMemoryProposal,
};

const OLLAMA_BASE_URL: &str = "http://127.0.0.1:11434";
pub const RECOMMENDED_MODEL: &str = "qwen3:4b";
const MAX_TRANSCRIPT_CHARS: usize = 60_000;
const OLLAMA_REQUEST_TIMEOUT_SECS: u64 = 300;
const DIAGNOSTIC_LOG_NAME: &str = "extractor-alpha.jsonl";
pub const MAX_MEMORY_PAGE_PROPOSALS: usize = 4;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaStatus {
    pub available: bool,
    pub models: Vec<String>,
    pub recommended_model: &'static str,
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

struct OllamaCallResult {
    content: String,
    elapsed_ms: u64,
    metrics: Value,
}

struct FormattedExtractionInput {
    content: String,
    alias_to_original: BTreeMap<String, String>,
}

fn extractor_diagnostics_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Unable to determine the home folder.".to_owned())?;
    Ok(home.join(".topo").join("logs").join(DIAGNOSTIC_LOG_NAME))
}

fn append_extractor_diagnostic(mut event: Value) {
    let Ok(path) = extractor_diagnostics_path() else {
        return;
    };
    if let Some(parent) = path.parent() {
        if fs::create_dir_all(parent).is_err() {
            return;
        }
    }
    let Value::Object(ref mut object) = event else {
        return;
    };
    object.insert(
        "at".to_owned(),
        Value::String(chrono::Utc::now().to_rfc3339()),
    );
    let Ok(line) = serde_json::to_string(&event) else {
        return;
    };
    let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) else {
        return;
    };
    let _ = writeln!(file, "{line}");
}

fn elapsed_ms(started: Instant) -> u64 {
    started.elapsed().as_millis().min(u64::MAX as u128) as u64
}

fn object_field_names(value: &Value) -> Vec<String> {
    value
        .as_object()
        .map(|object| object.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default()
}

fn json_shape_summary(text: &str) -> Value {
    match serde_json::from_str::<Value>(text.trim()) {
        Ok(Value::Object(object)) => {
            let top_level_fields = object.keys().cloned().collect::<Vec<_>>();
            let proposal_fields = object
                .get("proposals")
                .and_then(Value::as_array)
                .and_then(|items| items.first())
                .map(object_field_names)
                .unwrap_or_default();
            json!({
                "root": "object",
                "topLevelFields": top_level_fields,
                "proposalFields": proposal_fields
            })
        }
        Ok(Value::Array(items)) => json!({
            "root": "array",
            "length": items.len(),
            "proposalFields": items.first().map(object_field_names).unwrap_or_default()
        }),
        Ok(other) => json!({
            "root": match other {
                Value::Null => "null",
                Value::Bool(_) => "boolean",
                Value::Number(_) => "number",
                Value::String(_) => "string",
                Value::Array(_) | Value::Object(_) => unreachable!(),
            }
        }),
        Err(error) => json!({
            "root": "invalid-json",
            "error": error.to_string()
        }),
    }
}

#[tauri::command]
pub async fn ollama_extractor_status() -> OllamaStatus {
    let client = match Client::builder().timeout(Duration::from_secs(3)).build() {
        Ok(client) => client,
        Err(error) => {
            return OllamaStatus {
                available: false,
                models: Vec::new(),
                recommended_model: RECOMMENDED_MODEL,
                error: Some(error.to_string()),
            }
        }
    };

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
                        recommended_model: RECOMMENDED_MODEL,
                        error: None,
                    }
                }
                Err(error) => OllamaStatus {
                    available: false,
                    models: Vec::new(),
                    recommended_model: RECOMMENDED_MODEL,
                    error: Some(format!("Ollama returned an unreadable model list: {error}")),
                },
            }
        }
        Ok(response) => OllamaStatus {
            available: false,
            models: Vec::new(),
            recommended_model: RECOMMENDED_MODEL,
            error: Some(format!("Ollama returned HTTP {}.", response.status())),
        },
        Err(error) => OllamaStatus {
            available: false,
            models: Vec::new(),
            recommended_model: RECOMMENDED_MODEL,
            error: Some(format!("Ollama is not reachable: {error}")),
        },
    }
}

#[tauri::command]
pub async fn install_recommended_ollama_model() -> Result<OllamaStatus, String> {
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(30 * 60))
        .build()
        .map_err(|error| error.to_string())?;

    let response = client
        .post(format!("{OLLAMA_BASE_URL}/api/pull"))
        .json(&json!({
            "model": RECOMMENDED_MODEL,
            "stream": false
        }))
        .send()
        .await
        .map_err(|error| {
            format!(
                "Could not install the recommended local model. Make sure Ollama is open, then try again: {error}"
            )
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Ollama could not install {RECOMMENDED_MODEL} (HTTP {status}): {}",
            body.chars().take(500).collect::<String>()
        ));
    }

    Ok(ollama_extractor_status().await)
}

async fn call_ollama(
    interaction: &CapturedInteraction,
    model: &str,
    system: String,
    representation: &'static str,
    user_content: String,
    format: Value,
) -> Result<OllamaCallResult, String> {
    let model = model.trim();
    if model.is_empty() {
        return Err("Choose an Ollama model before extracting capture.".to_owned());
    }

    let started = Instant::now();
    append_extractor_diagnostic(json!({
        "event": "extract.start",
        "interactionId": interaction.id,
        "model": model,
        "representation": representation,
        "turnCount": interaction.turns.len(),
        "transcriptChars": user_content.chars().count(),
        "timeoutSeconds": OLLAMA_REQUEST_TIMEOUT_SECS
    }));

    let client = Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(OLLAMA_REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|error| error.to_string())?;

    let response = client
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
        .send()
        .await
        .map_err(|error| {
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
        })?;

    let status = response.status();
    let body = response.text().await.map_err(|error| {
        append_extractor_diagnostic(json!({
            "event": "extract.response_read_failed",
            "interactionId": interaction.id,
            "model": model,
            "representation": representation,
            "elapsedMs": elapsed_ms(started),
            "error": error.to_string()
        }));
        format!("Could not read Ollama response from {model}: {error}")
    })?;

    if !status.is_success() {
        append_extractor_diagnostic(json!({
            "event": "extract.http_error",
            "interactionId": interaction.id,
            "model": model,
            "representation": representation,
            "elapsedMs": elapsed_ms(started),
            "httpStatus": status.as_u16(),
            "bodyChars": body.chars().count()
        }));
        return Err(format!(
            "Ollama model {model} returned HTTP {status}: {}",
            body.chars().take(500).collect::<String>()
        ));
    }

    let payload = serde_json::from_str::<OllamaChatResponse>(&body).map_err(|error| {
        append_extractor_diagnostic(json!({
            "event": "extract.ollama_envelope_invalid",
            "interactionId": interaction.id,
            "model": model,
            "representation": representation,
            "elapsedMs": elapsed_ms(started),
            "responseChars": body.chars().count(),
            "error": error.to_string()
        }));
        format!("Ollama returned an unreadable chat response for {model}: {error}")
    })?;

    let elapsed = elapsed_ms(started);
    let metrics = json!({
        "doneReason": payload.done_reason,
        "totalDurationNs": payload.total_duration,
        "loadDurationNs": payload.load_duration,
        "promptEvalCount": payload.prompt_eval_count,
        "promptEvalDurationNs": payload.prompt_eval_duration,
        "evalCount": payload.eval_count,
        "evalDurationNs": payload.eval_duration
    });

    Ok(OllamaCallResult {
        content: payload.message.content,
        elapsed_ms: elapsed,
        metrics,
    })
}

/// Legacy Claim extractor retained during the Memory Page migration.
pub async fn extract_with_ollama(
    interaction: &CapturedInteraction,
    model: &str,
) -> Result<Vec<ExtractedMemoryProposal>, String> {
    let call = call_ollama(
        interaction,
        model,
        extraction_prompt(&interaction.fidelity),
        "claim-compatibility",
        format_interaction(interaction),
        Value::String("json".to_owned()),
    )
    .await?;
    let proposals = parse_proposals(&call.content).map_err(|error| {
        append_extractor_diagnostic(json!({
            "event": "extract.proposal_parse_failed",
            "interactionId": interaction.id,
            "model": model,
            "representation": "claim-compatibility",
            "elapsedMs": call.elapsed_ms,
            "modelOutputChars": call.content.chars().count(),
            "modelOutputShape": json_shape_summary(&call.content),
            "error": error
        }));
        format!("{model} returned JSON TOPO could not use: {error}")
    })?;
    let validated = validate_proposals(interaction, proposals).map_err(|error| {
        append_extractor_diagnostic(json!({
            "event": "extract.validation_failed",
            "interactionId": interaction.id,
            "model": model,
            "representation": "claim-compatibility",
            "elapsedMs": call.elapsed_ms,
            "error": error
        }));
        error
    })?;
    append_extractor_diagnostic(json!({
        "event": "extract.success",
        "interactionId": interaction.id,
        "model": model,
        "representation": "claim-compatibility",
        "elapsedMs": call.elapsed_ms,
        "proposalCount": validated.len(),
        "ollama": call.metrics
    }));
    Ok(validated)
}

/// Primary extractor. Produces a small number of coherent prose Memory Pages.
pub async fn extract_pages_with_ollama(
    interaction: &CapturedInteraction,
    model: &str,
) -> Result<Vec<ExtractedMemoryPageProposal>, String> {
    let formatted = format_interaction_for_page_extraction(interaction);
    let schema = memory_page_output_schema();
    let first = call_ollama(
        interaction,
        model,
        page_extraction_prompt(&interaction.fidelity),
        "memory-page",
        formatted.content.clone(),
        schema.clone(),
    )
    .await?;

    match parse_and_validate_page_output(interaction, &formatted.alias_to_original, &first.content) {
        Ok((valid, rejected)) if !valid.is_empty() || rejected.is_empty() => {
            if !rejected.is_empty() {
                append_extractor_diagnostic(json!({
                    "event": "extract.memory_page_partial_rejection",
                    "interactionId": interaction.id,
                    "model": model,
                    "representation": "memory-page",
                    "elapsedMs": first.elapsed_ms,
                    "accepted": valid.len(),
                    "rejected": rejected.len(),
                    "reasons": rejected
                }));
            }
            append_extractor_diagnostic(json!({
                "event": "extract.memory_page_success",
                "interactionId": interaction.id,
                "model": model,
                "representation": "memory-page",
                "elapsedMs": first.elapsed_ms,
                "proposalCount": valid.len(),
                "ollama": first.metrics
            }));
            return Ok(valid);
        }
        first_result => {
            let first_error = match first_result {
                Ok((_valid, rejected)) => format!(
                    "All proposed Memory Pages failed evidence validation: {}",
                    rejected.join(" | ")
                ),
                Err(error) => error,
            };

            append_extractor_diagnostic(json!({
                "event": "extract.memory_page_repair_started",
                "interactionId": interaction.id,
                "model": model,
                "representation": "memory-page",
                "firstError": first_error
            }));

            let repair_system = format!(
                "{}\n\nREPAIR PASS:\nThe previous extraction could not be accepted by TOPO. Correct the output using only the supplied legal USER evidence aliases. Remove any proposal that cannot be directly supported. Do not invent turn IDs, evidence, enum values or project state. Return fresh JSON matching the schema.\nValidation problem: {}",
                page_extraction_prompt(&interaction.fidelity),
                first_error
            );
            let repaired = call_ollama(
                interaction,
                model,
                repair_system,
                "memory-page-repair",
                formatted.content.clone(),
                schema,
            )
            .await?;

            match parse_and_validate_page_output(
                interaction,
                &formatted.alias_to_original,
                &repaired.content,
            ) {
                Ok((valid, rejected)) if !valid.is_empty() || rejected.is_empty() => {
                    append_extractor_diagnostic(json!({
                        "event": "extract.memory_page_repair_success",
                        "interactionId": interaction.id,
                        "model": model,
                        "accepted": valid.len(),
                        "rejected": rejected.len(),
                        "elapsedMs": repaired.elapsed_ms,
                        "ollama": repaired.metrics
                    }));
                    Ok(valid)
                }
                Ok((_valid, rejected)) => {
                    let error = format!(
                        "{} returned Memory Pages that failed TOPO evidence validation after one repair pass: {}",
                        model,
                        rejected.join(" | ")
                    );
                    append_extractor_diagnostic(json!({
                        "event": "extract.memory_page_repair_failed",
                        "interactionId": interaction.id,
                        "model": model,
                        "error": error
                    }));
                    Err(error)
                }
                Err(error) => {
                    append_extractor_diagnostic(json!({
                        "event": "extract.memory_page_repair_failed",
                        "interactionId": interaction.id,
                        "model": model,
                        "error": error
                    }));
                    Err(format!(
                        "{model} returned Memory Page JSON TOPO could not use after one repair pass: {error}"
                    ))
                }
            }
        }
    }
}

fn memory_page_output_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["proposals"],
        "properties": {
            "proposals": {
                "type": "array",
                "maxItems": MAX_MEMORY_PAGE_PROPOSALS,
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["title", "body", "evidenceTurnIds", "evidence"],
                    "properties": {
                        "title": { "type": "string" },
                        "summary": { "type": "string" },
                        "body": { "type": "string" },
                        "category": { "type": "string" },
                        "tags": { "type": "array", "items": { "type": "string" } },
                        "sensitivity": {
                            "type": "string",
                            "enum": ["ordinary", "personal", "sensitive", "restricted"]
                        },
                        "horizon": {
                            "type": "string",
                            "enum": ["durable", "project", "temporary"]
                        },
                        "evidenceTurnIds": {
                            "type": "array",
                            "minItems": 1,
                            "items": { "type": "string", "pattern": "^u[0-9]+$" }
                        },
                        "evidence": { "type": "string" },
                        "validFrom": { "type": "string" },
                        "validUntil": { "type": "string" },
                        "annotations": {
                            "type": "array",
                            "maxItems": 8,
                            "items": {
                                "type": "object",
                                "additionalProperties": false,
                                "required": ["key", "value", "epistemicType", "confidence"],
                                "properties": {
                                    "key": { "type": "string" },
                                    "value": {},
                                    "category": { "type": "string" },
                                    "tags": { "type": "array", "items": { "type": "string" } },
                                    "epistemicType": {
                                        "type": "string",
                                        "enum": ["assertion", "observation", "inference", "preference", "derived-pattern"]
                                    },
                                    "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
                                    "sensitivity": {
                                        "type": "string",
                                        "enum": ["ordinary", "personal", "sensitive", "restricted"]
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    })
}

pub fn page_extraction_prompt(fidelity: &CaptureFidelity) -> String {
    let incomplete = matches!(
        fidelity,
        CaptureFidelity::TaskSummary | CaptureFidelity::PartialVisible
    );

    let mut rules = vec![
        "You identify a small number of coherent pieces of user-owned context that may materially improve future AI interactions.",
        "The primary memory object is a short prose Memory Page, not a collection of atomic facts.",
        "Return candidate pages only. A human will review them before they become durable memory.",
        "Return at most 4 Memory Pages and prefer fewer. One or two useful pages is better than a spray of facts.",
        "Each page should capture one coherent thing worth remembering, such as a project decision, useful preference in context, working relationship, recurring pattern, current circumstance, or relevant background.",
        "Write each body as concise natural prose that remains useful when copied into an ordinary Markdown note.",
        "Do not split closely related context into separate pages merely because several facts are present.",
        "evidenceTurnIds may contain ONLY the short USER aliases listed in the LEGAL USER EVIDENCE ALIASES block, for example u1 or u2.",
        "Assistant, tool and system messages may orient you but are NEVER evidence about the user and must not be turned into remembered project status or facts unless the user explicitly stated them.",
        "Evidence must be a short verbatim excerpt from the cited USER turn.",
        "Questions are weak evidence. Do not turn a question into a fact unless the user explicitly states that fact.",
        "If the assistant claims work is complete, a version exists, a roadmap changed, or a project has a status that the user did not explicitly state, do not remember that claim.",
        "Use horizon durable for stable preferences/enduring context, project for active project context, temporary for short-lived circumstances.",
        "Only include structured annotations when a machine-readable key/value materially helps deterministic filtering, temporal comparison or interoperability.",
        "Do not create annotations merely to duplicate every sentence in the page.",
        "Do not extract passwords, authentication tokens, API keys, financial credentials or other secrets.",
        "Be conservative with sensitive personal data and set sensitivity when needed.",
    ];

    if incomplete {
        rules.push("This capture is incomplete. Only propose pages directly supported by user-authored evidence.");
        rules.push("Do not infer patterns, motivations or personal characteristics from this incomplete source.");
        rules.push("Any structured annotations must use assertion or preference epistemic types only.");
    }

    format!(
        "{}\n\nReturn JSON only using the supplied structured-output schema. Return {{\"proposals\":[]}} when nothing is genuinely worth remembering.",
        rules
            .into_iter()
            .map(|rule| format!("- {rule}"))
            .collect::<Vec<_>>()
            .join("\n")
    )
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
      "evidence": "Please use British English."
    }
  ]
}

Omit optional fields instead of returning null. Return {"proposals":[]} when nothing is genuinely worth remembering."#
    )
}

pub fn format_interaction(interaction: &CapturedInteraction) -> String {
    let mut output = String::new();

    for turn in &interaction.turns {
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

        let line = format!("[TURN {}][{}]: {}\n", turn.id, role, content);
        if output.len() + line.len() > MAX_TRANSCRIPT_CHARS {
            output.push_str("[... transcript truncated by TOPO ...]\n");
            break;
        }
        output.push_str(&line);
    }

    output
}

fn format_interaction_for_page_extraction(interaction: &CapturedInteraction) -> FormattedExtractionInput {
    let mut output = String::from(
        "CONVERSATION CONTEXT\nAssistant/tool/system turns may help orientation, but only USER aliases listed later are legal evidence.\n\n",
    );
    let mut alias_to_original = BTreeMap::new();
    let mut user_aliases = Vec::new();
    let mut user_index = 0usize;
    let mut assistant_index = 0usize;
    let mut system_index = 0usize;
    let mut tool_index = 0usize;

    for turn in &interaction.turns {
        let (alias, role, limit) = match turn.role {
            CaptureRole::User => {
                user_index += 1;
                (format!("u{user_index}"), "USER", 5_000)
            }
            CaptureRole::Assistant => {
                assistant_index += 1;
                (format!("a{assistant_index}"), "ASSISTANT", 2_000)
            }
            CaptureRole::System => {
                system_index += 1;
                (format!("s{system_index}"), "SYSTEM", 1_000)
            }
            CaptureRole::Tool => {
                tool_index += 1;
                (format!("t{tool_index}"), "TOOL", 1_000)
            }
        };
        alias_to_original.insert(alias.clone(), turn.id.clone());
        if matches!(turn.role, CaptureRole::User) {
            user_aliases.push(alias.clone());
        }

        let mut content = turn.content.chars().take(limit).collect::<String>();
        if turn.content.chars().count() > limit {
            content.push_str(" …[truncated]");
        }
        let line = format!("[TURN {alias}][{role}]: {content}\n");
        if output.len() + line.len() > MAX_TRANSCRIPT_CHARS {
            output.push_str("[... transcript truncated by TOPO ...]\n");
            break;
        }
        output.push_str(&line);
    }

    output.push_str("\nLEGAL USER EVIDENCE ALIASES\n");
    output.push_str("Only these IDs may appear in evidenceTurnIds: ");
    output.push_str(&user_aliases.join(", "));
    output.push_str("\nQuote evidence verbatim from the matching USER turn above. If none supports a memory, return an empty proposals array.\n");

    FormattedExtractionInput {
        content: output,
        alias_to_original,
    }
}

fn proposal_source_value(text: &str) -> Result<Value, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Ok(json!({ "proposals": [] }));
    }
    if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
        return Ok(value);
    }
    let candidate = extract_json_object(trimmed)
        .ok_or_else(|| "Extractor response did not contain valid JSON.".to_owned())?;
    serde_json::from_str::<Value>(&candidate)
        .map_err(|error| format!("Extractor response contained invalid JSON: {error}"))
}

fn parse_typed_proposals<T: DeserializeOwned>(text: &str, contract: &str) -> Result<Vec<T>, String> {
    let value = proposal_source_value(text)?;
    let items = match value {
        Value::Array(items) => items,
        Value::Object(mut object) => match object.remove("proposals") {
            Some(Value::Array(items)) => items,
            Some(other) => {
                return Err(format!(
                    "Extractor {contract} field 'proposals' was {}, not an array.",
                    value_kind(&other)
                ))
            }
            None => {
                let fields = object.keys().cloned().collect::<Vec<_>>().join(", ");
                return Err(format!(
                    "Extractor JSON did not match the TOPO {contract} contract. Top-level fields seen: {fields}"
                ));
            }
        },
        other => {
            return Err(format!(
                "Extractor {contract} response had {} at the root; expected an object or array.",
                value_kind(&other)
            ))
        }
    };

    let mut parsed = Vec::with_capacity(items.len());
    for (index, item) in items.into_iter().enumerate() {
        let fields = object_field_names(&item).join(", ");
        match serde_json::from_value::<T>(item) {
            Ok(proposal) => parsed.push(proposal),
            Err(error) => {
                return Err(format!(
                    "proposal {} did not match the TOPO {contract} contract: {error}. Fields seen: {fields}",
                    index + 1
                ));
            }
        }
    }
    Ok(parsed)
}

fn value_kind(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "a boolean",
        Value::Number(_) => "a number",
        Value::String(_) => "a string",
        Value::Array(_) => "an array",
        Value::Object(_) => "an object",
    }
}

pub fn parse_page_proposals(text: &str) -> Result<Vec<ExtractedMemoryPageProposal>, String> {
    parse_typed_proposals(text, "Memory Page proposal")
}

pub fn parse_proposals(text: &str) -> Result<Vec<ExtractedMemoryProposal>, String> {
    parse_typed_proposals(text, "proposal")
}

fn extract_json_object(text: &str) -> Option<String> {
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    (end > start).then(|| text[start..=end].to_owned())
}

fn normalise_evidence(value: &str) -> String {
    value
        .to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn resolve_page_aliases(
    mut proposal: ExtractedMemoryPageProposal,
    alias_to_original: &BTreeMap<String, String>,
) -> Result<ExtractedMemoryPageProposal, String> {
    let mut resolved = Vec::with_capacity(proposal.evidence_turn_ids.len());
    for alias in &proposal.evidence_turn_ids {
        let original = alias_to_original.get(alias).ok_or_else(|| {
            format!(
                "Extractor referenced unknown evidence alias {alias} for '{}'. Legal evidence IDs are the supplied u1/u2-style USER aliases.",
                proposal.title
            )
        })?;
        resolved.push(original.clone());
    }
    proposal.evidence_turn_ids = resolved;
    Ok(proposal)
}

fn parse_and_validate_page_output(
    interaction: &CapturedInteraction,
    alias_to_original: &BTreeMap<String, String>,
    output: &str,
) -> Result<(Vec<ExtractedMemoryPageProposal>, Vec<String>), String> {
    let proposals = parse_page_proposals(output)?;
    if proposals.len() > MAX_MEMORY_PAGE_PROPOSALS {
        return Err(format!(
            "Extractor returned {} Memory Pages; maximum is {}.",
            proposals.len(), MAX_MEMORY_PAGE_PROPOSALS
        ));
    }

    let mut resolved = Vec::with_capacity(proposals.len());
    let mut rejected = Vec::new();
    for proposal in proposals {
        match resolve_page_aliases(proposal, alias_to_original) {
            Ok(proposal) => resolved.push(proposal),
            Err(error) => rejected.push(error),
        }
    }

    let (mut valid, validation_rejections) = validate_page_proposals_partial(interaction, resolved)?;
    rejected.extend(validation_rejections);
    valid.shrink_to_fit();
    Ok((valid, rejected))
}

fn validate_single_page_proposal(
    interaction: &CapturedInteraction,
    mut proposal: ExtractedMemoryPageProposal,
) -> Result<ExtractedMemoryPageProposal, String> {
    let turns = interaction
        .turns
        .iter()
        .map(|turn| (turn.id.as_str(), turn))
        .collect::<BTreeMap<_, _>>();
    let incomplete = matches!(
        interaction.fidelity,
        CaptureFidelity::TaskSummary | CaptureFidelity::PartialVisible
    );

    if proposal.title.trim().is_empty()
        || proposal.body.trim().is_empty()
        || proposal.evidence.trim().is_empty()
    {
        return Err("Extractor returned a Memory Page with an empty title, body or evidence.".to_owned());
    }
    if proposal.evidence_turn_ids.is_empty() {
        return Err(format!(
            "Extractor returned '{}' without evidence turn IDs.",
            proposal.title
        ));
    }

    let mut user_turns = Vec::new();
    for turn_id in &proposal.evidence_turn_ids {
        let turn = turns.get(turn_id.as_str()).ok_or_else(|| {
            format!(
                "Extractor referenced unknown evidence turn {turn_id} for '{}'.",
                proposal.title
            )
        })?;
        if matches!(turn.role, CaptureRole::User) {
            user_turns.push(*turn);
        }
    }
    if user_turns.is_empty() {
        return Err(format!(
            "Extractor Memory Page '{}' is not grounded in a user-authored turn.",
            proposal.title
        ));
    }

    let evidence = normalise_evidence(&proposal.evidence);
    if !user_turns
        .iter()
        .any(|turn| normalise_evidence(&turn.content).contains(&evidence))
    {
        return Err(format!(
            "Extractor Memory Page '{}' evidence is not present in its cited user turn.",
            proposal.title
        ));
    }

    let mut seen_tags = std::collections::BTreeSet::new();
    if proposal
        .tags
        .as_ref()
        .is_some_and(|tags| tags.iter().any(|tag| !seen_tags.insert(tag.trim().to_owned())))
    {
        return Err(format!("Extractor returned duplicate tags for '{}'.", proposal.title));
    }

    if let Some(annotations) = proposal.annotations.as_mut() {
        if annotations.len() > 8 {
            return Err(format!(
                "Extractor returned too many structured annotations for '{}'.",
                proposal.title
            ));
        }
        annotations.retain(|annotation| !secret_like_key(&annotation.key));
        for annotation in annotations.iter() {
            if annotation.key.trim().is_empty()
                || !(0.0..=1.0).contains(&annotation.confidence)
                || !annotation.confidence.is_finite()
            {
                return Err(format!(
                    "Extractor returned an invalid annotation for '{}'.",
                    proposal.title
                ));
            }
            if incomplete
                && !matches!(
                    annotation.epistemic_type,
                    EpistemicType::Assertion | EpistemicType::Preference
                )
            {
                return Err(format!(
                    "Incomplete capture cannot propose inferred annotation {}.",
                    annotation.key
                ));
            }
        }
    }

    if let Some(valid_from) = &proposal.valid_from {
        chrono::DateTime::parse_from_rfc3339(valid_from).map_err(|_| {
            format!("Extractor returned invalid validFrom for '{}'.", proposal.title)
        })?;
    }
    if let Some(valid_until) = &proposal.valid_until {
        chrono::DateTime::parse_from_rfc3339(valid_until).map_err(|_| {
            format!("Extractor returned invalid validUntil for '{}'.", proposal.title)
        })?;
    }
    if let (Some(valid_from), Some(valid_until)) = (&proposal.valid_from, &proposal.valid_until) {
        let from = chrono::DateTime::parse_from_rfc3339(valid_from).map_err(|e| e.to_string())?;
        let until = chrono::DateTime::parse_from_rfc3339(valid_until).map_err(|e| e.to_string())?;
        if until < from {
            return Err(format!("validUntil cannot be before validFrom for '{}'.", proposal.title));
        }
    }

    Ok(proposal)
}

fn validate_page_proposals_partial(
    interaction: &CapturedInteraction,
    proposals: Vec<ExtractedMemoryPageProposal>,
) -> Result<(Vec<ExtractedMemoryPageProposal>, Vec<String>), String> {
    if proposals.len() > MAX_MEMORY_PAGE_PROPOSALS {
        return Err(format!(
            "Extractor returned {} Memory Pages; maximum is {}.",
            proposals.len(), MAX_MEMORY_PAGE_PROPOSALS
        ));
    }

    let mut valid = Vec::with_capacity(proposals.len());
    let mut rejected = Vec::new();
    for proposal in proposals {
        match validate_single_page_proposal(interaction, proposal) {
            Ok(proposal) => valid.push(proposal),
            Err(error) => rejected.push(error),
        }
    }
    Ok((valid, rejected))
}

pub fn validate_page_proposals(
    interaction: &CapturedInteraction,
    proposals: Vec<ExtractedMemoryPageProposal>,
) -> Result<Vec<ExtractedMemoryPageProposal>, String> {
    let (valid, rejected) = validate_page_proposals_partial(interaction, proposals)?;
    if rejected.is_empty() {
        Ok(valid)
    } else {
        Err(rejected.join(" | "))
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
    let incomplete = matches!(
        interaction.fidelity,
        CaptureFidelity::TaskSummary | CaptureFidelity::PartialVisible
    );

    let mut valid = Vec::with_capacity(proposals.len());

    for proposal in proposals {
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

        let mut has_user_evidence = false;
        for turn_id in &proposal.evidence_turn_ids {
            let turn = turns.get(turn_id.as_str()).ok_or_else(|| {
                format!(
                    "Extractor referenced unknown evidence turn {turn_id} for {}.",
                    proposal.key
                )
            })?;
            if matches!(turn.role, CaptureRole::User) {
                has_user_evidence = true;
            }
        }
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
        CaptureClient, CaptureKind, CaptureMethod, CaptureMode, CaptureProduct,
        MemoryPageAnnotationProposal, MemoryHorizon, Sensitivity, SourceRetention,
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
                    id: "provider-user-783a1d3e".to_owned(),
                    role: CaptureRole::User,
                    content: "Please use British English. RACK uses Neon rather than Supabase.".to_owned(),
                    occurred_at: None,
                },
                topo_contracts::CapturedTurn {
                    id: "provider-assistant-19af".to_owned(),
                    role: CaptureRole::Assistant,
                    content: "Understood. RACK version 9.9 is released.".to_owned(),
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
            evidence_turn_ids: vec!["provider-user-783a1d3e".to_owned()],
            evidence: "Please use British English.".to_owned(),
            valid_until: None,
        }
    }

    fn page_proposal() -> ExtractedMemoryPageProposal {
        ExtractedMemoryPageProposal {
            title: "RACK architecture".to_owned(),
            summary: None,
            body: "RACK uses Neon rather than Supabase.".to_owned(),
            category: Some("rack".to_owned()),
            tags: Some(vec!["rack".to_owned()]),
            sensitivity: Some(Sensitivity::Ordinary),
            horizon: Some(MemoryHorizon::Project),
            evidence_turn_ids: vec!["provider-user-783a1d3e".to_owned()],
            evidence: "RACK uses Neon rather than Supabase.".to_owned(),
            valid_from: None,
            valid_until: None,
            annotations: Some(vec![MemoryPageAnnotationProposal {
                key: "rack.database".to_owned(),
                value: Value::String("Neon".to_owned()),
                category: None,
                tags: None,
                epistemic_type: EpistemicType::Assertion,
                confidence: 0.99,
                sensitivity: Some(Sensitivity::Ordinary),
            }]),
        }
    }

    #[test]
    fn parses_enveloped_json() {
        let proposals = parse_proposals(
            r#"{"proposals":[{"key":"writing.locale","value":"en-GB","epistemicType":"preference","confidence":0.98,"evidenceTurnIds":["provider-user-783a1d3e"],"evidence":"Please use British English."}]}"#,
        )
        .unwrap();
        assert_eq!(proposals.len(), 1);
        assert_eq!(proposals[0].key, "writing.locale");
    }

    #[test]
    fn parses_page_first_enveloped_json() {
        let proposals = parse_page_proposals(
            r#"{"proposals":[{"title":"RACK architecture","body":"RACK uses Neon rather than Supabase.","evidenceTurnIds":["u1"],"evidence":"RACK uses Neon rather than Supabase."}]}"#,
        )
        .unwrap();
        assert_eq!(proposals.len(), 1);
        assert_eq!(proposals[0].title, "RACK architecture");
    }

    #[test]
    fn page_parse_failure_identifies_bad_proposal_and_fields() {
        let error = parse_page_proposals(
            r#"{"proposals":[{"title":"RACK architecture","body":"RACK uses Neon.","evidenceTurnIds":["u1"],"evidence":"RACK uses Neon.","annotations":[{"key":"rack.database","value":"Neon","epistemicType":"information","confidence":0.9}]}]}"#,
        )
        .unwrap_err();
        assert!(error.contains("proposal 1"));
        assert!(error.contains("unknown variant `information`"));
        assert!(error.contains("annotations"));
    }

    #[test]
    fn page_first_validation_requires_user_evidence_excerpt() {
        let proposal = page_proposal();
        assert_eq!(
            validate_page_proposals(
                &interaction(CaptureFidelity::ConversationTurns),
                vec![proposal]
            )
            .unwrap()
            .len(),
            1
        );
    }

    #[test]
    fn page_first_validation_rejects_proposal_spray() {
        let proposal = page_proposal();
        assert!(validate_page_proposals(
            &interaction(CaptureFidelity::ConversationTurns),
            vec![proposal; MAX_MEMORY_PAGE_PROPOSALS + 1]
        )
        .is_err());
    }

    #[test]
    fn partial_validation_keeps_good_page_when_sibling_is_bad() {
        let good = page_proposal();
        let mut bad = page_proposal();
        bad.title = "Assistant-only release status".to_owned();
        bad.evidence_turn_ids = vec!["provider-assistant-19af".to_owned()];
        bad.evidence = "RACK version 9.9 is released.".to_owned();
        let (valid, rejected) = validate_page_proposals_partial(
            &interaction(CaptureFidelity::ConversationTurns),
            vec![good, bad],
        )
        .unwrap();
        assert_eq!(valid.len(), 1);
        assert_eq!(rejected.len(), 1);
        assert!(rejected[0].contains("not grounded in a user-authored turn"));
    }

    #[test]
    fn incomplete_page_capture_rejects_inferred_annotations() {
        let mut proposal = page_proposal();
        proposal.annotations.as_mut().unwrap()[0].epistemic_type = EpistemicType::Inference;
        assert!(validate_page_proposals(
            &interaction(CaptureFidelity::PartialVisible),
            vec![proposal]
        )
        .is_err());
    }

    #[test]
    fn rejects_assistant_only_evidence() {
        let mut proposal = preference();
        proposal.evidence_turn_ids = vec!["provider-assistant-19af".to_owned()];
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
    fn page_extraction_uses_short_aliases_and_hides_provider_ids() {
        let formatted = format_interaction_for_page_extraction(
            &interaction(CaptureFidelity::ConversationTurns),
        );
        assert!(formatted.content.contains("[TURN u1][USER]"));
        assert!(formatted.content.contains("[TURN a1][ASSISTANT]"));
        assert!(formatted.content.contains("LEGAL USER EVIDENCE ALIASES"));
        assert!(!formatted.content.contains("provider-user-783a1d3e"));
        assert_eq!(
            formatted.alias_to_original.get("u1").map(String::as_str),
            Some("provider-user-783a1d3e")
        );
    }

    #[test]
    fn page_aliases_are_resolved_before_validation() {
        let formatted = format_interaction_for_page_extraction(
            &interaction(CaptureFidelity::ConversationTurns),
        );
        let output = r#"{"proposals":[{"title":"RACK architecture","body":"RACK uses Neon rather than Supabase.","evidenceTurnIds":["u1"],"evidence":"RACK uses Neon rather than Supabase."}]}"#;
        let (valid, rejected) = parse_and_validate_page_output(
            &interaction(CaptureFidelity::ConversationTurns),
            &formatted.alias_to_original,
            output,
        )
        .unwrap();
        assert_eq!(valid.len(), 1);
        assert!(rejected.is_empty());
        assert_eq!(valid[0].evidence_turn_ids, vec!["provider-user-783a1d3e"]);
    }

    #[test]
    fn structured_schema_constrains_annotation_epistemic_type() {
        let schema = memory_page_output_schema();
        let allowed = schema["properties"]["proposals"]["items"]["properties"]["annotations"]
            ["items"]["properties"]["epistemicType"]["enum"]
            .as_array()
            .unwrap();
        assert!(allowed.contains(&json!("preference")));
        assert!(!allowed.contains(&json!("process_state")));
    }

    #[test]
    fn transcript_preserves_turn_ids_and_roles_for_legacy_path() {
        let transcript = format_interaction(&interaction(CaptureFidelity::ConversationTurns));
        assert!(transcript.contains("[TURN provider-user-783a1d3e][USER]"));
        assert!(transcript.contains("[TURN provider-assistant-19af][ASSISTANT]"));
    }

    #[test]
    fn partial_prompt_forbids_inference() {
        let prompt = extraction_prompt(&CaptureFidelity::TaskSummary);
        assert!(prompt.contains("This capture is incomplete"));
        assert!(prompt.contains("Do not propose observations, inferences or derived patterns"));
    }

    #[test]
    fn page_prompt_centre_is_coherent_memory_not_atomic_claims() {
        let prompt = page_extraction_prompt(&CaptureFidelity::ConversationTurns);
        assert!(prompt.contains("primary memory object is a short prose Memory Page"));
        assert!(prompt.contains("prefer fewer"));
        assert!(prompt.contains("Do not split closely related context"));
        assert!(prompt.contains("LEGAL USER EVIDENCE ALIASES"));
    }

    #[test]
    fn recommended_model_is_small_enough_for_alpha_setup() {
        assert_eq!(RECOMMENDED_MODEL, "qwen3:4b");
    }
}
