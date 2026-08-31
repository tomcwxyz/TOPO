use crate::{
    all_claims, append_event, enum_text, error_text, open_store, write_claim,
};
use chrono::Utc;
use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use topo_contracts::{
    Actor, ActorType, CaptureKind, CapturedInteraction, ClaimProvenance, ClaimStatus,
    EpistemicType, EventEntityType, EventType, ExtractedMemoryProposal, MemoryClaim,
    MemoryEvent, MemorySource, Sensitivity, SourceRetention, SourceType,
};
use uuid::Uuid;

use crate::{
    capture_extractor,
    capture_inbox::{archive_capture, load_capture},
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureProcessResult {
    interaction_id: String,
    extractor: String,
    duplicate_snapshot: bool,
    proposals_extracted: usize,
    candidates_created: usize,
    supporting_evidence_added: usize,
    potential_changes: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    source_id: Option<String>,
}

#[derive(Debug)]
struct PersistResult {
    candidates_created: usize,
    supporting_evidence_added: usize,
    potential_changes: usize,
    source_id: Option<String>,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn process_capture_with_ollama(
    interaction_id: String,
    model: String,
) -> Result<CaptureProcessResult, String> {
    let loaded = load_capture(&interaction_id)?;
    let digest = snapshot_digest(&loaded.interaction)?;
    let extractor = format!("ollama:{}", model.trim());

    {
        let connection = open_store()?;
        if snapshot_processed(&connection, &loaded.interaction.id, &digest)? {
            archive_capture(&loaded.path)?;
            return Ok(CaptureProcessResult {
                interaction_id: loaded.interaction.id,
                extractor,
                duplicate_snapshot: true,
                proposals_extracted: 0,
                candidates_created: 0,
                supporting_evidence_added: 0,
                potential_changes: 0,
                source_id: None,
            });
        }
    }

    let proposals =
        capture_extractor::extract_with_ollama(&loaded.interaction, model.trim()).await?;

    let connection = open_store()?;
    if snapshot_processed(&connection, &loaded.interaction.id, &digest)? {
        archive_capture(&loaded.path)?;
        return Ok(CaptureProcessResult {
            interaction_id: loaded.interaction.id,
            extractor,
            duplicate_snapshot: true,
            proposals_extracted: 0,
            candidates_created: 0,
            supporting_evidence_added: 0,
            potential_changes: 0,
            source_id: None,
        });
    }

    let proposal_count = proposals.len();
    let persisted = persist_proposals(
        &connection,
        &loaded.interaction,
        proposals,
        &digest,
        &extractor,
    )?;

    archive_capture(&loaded.path)?;

    Ok(CaptureProcessResult {
        interaction_id: loaded.interaction.id,
        extractor,
        duplicate_snapshot: false,
        proposals_extracted: proposal_count,
        candidates_created: persisted.candidates_created,
        supporting_evidence_added: persisted.supporting_evidence_added,
        potential_changes: persisted.potential_changes,
        source_id: persisted.source_id,
    })
}

fn persist_proposals(
    connection: &Connection,
    interaction: &CapturedInteraction,
    proposals: Vec<ExtractedMemoryProposal>,
    digest: &str,
    extractor: &str,
) -> Result<PersistResult, String> {
    let tx = connection.unchecked_transaction().map_err(error_text)?;

    if snapshot_processed(&tx, &interaction.id, digest)? {
        tx.rollback().map_err(error_text)?;
        return Ok(PersistResult {
            candidates_created: 0,
            supporting_evidence_added: 0,
            potential_changes: 0,
            source_id: None,
        });
    }

    if proposals.is_empty() {
        mark_snapshot(&tx, interaction, digest, extractor, None, 0)?;
        tx.commit().map_err(error_text)?;
        return Ok(PersistResult {
            candidates_created: 0,
            supporting_evidence_added: 0,
            potential_changes: 0,
            source_id: None,
        });
    }

    let now = Utc::now().to_rfc3339();
    let source = upsert_capture_source(&tx, interaction, &proposals, &now)?;
    append_source_event(&tx, interaction, &source, proposals.len(), &now)?;

    let existing = all_claims(&tx)?;
    let mut candidates_created = 0usize;
    let mut supporting_evidence_added = 0usize;
    let mut potential_changes = 0usize;

    for proposal in proposals {
        let same_key = existing
            .iter()
            .filter(|claim| {
                claim.subject == interaction.subject
                    && claim.key == proposal.key
                    && (claim.status == ClaimStatus::Confirmed
                        || claim.status == ClaimStatus::Candidate)
            })
            .collect::<Vec<_>>();

        if let Some(exact) = same_key
            .iter()
            .find(|claim| claim.value == proposal.value)
            .copied()
        {
            append_supporting_evidence(
                &tx,
                exact,
                &source,
                &proposal,
                extractor,
                &now,
            )?;
            supporting_evidence_added += 1;
            continue;
        }

        let change = same_key
            .iter()
            .any(|claim| claim.status == ClaimStatus::Confirmed);
        if change {
            potential_changes += 1;
        }

        let claim = candidate_from_proposal(
            interaction,
            &source,
            proposal,
            extractor,
            change,
            &now,
        )?;
        write_claim(&tx, &claim)?;
        append_candidate_event(&tx, &claim, extractor, change, &now)?;
        candidates_created += 1;
    }

    mark_snapshot(
        &tx,
        interaction,
        digest,
        extractor,
        Some(&source.id),
        candidates_created + supporting_evidence_added,
    )?;
    tx.commit().map_err(error_text)?;

    Ok(PersistResult {
        candidates_created,
        supporting_evidence_added,
        potential_changes,
        source_id: Some(source.id),
    })
}

fn snapshot_processed(
    connection: &Connection,
    interaction_id: &str,
    digest: &str,
) -> Result<bool, String> {
    let count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM capture_snapshots
             WHERE interaction_id = ?1 AND digest = ?2",
            params![interaction_id, digest],
            |row| row.get(0),
        )
        .map_err(error_text)?;
    Ok(count > 0)
}

fn mark_snapshot(
    connection: &Connection,
    interaction: &CapturedInteraction,
    digest: &str,
    extractor: &str,
    source_id: Option<&str>,
    proposal_count: usize,
) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO capture_snapshots (
               interaction_id, digest, source_id, extractor, proposal_count, processed_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                interaction.id,
                digest,
                source_id,
                extractor,
                i64::try_from(proposal_count).map_err(error_text)?,
                Utc::now().to_rfc3339()
            ],
        )
        .map_err(error_text)?;
    Ok(())
}

