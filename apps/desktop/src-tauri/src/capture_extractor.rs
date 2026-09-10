use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::BTreeMap, time::Duration};
use topo_contracts::{
    CaptureFidelity, CaptureRole, CapturedInteraction, EpistemicType,
    ExtractedMemoryPageProposal, ExtractedMemoryProposal,
};

const OLLAMA_BASE_URL: &str = "http://127.0.0.1:11434";
pub const RECOMMENDED_MODEL: &str = "qwen3:4b";
const MAX_TRANSCRIPT_CHARS: usize = 60_000;
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

#[derive(Debug, Deserialize)]
struct PageProposalEnvelope {
    #[serde(default)]
    proposals: Vec<ExtractedMemoryPageProposal>,
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
) -> Result<String, String> {
    let model = model.trim();
    if model.is_empty() {
        return Err("Choose an Ollama model before extracting capture.".to_owned());
    }

    let transcript = format_interaction(interaction);
    let client = Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| error.to_string())?;

    let response = client
        .post(format!("{OLLAMA_BASE_URL}/api/chat"))
        .json(&json!({
            "model": model,
            "stream": false,
            "format": "json",
            "options": { "temperature": 0.1 },
            "messages": [
                { "role": "system", "content": system },
                { "role": "user", "content": transcript }
            ]
        }))
        .send()
        .await
        .map_err(|error| format!("Could not call local Ollama: {error}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Ollama extraction failed with HTTP {status}: {}",
            body.chars().take(500).collect::<String>()
        ));
    }

    let payload = response
        .json::<OllamaChatResponse>()
        .await
        .map_err(|error| format!("Ollama returned an unreadable response: {error}"))?;
    Ok(payload.message.content)
}

/// Legacy Claim extractor retained during the Memory Page migration.
pub async fn extract_with_ollama(
    interaction: &CapturedInteraction,
    model: &str,
) -> Result<Vec<ExtractedMemoryProposal>, String> {
    let content = call_ollama(interaction, model, extraction_prompt(&interaction.fidelity)).await?;
    let proposals = parse_proposals(&content)?;
    validate_proposals(interaction, proposals)
}

/// Primary M3 extractor. Produces a small number of coherent prose Memory Pages.
pub async fn extract_pages_with_ollama(
    interaction: &CapturedInteraction,
    model: &str,
) -> Result<Vec<ExtractedMemoryPageProposal>, String> {
    let content = call_ollama(
        interaction,
        model,
        page_extraction_prompt(&interaction.fidelity),
    )
    .await?;
    let proposals = parse_page_proposals(&content)?;
    validate_page_proposals(interaction, proposals)
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
        "Every page must cite at least one USER turn ID from the transcript.",
        "Assistant, tool and system messages may provide context but are not evidence about the user.",
        "Evidence must be a short verbatim excerpt from one of the cited USER turns.",
        "Questions are weak evidence. Do not turn a question into a fact unless the user explicitly states that fact.",
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
        "{}\n\nReturn JSON only using this object shape:\n{}",
        rules
            .into_iter()
            .map(|rule| format!("- {rule}"))
            .collect::<Vec<_>>()
            .join("\n"),
        r#"{
  "proposals": [
    {
      "title": "Short useful title",
      "summary": "Optional one-line summary",
      "body": "Concise coherent prose memory.",
      "category": "optional-category",
      "tags": ["optional", "tags"],
      "sensitivity": "ordinary",
      "horizon": "project",
      "evidenceTurnIds": ["u1"],
      "evidence": "verbatim user excerpt",
      "annotations": [
        {
          "key": "optional.machine.key",
          "value": "machine-readable value",
          "epistemicType": "preference",
          "confidence": 0.98
        }
      ]
    }
  ]
}

Omit optional fields instead of returning null. Return {"proposals":[]} when nothing is genuinely worth remembering."#
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

pub fn parse_page_proposals(text: &str) -> Result<Vec<ExtractedMemoryPageProposal>, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    if let Ok(envelope) = serde_json::from_str::<PageProposalEnvelope>(trimmed) {
        return Ok(envelope.proposals);
    }
    if let Ok(items) = serde_json::from_str::<Vec<ExtractedMemoryPageProposal>>(trimmed) {
        return Ok(items);
    }

    let candidate = extract_json_object(trimmed)
        .ok_or_else(|| "Extractor response did not contain valid JSON.".to_owned())?;
    if let Ok(envelope) = serde_json::from_str::<PageProposalEnvelope>(&candidate) {
        return Ok(envelope.proposals);
    }

    Err("Extractor JSON did not match the TOPO Memory Page proposal contract.".to_owned())
}

pub fn parse_proposals(text: &str) -> Result<Vec<ExtractedMemoryProposal>, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    if let Ok(envelope) = serde_json::from_str::<ProposalEnvelope>(trimmed) {
        return Ok(envelope.proposals);
    }
    if let Ok(items) = serde_json::from_str::<Vec<ExtractedMemoryProposal>>(trimmed) {
        return Ok(items);
    }

    let candidate = extract_json_object(trimmed)
        .ok_or_else(|| "Extractor response did not contain valid JSON.".to_owned())?;
    if let Ok(envelope) = serde_json::from_str::<ProposalEnvelope>(&candidate) {
        return Ok(envelope.proposals);
    }

    Err("Extractor JSON did not match the TOPO proposal contract.".to_owned())
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

pub fn validate_page_proposals(
    interaction: &CapturedInteraction,
    proposals: Vec<ExtractedMemoryPageProposal>,
) -> Result<Vec<ExtractedMemoryPageProposal>, String> {
    if proposals.len() > MAX_MEMORY_PAGE_PROPOSALS {
        return Err(format!(
            "Extractor returned {} Memory Pages; maximum is {}.",
            proposals.len(), MAX_MEMORY_PAGE_PROPOSALS
        ));
    }

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

    for mut proposal in proposals {
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

        valid.push(proposal);
    }

    Ok(valid)
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
                    id: "u1".to_owned(),
                    role: CaptureRole::User,
                    content: "Please use British English. RACK uses Neon rather than Supabase.".to_owned(),
                    occurred_at: None,
                },
                topo_contracts::CapturedTurn {
                    id: "a1".to_owned(),
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

    fn page_proposal() -> ExtractedMemoryPageProposal {
        ExtractedMemoryPageProposal {
            title: "RACK architecture".to_owned(),
            summary: None,
            body: "RACK uses Neon rather than Supabase.".to_owned(),
            category: Some("rack".to_owned()),
            tags: Some(vec!["rack".to_owned()]),
            sensitivity: Some(Sensitivity::Ordinary),
            horizon: Some(MemoryHorizon::Project),
            evidence_turn_ids: vec!["u1".to_owned()],
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
            r#"{"proposals":[{"key":"writing.locale","value":"en-GB","epistemicType":"preference","confidence":0.98,"evidenceTurnIds":["u1"],"evidence":"Please use British English."}]}"#,
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

    #[test]
    fn page_prompt_centre_is_coherent_memory_not_atomic_claims() {
        let prompt = page_extraction_prompt(&CaptureFidelity::ConversationTurns);
        assert!(prompt.contains("primary memory object is a short prose Memory Page"));
        assert!(prompt.contains("prefer fewer"));
        assert!(prompt.contains("Do not split closely related context"));
    }

    #[test]
    fn recommended_model_is_small_enough_for_alpha_setup() {
        assert_eq!(RECOMMENDED_MODEL, "qwen3:4b");
    }
}
