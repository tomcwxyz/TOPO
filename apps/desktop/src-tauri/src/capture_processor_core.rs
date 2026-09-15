use crate::{append_event, enum_text, error_text, open_store};
use chrono::Utc;
use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use topo_contracts::{
    Actor, ActorType, CaptureKind, CapturedInteraction, EventEntityType, EventType,
    ExtractedMemoryPageProposal, MemoryEvent, MemoryHorizon, MemoryPage, MemoryPageEvent,
    MemoryPageEventType, MemoryPageOrigin, MemoryPageSourceRef, MemoryPageStatus, MemorySource,
    Sensitivity, SourceRetention, SourceType,
};
use uuid::Uuid;

use crate::{
    capture_extractor,
    capture_inbox::{archive_capture, load_capture},
    memory_pages::{all_memory_pages, append_memory_page_event, write_memory_page},
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
    duplicate_pages_suppressed: usize,
    representation: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    source_id: Option<String>,
}

#[derive(Debug)]
struct PersistResult {
    candidates_created: usize,
    supporting_evidence_added: usize,
    potential_changes: usize,
    duplicate_pages_suppressed: usize,
    source_id: Option<String>,
}

fn duplicate_result(interaction_id: String, extractor: String) -> CaptureProcessResult {
    CaptureProcessResult {
        interaction_id,
        extractor,
        duplicate_snapshot: true,
        proposals_extracted: 0,
        candidates_created: 0,
        supporting_evidence_added: 0,
        potential_changes: 0,
        duplicate_pages_suppressed: 0,
        representation: "memory-page",
        source_id: None,
    }
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
            return Ok(duplicate_result(loaded.interaction.id, extractor));
        }
    }

    let proposals =
        capture_extractor::extract_pages_with_ollama(&loaded.interaction, model.trim()).await?;

    let connection = open_store()?;
    if snapshot_processed(&connection, &loaded.interaction.id, &digest)? {
        archive_capture(&loaded.path)?;
        return Ok(duplicate_result(loaded.interaction.id, extractor));
    }

    let proposal_count = proposals.len();
    let persisted = persist_page_proposals(
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
        duplicate_pages_suppressed: persisted.duplicate_pages_suppressed,
        representation: "memory-page",
        source_id: persisted.source_id,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PageComparison {
    New,
    Duplicate,
    SupportingEvidence,
    PotentialChange,
}

impl PageComparison {
    fn as_str(self) -> &'static str {
        match self {
            Self::New => "new",
            Self::Duplicate => "duplicate",
            Self::SupportingEvidence => "supporting-evidence",
            Self::PotentialChange => "potential-change",
        }
    }
}

#[derive(Debug)]
struct PageComparisonResult {
    comparison: PageComparison,
    related_ids: Vec<String>,
}