fn snapshot_digest(interaction: &CapturedInteraction) -> Result<String, String> {
    let bytes = serde_json::to_vec(interaction).map_err(error_text)?;
    let digest = Sha256::digest(bytes);
    Ok(digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>())
}

fn source_type(interaction: &CapturedInteraction) -> SourceType {
    match interaction.kind {
        CaptureKind::ImportedConversation => SourceType::Import,
        CaptureKind::Manual => SourceType::Manual,
        CaptureKind::Conversation | CaptureKind::AgentSession => SourceType::Conversation,
    }
}

fn upsert_capture_source(
    connection: &Connection,
    interaction: &CapturedInteraction,
    proposals: &[ExtractedMemoryProposal],
    now: &str,
) -> Result<MemorySource, String> {
    let product = enum_text(&interaction.product)?;
    let provider_external_id = interaction
        .external_id
        .clone()
        .unwrap_or_else(|| interaction.id.clone());
    let external_id = format!("{product}:{provider_external_id}");

    let existing: Option<(String, String)> = connection
        .query_row(
            "SELECT id, created_at FROM sources
             WHERE provider = ?1 AND external_id = ?2
             ORDER BY created_at ASC LIMIT 1",
            params![interaction.provider, external_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(error_text)?;

    let sensitivity = maximum_sensitivity(proposals);
    let source = MemorySource {
        id: existing
            .as_ref()
            .map(|(id, _)| id.clone())
            .unwrap_or_else(|| format!("source-{}", Uuid::new_v4())),
        source_type: source_type(interaction),
        title: interaction.title.clone(),
        provider: Some(interaction.provider.clone()),
        external_id: Some(external_id),
        captured_at: interaction.captured_at.clone(),
        created_at: existing
            .map(|(_, created_at)| created_at)
            .unwrap_or_else(|| now.to_owned()),
        sensitivity,
        metadata: Some(source_metadata(interaction, proposals)?),
    };

    write_source(connection, &source)?;
    Ok(source)
}

fn source_metadata(
    interaction: &CapturedInteraction,
    proposals: &[ExtractedMemoryProposal],
) -> Result<BTreeMap<String, Value>, String> {
    let mut metadata = BTreeMap::from([
        (
            "topo.capture.interactionId".to_owned(),
            Value::String(interaction.id.clone()),
        ),
        (
            "topo.capture.product".to_owned(),
            Value::String(enum_text(&interaction.product)?),
        ),
        (
            "topo.capture.client".to_owned(),
            Value::String(enum_text(&interaction.client)?),
        ),
        (
            "topo.capture.mode".to_owned(),
            Value::String(enum_text(&interaction.mode)?),
        ),
        (
            "topo.capture.method".to_owned(),
            Value::String(enum_text(&interaction.capture_method)?),
        ),
        (
            "topo.capture.fidelity".to_owned(),
            Value::String(enum_text(&interaction.fidelity)?),
        ),
        (
            "topo.capture.retention".to_owned(),
            Value::String(enum_text(&interaction.retention)?),
        ),
        (
            "topo.capture.turnCount".to_owned(),
            json!(interaction.turns.len()),
        ),
    ]);

    if let Some(url) = &interaction.source_url {
        metadata.insert(
            "topo.capture.sourceUrl".to_owned(),
            Value::String(url.clone()),
        );
    }
    if let Some(original) = &interaction.external_id {
        metadata.insert(
            "topo.capture.providerExternalId".to_owned(),
            Value::String(original.clone()),
        );
    }
    if let Some(client_metadata) = &interaction.metadata {
        metadata.insert(
            "topo.capture.clientMetadata".to_owned(),
            serde_json::to_value(client_metadata).map_err(error_text)?,
        );
    }

    let evidence_ids = proposals
        .iter()
        .flat_map(|proposal| proposal.evidence_turn_ids.iter().cloned())
        .collect::<BTreeSet<_>>();
    let evidence_turns = interaction
        .turns
        .iter()
        .filter(|turn| evidence_ids.contains(&turn.id))
        .map(serde_json::to_value)
        .collect::<Result<Vec<_>, _>>()
        .map_err(error_text)?;
    metadata.insert(
        "topo.capture.evidenceTurns".to_owned(),
        Value::Array(evidence_turns),
    );

    if interaction.retention == SourceRetention::FullSource {
        metadata.insert(
            "topo.capture.turns".to_owned(),
            serde_json::to_value(&interaction.turns).map_err(error_text)?,
        );
    }

    Ok(metadata)
}

fn maximum_sensitivity(proposals: &[ExtractedMemoryProposal]) -> Sensitivity {
    proposals
        .iter()
        .filter_map(|proposal| proposal.sensitivity.clone())
        .max_by_key(sensitivity_rank)
        .unwrap_or(Sensitivity::Ordinary)
}

fn sensitivity_rank(value: &Sensitivity) -> u8 {
    match value {
        Sensitivity::Ordinary => 0,
        Sensitivity::Personal => 1,
        Sensitivity::Sensitive => 2,
        Sensitivity::Restricted => 3,
    }
}

fn write_source(connection: &Connection, source: &MemorySource) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO sources (
               id, type, title, provider, external_id, captured_at,
               created_at, sensitivity, metadata_json
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET
               type = excluded.type,
               title = excluded.title,
               provider = excluded.provider,
               external_id = excluded.external_id,
               captured_at = excluded.captured_at,
               sensitivity = excluded.sensitivity,
               metadata_json = excluded.metadata_json",
            params![
                source.id,
                enum_text(&source.source_type)?,
                source.title,
                source.provider,
                source.external_id,
                source.captured_at,
                source.created_at,
                enum_text(&source.sensitivity)?,
                source
                    .metadata
                    .as_ref()
                    .map(serde_json::to_string)
                    .transpose()
                    .map_err(error_text)?,
            ],
        )
        .map_err(error_text)?;
    Ok(())
}

fn append_source_event(
    connection: &Connection,
    interaction: &CapturedInteraction,
    source: &MemorySource,
    proposal_count: usize,
    now: &str,
) -> Result<(), String> {
    append_event(
        connection,
        &MemoryEvent {
            id: format!("event-{}", Uuid::new_v4()),
            event_type: EventType::SourceCaptured,
            entity_type: EventEntityType::Source,
            entity_id: source.id.clone(),
            occurred_at: now.to_owned(),
            actor: Actor {
                actor_type: ActorType::Agent,
                id: Some("topo-capture-processor".to_owned()),
            },
            data: Some(BTreeMap::from([
                (
                    "captureProduct".to_owned(),
                    Value::String(enum_text(&interaction.product)?),
                ),
                (
                    "captureClient".to_owned(),
                    Value::String(enum_text(&interaction.client)?),
                ),
                (
                    "captureMode".to_owned(),
                    Value::String(enum_text(&interaction.mode)?),
                ),
                ("proposalCount".to_owned(), json!(proposal_count)),
            ])),
        },
    )
}

fn append_supporting_evidence(
    connection: &Connection,
    claim: &MemoryClaim,
    source: &MemorySource,
    proposal: &ExtractedMemoryProposal,
    extractor: &str,
    now: &str,
) -> Result<(), String> {
    append_event(
        connection,
        &MemoryEvent {
            id: format!("event-{}", Uuid::new_v4()),
            event_type: EventType::ClaimEvidenceAdded,
            entity_type: EventEntityType::Claim,
            entity_id: claim.id.clone(),
            occurred_at: now.to_owned(),
            actor: Actor {
                actor_type: ActorType::Agent,
                id: Some("topo-capture-extractor".to_owned()),
            },
            data: Some(BTreeMap::from([
                ("sourceId".to_owned(), Value::String(source.id.clone())),
                (
                    "sourceType".to_owned(),
                    Value::String(enum_text(&source.source_type)?),
                ),
                (
                    "provider".to_owned(),
                    Value::String(source.provider.clone().unwrap_or_default()),
                ),
                (
                    "capturedAt".to_owned(),
                    Value::String(source.captured_at.clone()),
                ),
                (
                    "evidence".to_owned(),
                    Value::String(proposal.evidence.clone()),
                ),
                (
                    "extractor".to_owned(),
                    Value::String(extractor.to_owned()),
                ),
            ])),
        },
    )
}

fn candidate_from_proposal(
    interaction: &CapturedInteraction,
    source: &MemorySource,
    proposal: ExtractedMemoryProposal,
    extractor: &str,
    potential_change: bool,
    now: &str,
) -> Result<MemoryClaim, String> {
    let mut tags = proposal.tags.unwrap_or_default();
    if let Some(horizon) = proposal.horizon {
        tags.push(format!("topo:horizon:{}", enum_text(&horizon)?));
    }
    if potential_change {
        tags.push("topo:potential-change".to_owned());
    }
    tags.sort();
    tags.dedup();

    Ok(MemoryClaim {
        id: format!("claim-{}", Uuid::new_v4()),
        subject: interaction.subject.clone(),
        key: proposal.key.trim().to_owned(),
        value: proposal.value,
        category: proposal
            .category
            .and_then(|value| (!value.trim().is_empty()).then(|| value.trim().to_owned())),
        tags,
        epistemic_type: proposal.epistemic_type,
        confidence: proposal.confidence,
        provenance: ClaimProvenance {
            source_type: source.source_type.clone(),
            provider: source.provider.clone(),
            source_id: Some(source.id.clone()),
            evidence: Some(proposal.evidence.trim().to_owned()),
            captured_at: interaction.captured_at.clone(),
        },
        status: ClaimStatus::Candidate,
        sensitivity: proposal.sensitivity.unwrap_or(Sensitivity::Ordinary),
        valid_from: None,
        valid_until: proposal.valid_until,
        supersedes: Vec::new(),
        created_at: now.to_owned(),
        updated_at: now.to_owned(),
    })
}

fn append_candidate_event(
    connection: &Connection,
    claim: &MemoryClaim,
    extractor: &str,
    potential_change: bool,
    now: &str,
) -> Result<(), String> {
    append_event(
        connection,
        &MemoryEvent {
            id: format!("event-{}", Uuid::new_v4()),
            event_type: EventType::ClaimProposed,
            entity_type: EventEntityType::Claim,
            entity_id: claim.id.clone(),
            occurred_at: now.to_owned(),
            actor: Actor {
                actor_type: ActorType::Agent,
                id: Some("topo-capture-extractor".to_owned()),
            },
            data: Some(BTreeMap::from([
                (
                    "origin".to_owned(),
                    Value::String("ambient-capture".to_owned()),
                ),
                (
                    "extractor".to_owned(),
                    Value::String(extractor.to_owned()),
                ),
                ("potentialChange".to_owned(), Value::Bool(potential_change)),
            ])),
        },
    )
}

trait OptionalRow<T> {
    fn optional(self) -> rusqlite::Result<Option<T>>;
}

impl<T> OptionalRow<T> for rusqlite::Result<T> {
    fn optional(self) -> rusqlite::Result<Option<T>> {
        match self {
            Ok(value) => Ok(Some(value)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(error) => Err(error),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use topo_contracts::{
        CaptureClient, CaptureFidelity, CaptureMethod, CaptureMode, CaptureProduct, CaptureRole,
        CapturedTurn, MemoryHorizon,
    };

    fn interaction() -> CapturedInteraction {
        CapturedInteraction {
            id: "chatgpt-web-test".to_owned(),
            kind: CaptureKind::Conversation,
            product: CaptureProduct::Chatgpt,
            client: CaptureClient::Web,
            mode: CaptureMode::Chat,
            capture_method: CaptureMethod::BrowserExtension,
            fidelity: CaptureFidelity::ConversationTurns,
            provider: "openai".to_owned(),
            subject: "self".to_owned(),
            title: Some("Test".to_owned()),
            external_id: Some("thread-test".to_owned()),
            source_url: None,
            captured_at: "2026-08-31T20:00:00Z".to_owned(),
            turns: vec![
                CapturedTurn {
                    id: "u1".to_owned(),
                    role: CaptureRole::User,
                    content: "Please use British English.".to_owned(),
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
            metadata: None,
        }
    }

    fn proposal() -> ExtractedMemoryProposal {
        ExtractedMemoryProposal {
            key: "writing.locale".to_owned(),
            value: Value::String("en-GB".to_owned()),
            category: Some("writing".to_owned()),
            tags: Some(vec!["writing".to_owned()]),
            epistemic_type: EpistemicType::Preference,
            confidence: 0.99,
            sensitivity: Some(Sensitivity::Ordinary),
            horizon: Some(MemoryHorizon::Durable),
            evidence_turn_ids: vec!["u1".to_owned()],
            evidence: "Please use British English.".to_owned(),
            valid_until: None,
        }
    }

    fn connection() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        crate::migrate(&connection).unwrap();
        connection
    }

    #[test]
    fn first_capture_creates_candidate_and_source() {
        let connection = connection();
        let result = persist_proposals(
            &connection,
            &interaction(),
            vec![proposal()],
            "digest-1",
            "test:extractor",
        )
        .unwrap();

        assert_eq!(result.candidates_created, 1);
        assert_eq!(result.supporting_evidence_added, 0);
        assert!(result.source_id.is_some());

        let claims = all_claims(&connection).unwrap();
        assert_eq!(claims.len(), 1);
        assert_eq!(claims[0].status, ClaimStatus::Candidate);
        assert!(claims[0].tags.contains(&"topo:horizon:durable".to_owned()));
    }

    #[test]
    fn exact_confirmed_repeat_adds_evidence_not_duplicate() {
        let connection = connection();
        let first = persist_proposals(
            &connection,
            &interaction(),
            vec![proposal()],
            "digest-1",
            "test:extractor",
        )
        .unwrap();
        let claim_id = all_claims(&connection).unwrap()[0].id.clone();
        crate::review_candidate_in(&connection, &claim_id, "confirm").unwrap();

        let mut newer = interaction();
        newer.captured_at = "2026-08-31T21:00:00Z".to_owned();
        newer.turns.push(CapturedTurn {
            id: "u2".to_owned(),
            role: CaptureRole::User,
            content: "Still use British English.".to_owned(),
            occurred_at: None,
        });
        let mut repeated = proposal();
        repeated.evidence_turn_ids = vec!["u2".to_owned()];
        repeated.evidence = "Still use British English.".to_owned();

        let second = persist_proposals(
            &connection,
            &newer,
            vec![repeated],
            "digest-2",
            "test:extractor",
        )
        .unwrap();

        assert_eq!(first.candidates_created, 1);
        assert_eq!(second.candidates_created, 0);
        assert_eq!(second.supporting_evidence_added, 1);
        assert_eq!(all_claims(&connection).unwrap().len(), 1);

        let evidence_events: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM events WHERE type = 'claim.evidence_added'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(evidence_events, 1);
    }

    #[test]
    fn exact_snapshot_is_idempotent() {
        let connection = connection();
        persist_proposals(
            &connection,
            &interaction(),
            vec![proposal()],
            "digest-same",
            "test:extractor",
        )
        .unwrap();

        assert!(snapshot_processed(
            &connection,
            "chatgpt-web-test",
            "digest-same"
        )
        .unwrap());
    }
}