fn normalise_text(value: &str) -> String {
    value
        .to_lowercase()
        .chars()
        .map(|character| {
            if character.is_alphanumeric() || character == '\'' {
                character
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn token_set(value: &str) -> BTreeSet<String> {
    normalise_text(value)
        .split_whitespace()
        .filter(|token| token.chars().count() > 2)
        .map(str::to_owned)
        .collect()
}

fn shared_token_count(left: &BTreeSet<String>, right: &BTreeSet<String>) -> usize {
    left.intersection(right).count()
}

fn jaccard(left: &str, right: &str) -> f64 {
    let left = token_set(left);
    let right = token_set(right);
    if left.is_empty() && right.is_empty() {
        return 1.0;
    }
    if left.is_empty() || right.is_empty() {
        return 0.0;
    }
    let intersection = shared_token_count(&left, &right);
    intersection as f64 / (left.len() + right.len() - intersection) as f64
}

fn containment_overlap(left: &str, right: &str) -> f64 {
    let left = token_set(left);
    let right = token_set(right);
    if left.is_empty() && right.is_empty() {
        return 1.0;
    }
    if left.is_empty() || right.is_empty() {
        return 0.0;
    }
    shared_token_count(&left, &right) as f64 / left.len().min(right.len()) as f64
}

fn tag_overlap(left: Option<&[String]>, right: &[String]) -> f64 {
    let left = left
        .unwrap_or_default()
        .iter()
        .map(|tag| normalise_text(tag))
        .filter(|tag| !tag.is_empty())
        .collect::<BTreeSet<_>>();
    let right = right
        .iter()
        .map(|tag| normalise_text(tag))
        .filter(|tag| !tag.is_empty())
        .collect::<BTreeSet<_>>();
    if left.is_empty() || right.is_empty() {
        return 0.0;
    }
    left.intersection(&right).count() as f64 / left.len().min(right.len()) as f64
}

fn compare_page_proposal(
    subject: &str,
    proposal: &ExtractedMemoryPageProposal,
    pages: &[MemoryPage],
) -> PageComparisonResult {
    let active = pages
        .iter()
        .filter(|page| {
            page.subject == subject
                && matches!(page.status, MemoryPageStatus::Candidate | MemoryPageStatus::Confirmed)
        })
        .collect::<Vec<_>>();
    let proposal_title = normalise_text(&proposal.title);
    let proposal_body = normalise_text(&proposal.body);

    let exact = active
        .iter()
        .filter(|page| {
            normalise_text(&page.title) == proposal_title
                && normalise_text(&page.body) == proposal_body
        })
        .map(|page| page.id.clone())
        .collect::<Vec<_>>();
    if !exact.is_empty() {
        return PageComparisonResult {
            comparison: PageComparison::Duplicate,
            related_ids: exact,
        };
    }

    let supporting = active
        .iter()
        .filter(|page| {
            let body_similarity = jaccard(&page.body, &proposal.body);
            let body_coverage = containment_overlap(&page.body, &proposal.body);
            let title_similarity = jaccard(&page.title, &proposal.title);
            let category_matches = proposal.category.as_ref().is_some_and(|category| {
                page.category
                    .as_ref()
                    .is_some_and(|existing| normalise_text(existing) == normalise_text(category))
            });
            let tags_match = tag_overlap(proposal.tags.as_deref(), &page.tags);
            body_similarity >= 0.82
                || (body_coverage >= 0.78
                    && (title_similarity >= 0.5 || category_matches || tags_match >= 0.5))
                || (title_similarity >= 0.75 && body_similarity >= 0.62)
                || (category_matches && tags_match >= 0.75 && body_similarity >= 0.6)
        })
        .map(|page| page.id.clone())
        .collect::<Vec<_>>();
    if !supporting.is_empty() {
        return PageComparisonResult {
            comparison: PageComparison::SupportingEvidence,
            related_ids: supporting,
        };
    }

    let possible_changes = active
        .iter()
        .filter(|page| {
            let same_title = normalise_text(&page.title) == proposal_title;
            let strong_title = jaccard(&page.title, &proposal.title) >= 0.72;
            let category_matches = proposal.category.as_ref().is_some_and(|category| {
                page.category
                    .as_ref()
                    .is_some_and(|existing| normalise_text(existing) == normalise_text(category))
            });
            let tags_match = tag_overlap(proposal.tags.as_deref(), &page.tags) >= 0.5;
            same_title || (strong_title && (category_matches || tags_match))
        })
        .map(|page| page.id.clone())
        .collect::<Vec<_>>();

    if !possible_changes.is_empty() {
        PageComparisonResult {
            comparison: PageComparison::PotentialChange,
            related_ids: possible_changes,
        }
    } else {
        PageComparisonResult {
            comparison: PageComparison::New,
            related_ids: Vec::new(),
        }
    }
}

fn supporting_page_index(
    related_ids: &[String],
    pages: &[MemoryPage],
) -> Option<usize> {
    related_ids
        .iter()
        .filter_map(|id| pages.iter().position(|page| page.id == *id))
        .find(|index| pages[*index].status == MemoryPageStatus::Confirmed)
        .or_else(|| {
            related_ids
                .iter()
                .find_map(|id| pages.iter().position(|page| page.id == *id))
        })
}

fn attach_supporting_evidence(
    connection: &Connection,
    page: &mut MemoryPage,
    source: &MemorySource,
    proposal: &ExtractedMemoryPageProposal,
    extractor: &str,
    now: &str,
) -> Result<bool, String> {
    if page
        .source_refs
        .iter()
        .any(|reference| reference.source_id == source.id)
    {
        return Ok(false);
    }

    page.source_refs.push(MemoryPageSourceRef {
        source_id: source.id.clone(),
        evidence: Some(proposal.evidence.trim().to_owned()),
        turn_ids: Some(proposal.evidence_turn_ids.clone()),
    });
    page.revision += 1;
    page.updated_at = now.to_owned();
    write_memory_page(connection, page)?;
    append_memory_page_event(
        connection,
        &MemoryPageEvent {
            id: format!("event-{}", Uuid::new_v4()),
            event_type: MemoryPageEventType::Edited,
            entity_type: "memory".to_owned(),
            entity_id: page.id.clone(),
            occurred_at: now.to_owned(),
            actor: Actor {
                actor_type: ActorType::Agent,
                id: Some("topo-capture-extractor".to_owned()),
            },
            data: Some(BTreeMap::from([
                (
                    "changeKind".to_owned(),
                    Value::String("supporting-evidence".to_owned()),
                ),
                ("sourceId".to_owned(), Value::String(source.id.clone())),
                (
                    "evidence".to_owned(),
                    Value::String(proposal.evidence.trim().to_owned()),
                ),
                (
                    "turnIds".to_owned(),
                    serde_json::to_value(&proposal.evidence_turn_ids).map_err(error_text)?,
                ),
                ("revision".to_owned(), json!(page.revision)),
                (
                    "extractor".to_owned(),
                    Value::String(extractor.to_owned()),
                ),
            ])),
        },
    )?;
    Ok(true)
}

fn persist_page_proposals(
    connection: &Connection,
    interaction: &CapturedInteraction,
    proposals: Vec<ExtractedMemoryPageProposal>,
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
            duplicate_pages_suppressed: 0,
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
            duplicate_pages_suppressed: 0,
            source_id: None,
        });
    }

    let proposal_count = proposals.len();
    let now = Utc::now().to_rfc3339();
    let source = upsert_page_capture_source(&tx, interaction, &proposals, &now)?;
    append_page_source_event(&tx, interaction, &source, proposal_count, &now)?;
    let mut existing = all_memory_pages(&tx)?;

    let mut candidates_created = 0usize;
    let mut supporting_evidence_added = 0usize;
    let mut potential_changes = 0usize;
    let mut duplicate_pages_suppressed = 0usize;

    for proposal in proposals {
        let comparison = compare_page_proposal(&interaction.subject, &proposal, &existing);
        if comparison.comparison == PageComparison::Duplicate {
            duplicate_pages_suppressed += 1;
            continue;
        }

        if comparison.comparison == PageComparison::SupportingEvidence {
            if let Some(index) = supporting_page_index(&comparison.related_ids, &existing) {
                if attach_supporting_evidence(
                    &tx,
                    &mut existing[index],
                    &source,
                    &proposal,
                    extractor,
                    &now,
                )? {
                    supporting_evidence_added += 1;
                }
            }
            continue;
        }

        let supersedes = if comparison.comparison == PageComparison::PotentialChange {
            let ids = comparison
                .related_ids
                .iter()
                .filter(|id| {
                    existing.iter().any(|page| {
                        page.id.as_str() == id.as_str()
                            && page.status == MemoryPageStatus::Confirmed
                    })
                })
                .cloned()
                .collect::<Vec<_>>();
            if !ids.is_empty() {
                potential_changes += 1;
            }
            ids
        } else {
            Vec::new()
        };

        let page = page_candidate_from_proposal(
            interaction,
            &source,
            &proposal,
            supersedes,
            &now,
        );
        write_memory_page(&tx, &page)?;
        append_page_candidate_event(
            &tx,
            &page,
            &proposal,
            extractor,
            &comparison,
            &now,
        )?;
        existing.push(page);
        candidates_created += 1;
    }

    mark_snapshot(
        &tx,
        interaction,
        digest,
        extractor,
        Some(&source.id),
        proposal_count,
    )?;
    tx.commit().map_err(error_text)?;

    Ok(PersistResult {
        candidates_created,
        supporting_evidence_added,
        potential_changes,
        duplicate_pages_suppressed,
        source_id: Some(source.id),
    })
}

fn page_candidate_from_proposal(
    interaction: &CapturedInteraction,
    source: &MemorySource,
    proposal: &ExtractedMemoryPageProposal,
    supersedes: Vec<String>,
    now: &str,
) -> MemoryPage {
    let mut tags = proposal.tags.clone().unwrap_or_default();
    tags.sort();
    tags.dedup();

    MemoryPage {
        id: format!("memory-{}", Uuid::new_v4()),
        subject: interaction.subject.clone(),
        title: proposal.title.trim().to_owned(),
        summary: proposal
            .summary
            .as_ref()
            .and_then(|value| (!value.trim().is_empty()).then(|| value.trim().to_owned())),
        body: proposal.body.trim().to_owned(),
        category: proposal
            .category
            .as_ref()
            .and_then(|value| (!value.trim().is_empty()).then(|| value.trim().to_owned())),
        tags,
        status: MemoryPageStatus::Candidate,
        sensitivity: proposal.sensitivity.clone().unwrap_or(Sensitivity::Ordinary),
        horizon: proposal.horizon.unwrap_or(MemoryHorizon::Durable),
        origin: MemoryPageOrigin::Extracted,
        source_refs: vec![MemoryPageSourceRef {
            source_id: source.id.clone(),
            evidence: Some(proposal.evidence.trim().to_owned()),
            turn_ids: Some(proposal.evidence_turn_ids.clone()),
        }],
        annotation_ids: Vec::new(),
        valid_from: proposal.valid_from.clone(),
        valid_until: proposal.valid_until.clone(),
        supersedes,
        revision: 1,
        created_at: now.to_owned(),
        updated_at: now.to_owned(),
    }
}

fn append_page_candidate_event(
    connection: &Connection,
    page: &MemoryPage,
    proposal: &ExtractedMemoryPageProposal,
    extractor: &str,
    comparison: &PageComparisonResult,
    now: &str,
) -> Result<(), String> {
    let mut data = BTreeMap::from([
        (
            "origin".to_owned(),
            Value::String("ambient-capture".to_owned()),
        ),
        (
            "extractor".to_owned(),
            Value::String(extractor.to_owned()),
        ),
        (
            "comparison".to_owned(),
            Value::String(comparison.comparison.as_str().to_owned()),
        ),
        (
            "relatedMemoryIds".to_owned(),
            serde_json::to_value(&comparison.related_ids).map_err(error_text)?,
        ),
    ]);
    if let Some(annotations) = &proposal.annotations {
        if !annotations.is_empty() {
            data.insert(
                "proposedAnnotations".to_owned(),
                serde_json::to_value(annotations).map_err(error_text)?,
            );
        }
    }

    append_memory_page_event(
        connection,
        &MemoryPageEvent {
            id: format!("event-{}", Uuid::new_v4()),
            event_type: MemoryPageEventType::Proposed,
            entity_type: "memory".to_owned(),
            entity_id: page.id.clone(),
            occurred_at: now.to_owned(),
            actor: Actor {
                actor_type: ActorType::Agent,
                id: Some("topo-capture-extractor".to_owned()),
            },
            data: Some(data),
        },
    )
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

fn maximum_page_sensitivity(proposals: &[ExtractedMemoryPageProposal]) -> Sensitivity {
    let mut values = proposals
        .iter()
        .filter_map(|proposal| proposal.sensitivity.clone())
        .collect::<Vec<_>>();
    values.extend(
        proposals
            .iter()
            .flat_map(|proposal| proposal.annotations.iter().flatten())
            .filter_map(|annotation| annotation.sensitivity.clone()),
    );
    values
        .into_iter()
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

fn upsert_page_capture_source(
    connection: &Connection,
    interaction: &CapturedInteraction,
    proposals: &[ExtractedMemoryPageProposal],
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
        sensitivity: maximum_page_sensitivity(proposals),
        metadata: Some(page_source_metadata(interaction, proposals)?),
    };
    write_source(connection, &source)?;
    Ok(source)
}

fn page_source_metadata(
    interaction: &CapturedInteraction,
    proposals: &[ExtractedMemoryPageProposal],
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
        (
            "topo.capture.representation".to_owned(),
            Value::String("memory-page".to_owned()),
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

fn append_page_source_event(
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
                (
                    "representation".to_owned(),
                    Value::String("memory-page".to_owned()),
                ),
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
        CapturedTurn, EpistemicType, MemoryPageAnnotationProposal,
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
                    content: "RACK uses Neon rather than Supabase. Keep local projects account-free.".to_owned(),
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

    fn page_proposal() -> ExtractedMemoryPageProposal {
        ExtractedMemoryPageProposal {
            title: "RACK architecture decisions".to_owned(),
            summary: Some("Keep the database choice deliberate.".to_owned()),
            body: "RACK uses Neon rather than Supabase. Local projects remain account-free.".to_owned(),
            category: Some("rack".to_owned()),
            tags: Some(vec!["rack".to_owned(), "architecture".to_owned()]),
            sensitivity: Some(Sensitivity::Ordinary),
            horizon: Some(MemoryHorizon::Project),
            evidence_turn_ids: vec!["u1".to_owned()],
            evidence: "RACK uses Neon rather than Supabase.".to_owned(),
            valid_from: None,
            valid_until: None,
            annotations: Some(vec![MemoryPageAnnotationProposal {
                key: "rack.database".to_owned(),
                value: Value::String("Neon".to_owned()),
                category: Some("architecture".to_owned()),
                tags: Some(vec!["rack".to_owned()]),
                epistemic_type: EpistemicType::Assertion,
                confidence: 0.99,
                sensitivity: Some(Sensitivity::Ordinary),
            }]),
        }
    }

    fn connection() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        crate::migrate(&connection).unwrap();
        crate::memory_pages::ensure_schema(&connection).unwrap();
        connection
    }

    #[test]
    fn page_first_capture_creates_candidate_source_and_annotation_draft() {
        let connection = connection();
        let result = persist_page_proposals(
            &connection,
            &interaction(),
            vec![page_proposal()],
            "page-digest-1",
            "test:page-extractor",
        )
        .unwrap();

        assert_eq!(result.candidates_created, 1);
        assert_eq!(result.supporting_evidence_added, 0);
        assert_eq!(result.duplicate_pages_suppressed, 0);
        assert!(result.source_id.is_some());
        let pages = all_memory_pages(&connection).unwrap();
        assert_eq!(pages.len(), 1);
        assert_eq!(pages[0].status, MemoryPageStatus::Candidate);
        assert!(pages[0].annotation_ids.is_empty());

        let data: String = connection
            .query_row(
                "SELECT data_json FROM memory_page_events WHERE entity_id = ?1",
                [&pages[0].id],
                |row| row.get(0),
            )
            .unwrap();
        let data: Value = serde_json::from_str(&data).unwrap();
        assert_eq!(data["proposedAnnotations"][0]["key"], "rack.database");
    }

    #[test]
    fn exact_page_repeat_is_suppressed() {
        let connection = connection();
        persist_page_proposals(
            &connection,
            &interaction(),
            vec![page_proposal()],
            "page-digest-original",
            "test:page-extractor",
        )
        .unwrap();

        let result = persist_page_proposals(
            &connection,
            &interaction(),
            vec![page_proposal()],
            "page-digest-repeat",
            "test:page-extractor",
        )
        .unwrap();
        assert_eq!(result.candidates_created, 0);
        assert_eq!(result.duplicate_pages_suppressed, 1);
        assert_eq!(all_memory_pages(&connection).unwrap().len(), 1);
    }

    #[test]
    fn concise_restatement_adds_provenance_without_another_candidate() {
        let connection = connection();
        persist_page_proposals(
            &connection,
            &interaction(),
            vec![page_proposal()],
            "page-digest-base",
            "test:page-extractor",
        )
        .unwrap();
        let page_id = all_memory_pages(&connection).unwrap()[0].id.clone();

        let mut newer_interaction = interaction();
        newer_interaction.id = "chatgpt-web-support".to_owned();
        newer_interaction.external_id = Some("thread-support".to_owned());
        newer_interaction.captured_at = "2026-09-01T10:00:00Z".to_owned();

        let mut supporting = page_proposal();
        supporting.title = "RACK architecture".to_owned();
        supporting.body = "RACK uses Neon and local projects remain account-free.".to_owned();
        let result = persist_page_proposals(
            &connection,
            &newer_interaction,
            vec![supporting],
            "page-digest-support",
            "test:page-extractor",
        )
        .unwrap();

        assert_eq!(result.supporting_evidence_added, 1);
        assert_eq!(result.candidates_created, 0);
        let pages = all_memory_pages(&connection).unwrap();
        assert_eq!(pages.len(), 1);
        assert_eq!(pages[0].id, page_id);
        assert_eq!(pages[0].source_refs.len(), 2);
        assert_eq!(pages[0].revision, 2);

        let data: String = connection
            .query_row(
                "SELECT data_json FROM memory_page_events WHERE entity_id = ?1 AND type = 'memory.edited'",
                [&page_id],
                |row| row.get(0),
            )
            .unwrap();
        let data: Value = serde_json::from_str(&data).unwrap();
        assert_eq!(data["changeKind"], "supporting-evidence");
    }

    #[test]
    fn duplicate_proposals_inside_one_extraction_do_not_create_duplicate_pages() {
        let connection = connection();
        let result = persist_page_proposals(
            &connection,
            &interaction(),
            vec![page_proposal(), page_proposal()],
            "page-digest-same-batch",
            "test:page-extractor",
        )
        .unwrap();

        assert_eq!(result.candidates_created, 1);
        assert_eq!(result.duplicate_pages_suppressed, 1);
        assert_eq!(all_memory_pages(&connection).unwrap().len(), 1);
    }

    #[test]
    fn page_change_is_candidate_with_supersession_not_immediate_replacement() {
        let connection = connection();
        persist_page_proposals(
            &connection,
            &interaction(),
            vec![page_proposal()],
            "page-digest-base",
            "test:page-extractor",
        )
        .unwrap();
        let mut first = all_memory_pages(&connection).unwrap().remove(0);
        first.status = MemoryPageStatus::Confirmed;
        first.revision += 1;
        write_memory_page(&connection, &first).unwrap();

        let mut changed = page_proposal();
        changed.body = "RACK should move managed data away from Neon while preserving the local-first boundary.".to_owned();
        let result = persist_page_proposals(
            &connection,
            &interaction(),
            vec![changed],
            "page-digest-change",
            "test:page-extractor",
        )
        .unwrap();

        assert_eq!(result.potential_changes, 1);
        let pages = all_memory_pages(&connection).unwrap();
        let candidate = pages
            .iter()
            .find(|page| page.status == MemoryPageStatus::Candidate)
            .unwrap();
        assert_eq!(candidate.supersedes, vec![first.id.clone()]);
        let previous = pages.iter().find(|page| page.id == first.id).unwrap();
        assert_eq!(previous.status, MemoryPageStatus::Confirmed);
    }

    #[test]
    fn exact_snapshot_is_idempotent() {
        let connection = connection();
        persist_page_proposals(
            &connection,
            &interaction(),
            vec![page_proposal()],
            "digest-same",
            "test:page-extractor",
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
