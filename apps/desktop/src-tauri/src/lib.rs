mod capture_extractor;
mod capture_inbox;
mod capture_processor;
mod oos_local;

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::BTreeMap, fs, path::PathBuf};
use tauri::Manager;
use topo_contracts::{
    Actor, ActorType, ClaimProvenance, ClaimStatus, EpistemicType, EventEntityType, EventType,
    MemoryClaim, MemoryEvent, Sensitivity, SourceType,
};
use uuid::Uuid;

const SCHEMA_VERSION: i64 = 2;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopStatus {
    contract_version: &'static str,
    store_path: String,
    confirmed: i64,
    candidates: i64,
    total: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaimDraftInput {
    subject: String,
    key: String,
    value: Value,
    category: Option<String>,
    tags: Vec<String>,
    epistemic_type: EpistemicType,
    confidence: f64,
    sensitivity: Sensitivity,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ContextPreview {
    packet: Value,
    selected_claim_ids: Vec<String>,
}

fn error_text(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn enum_text<T: Serialize>(value: &T) -> Result<String, String> {
    serde_json::to_value(value)
        .map_err(error_text)?
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| "Expected enum to serialise as a string.".to_owned())
}

fn default_store_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Unable to determine the home folder.".to_owned())?;
    Ok(home.join(".topo").join("topo.sqlite"))
}

fn open_store() -> Result<Connection, String> {
    let path = default_store_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(error_text)?;
    }
    let connection = Connection::open(&path).map_err(error_text)?;
    connection
        .execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA busy_timeout = 5000;
             PRAGMA journal_mode = WAL;",
        )
        .map_err(error_text)?;
    migrate(&connection)?;
    Ok(connection)
}

fn migrate(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            ) STRICT;",
        )
        .map_err(error_text)?;

    let version: i64 = connection
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )
        .map_err(error_text)?;

    if version >= SCHEMA_VERSION {
        return Ok(());
    }

    let tx = connection.unchecked_transaction().map_err(error_text)?;
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS sources (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL CHECK (type IN (
              'conversation', 'document', 'manual', 'mcp', 'import', 'connector'
            )),
            title TEXT,
            provider TEXT,
            external_id TEXT,
            captured_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            sensitivity TEXT NOT NULL CHECK (sensitivity IN (
              'ordinary', 'personal', 'sensitive', 'restricted'
            )),
            metadata_json TEXT
        ) STRICT;

        CREATE TABLE IF NOT EXISTS claims (
            id TEXT PRIMARY KEY,
            subject TEXT NOT NULL,
            claim_key TEXT NOT NULL,
            value_json TEXT NOT NULL,
            category TEXT,
            tags_json TEXT NOT NULL,
            epistemic_type TEXT NOT NULL CHECK (epistemic_type IN (
              'assertion', 'observation', 'inference', 'preference', 'derived-pattern'
            )),
            confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
            source_type TEXT NOT NULL CHECK (source_type IN (
              'conversation', 'document', 'manual', 'mcp', 'import', 'connector'
            )),
            provider TEXT,
            source_id TEXT REFERENCES sources(id) ON DELETE RESTRICT,
            evidence TEXT,
            source_captured_at TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN (
              'candidate', 'confirmed', 'rejected', 'superseded', 'expired'
            )),
            sensitivity TEXT NOT NULL CHECK (sensitivity IN (
              'ordinary', 'personal', 'sensitive', 'restricted'
            )),
            valid_from TEXT,
            valid_until TEXT,
            supersedes_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        ) STRICT;

        CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            entity_type TEXT NOT NULL CHECK (entity_type IN (
              'claim', 'source', 'document', 'schema', 'context'
            )),
            entity_id TEXT NOT NULL,
            occurred_at TEXT NOT NULL,
            actor_type TEXT NOT NULL CHECK (actor_type IN (
              'user', 'agent', 'system', 'import'
            )),
            actor_id TEXT,
            data_json TEXT
        ) STRICT;

        CREATE INDEX IF NOT EXISTS claims_status_idx ON claims(status);
        CREATE INDEX IF NOT EXISTS claims_category_idx ON claims(category);
        CREATE INDEX IF NOT EXISTS claims_key_idx ON claims(claim_key);
        CREATE INDEX IF NOT EXISTS claims_source_idx ON claims(source_id);
        CREATE INDEX IF NOT EXISTS events_entity_idx ON events(entity_type, entity_id);
        CREATE INDEX IF NOT EXISTS events_type_idx ON events(type);
        CREATE INDEX IF NOT EXISTS events_occurred_idx ON events(occurred_at);

        CREATE TABLE IF NOT EXISTS capture_snapshots (
            interaction_id TEXT NOT NULL,
            digest TEXT NOT NULL,
            source_id TEXT,
            extractor TEXT NOT NULL,
            proposal_count INTEGER NOT NULL CHECK (proposal_count >= 0),
            processed_at TEXT NOT NULL,
            PRIMARY KEY (interaction_id, digest)
        ) STRICT;

        CREATE INDEX IF NOT EXISTS capture_snapshots_processed_idx
          ON capture_snapshots(processed_at);",
    )
    .map_err(error_text)?;

    tx.execute(
        "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)",
        params![SCHEMA_VERSION, Utc::now().to_rfc3339()],
    )
    .map_err(error_text)?;
    tx.commit().map_err(error_text)?;
    Ok(())
}

fn claim_from_row(row: &Row<'_>) -> rusqlite::Result<MemoryClaim> {
    let value_json: String = row.get("value_json")?;
    let tags_json: String = row.get("tags_json")?;
    let supersedes_json: String = row.get("supersedes_json")?;
    let source_type: String = row.get("source_type")?;
    let epistemic_type: String = row.get("epistemic_type")?;
    let status: String = row.get("status")?;
    let sensitivity: String = row.get("sensitivity")?;

    let payload = json!({
        "id": row.get::<_, String>("id")?,
        "subject": row.get::<_, String>("subject")?,
        "key": row.get::<_, String>("claim_key")?,
        "value": serde_json::from_str::<Value>(&value_json).map_err(|error| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error)))?,
        "category": row.get::<_, Option<String>>("category")?,
        "tags": serde_json::from_str::<Value>(&tags_json).map_err(|error| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error)))?,
        "epistemicType": epistemic_type,
        "confidence": row.get::<_, f64>("confidence")?,
        "provenance": {
            "sourceType": source_type,
            "provider": row.get::<_, Option<String>>("provider")?,
            "sourceId": row.get::<_, Option<String>>("source_id")?,
            "evidence": row.get::<_, Option<String>>("evidence")?,
            "capturedAt": row.get::<_, String>("source_captured_at")?
        },
        "status": status,
        "sensitivity": sensitivity,
        "validFrom": row.get::<_, Option<String>>("valid_from")?,
        "validUntil": row.get::<_, Option<String>>("valid_until")?,
        "supersedes": serde_json::from_str::<Value>(&supersedes_json).map_err(|error| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error)))?,
        "createdAt": row.get::<_, String>("created_at")?,
        "updatedAt": row.get::<_, String>("updated_at")?
    });

    serde_json::from_value(payload).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            0,
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })
}

fn write_claim(connection: &Connection, claim: &MemoryClaim) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO claims (
              id, subject, claim_key, value_json, category, tags_json,
              epistemic_type, confidence,
              source_type, provider, source_id, evidence, source_captured_at,
              status, sensitivity, valid_from, valid_until, supersedes_json,
              created_at, updated_at
            ) VALUES (
              ?1, ?2, ?3, ?4, ?5, ?6,
              ?7, ?8, ?9, ?10, ?11, ?12, ?13,
              ?14, ?15, ?16, ?17, ?18, ?19, ?20
            )
            ON CONFLICT(id) DO UPDATE SET
              subject = excluded.subject,
              claim_key = excluded.claim_key,
              value_json = excluded.value_json,
              category = excluded.category,
              tags_json = excluded.tags_json,
              epistemic_type = excluded.epistemic_type,
              confidence = excluded.confidence,
              source_type = excluded.source_type,
              provider = excluded.provider,
              source_id = excluded.source_id,
              evidence = excluded.evidence,
              source_captured_at = excluded.source_captured_at,
              status = excluded.status,
              sensitivity = excluded.sensitivity,
              valid_from = excluded.valid_from,
              valid_until = excluded.valid_until,
              supersedes_json = excluded.supersedes_json,
              created_at = excluded.created_at,
              updated_at = excluded.updated_at",
            params![
                claim.id,
                claim.subject,
                claim.key,
                serde_json::to_string(&claim.value).map_err(error_text)?,
                claim.category,
                serde_json::to_string(&claim.tags).map_err(error_text)?,
                enum_text(&claim.epistemic_type)?,
                claim.confidence,
                enum_text(&claim.provenance.source_type)?,
                claim.provenance.provider,
                claim.provenance.source_id,
                claim.provenance.evidence,
                claim.provenance.captured_at,
                enum_text(&claim.status)?,
                enum_text(&claim.sensitivity)?,
                claim.valid_from,
                claim.valid_until,
                serde_json::to_string(&claim.supersedes).map_err(error_text)?,
                claim.created_at,
                claim.updated_at,
            ],
        )
        .map_err(error_text)?;
    Ok(())
}

fn append_event(connection: &Connection, event: &MemoryEvent) -> Result<(), String> {
    let data = event
        .data
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(error_text)?;
    connection
        .execute(
            "INSERT INTO events (
              id, type, entity_type, entity_id, occurred_at,
              actor_type, actor_id, data_json
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                event.id,
                enum_text(&event.event_type)?,
                enum_text(&event.entity_type)?,
                event.entity_id,
                event.occurred_at,
                enum_text(&event.actor.actor_type)?,
                event.actor.id,
                data,
            ],
        )
        .map_err(error_text)?;
    Ok(())
}

fn validate_draft(input: &ClaimDraftInput) -> Result<(), String> {
    if input.subject.trim().is_empty() {
        return Err("Subject is required.".to_owned());
    }
    if input.key.trim().is_empty() {
        return Err("Key is required.".to_owned());
    }
    if !(0.0..=1.0).contains(&input.confidence) {
        return Err("Confidence must be between 0 and 1.".to_owned());
    }
    let mut seen = std::collections::BTreeSet::new();
    if input
        .tags
        .iter()
        .map(|tag| tag.trim())
        .filter(|tag| !tag.is_empty())
        .any(|tag| !seen.insert(tag.to_owned()))
    {
        return Err("Tags must be unique.".to_owned());
    }
    Ok(())
}

fn create_claim_in(
    connection: &Connection,
    input: ClaimDraftInput,
    candidate: bool,
) -> Result<MemoryClaim, String> {
    validate_draft(&input)?;
    let now = Utc::now().to_rfc3339();
    let status = if candidate {
        ClaimStatus::Candidate
    } else {
        ClaimStatus::Confirmed
    };
    let claim = MemoryClaim {
        id: format!("claim-{}", Uuid::new_v4()),
        subject: input.subject.trim().to_owned(),
        key: input.key.trim().to_owned(),
        value: input.value,
        category: input
            .category
            .and_then(|value| (!value.trim().is_empty()).then(|| value.trim().to_owned())),
        tags: input
            .tags
            .into_iter()
            .map(|tag| tag.trim().to_owned())
            .filter(|tag| !tag.is_empty())
            .collect(),
        epistemic_type: input.epistemic_type,
        confidence: input.confidence,
        provenance: ClaimProvenance {
            source_type: SourceType::Manual,
            provider: None,
            source_id: None,
            evidence: None,
            captured_at: now.clone(),
        },
        status: status.clone(),
        sensitivity: input.sensitivity,
        valid_from: None,
        valid_until: None,
        supersedes: Vec::new(),
        created_at: now.clone(),
        updated_at: now.clone(),
    };

    let event = MemoryEvent {
        id: format!("event-{}", Uuid::new_v4()),
        event_type: if candidate {
            EventType::ClaimProposed
        } else {
            EventType::ClaimConfirmed
        },
        entity_type: EventEntityType::Claim,
        entity_id: claim.id.clone(),
        occurred_at: now,
        actor: Actor {
            actor_type: ActorType::User,
            id: None,
        },
        data: Some(BTreeMap::from([(
            "origin".to_owned(),
            Value::String("desktop-manual".to_owned()),
        )])),
    };

    let tx = connection.unchecked_transaction().map_err(error_text)?;
    write_claim(&tx, &claim)?;
    append_event(&tx, &event)?;
    tx.commit().map_err(error_text)?;
    Ok(claim)
}

fn read_claim(connection: &Connection, id: &str) -> Result<MemoryClaim, String> {
    connection
        .query_row("SELECT * FROM claims WHERE id = ?1", [id], claim_from_row)
        .map_err(error_text)
}

fn edit_candidate_in(
    connection: &Connection,
    id: &str,
    input: ClaimDraftInput,
) -> Result<MemoryClaim, String> {
    validate_draft(&input)?;
    let mut claim = read_claim(connection, id)?;
    if claim.status != ClaimStatus::Candidate {
        return Err("Only candidate claims can be edited in the desktop alpha.".to_owned());
    }

    let now = Utc::now().to_rfc3339();
    claim.subject = input.subject.trim().to_owned();
    claim.key = input.key.trim().to_owned();
    claim.value = input.value;
    claim.category = input
        .category
        .and_then(|value| (!value.trim().is_empty()).then(|| value.trim().to_owned()));
    claim.tags = input
        .tags
        .into_iter()
        .map(|tag| tag.trim().to_owned())
        .filter(|tag| !tag.is_empty())
        .collect();
    claim.epistemic_type = input.epistemic_type;
    claim.confidence = input.confidence;
    claim.sensitivity = input.sensitivity;
    claim.updated_at = now.clone();

    let event = MemoryEvent {
        id: format!("event-{}", Uuid::new_v4()),
        event_type: EventType::ClaimEdited,
        entity_type: EventEntityType::Claim,
        entity_id: claim.id.clone(),
        occurred_at: now,
        actor: Actor {
            actor_type: ActorType::User,
            id: None,
        },
        data: None,
    };

    let tx = connection.unchecked_transaction().map_err(error_text)?;
    write_claim(&tx, &claim)?;
    append_event(&tx, &event)?;
    tx.commit().map_err(error_text)?;
    Ok(claim)
}

fn review_candidate_in(
    connection: &Connection,
    id: &str,
    decision: &str,
) -> Result<MemoryClaim, String> {
    let mut claim = read_claim(connection, id)?;
    if claim.status != ClaimStatus::Candidate {
        return Err("Only candidate claims can be reviewed.".to_owned());
    }

    let (status, event_type) = match decision {
        "confirm" => (ClaimStatus::Confirmed, EventType::ClaimConfirmed),
        "reject" => (ClaimStatus::Rejected, EventType::ClaimRejected),
        _ => return Err("Decision must be confirm or reject.".to_owned()),
    };
    let now = Utc::now().to_rfc3339();
    claim.status = status;
    claim.updated_at = now.clone();

    let event = MemoryEvent {
        id: format!("event-{}", Uuid::new_v4()),
        event_type,
        entity_type: EventEntityType::Claim,
        entity_id: claim.id.clone(),
        occurred_at: now.clone(),
        actor: Actor {
            actor_type: ActorType::User,
            id: None,
        },
        data: Some(BTreeMap::from([(
            "decision".to_owned(),
            Value::String(decision.to_owned()),
        )])),
    };

    let tx = connection.unchecked_transaction().map_err(error_text)?;
    write_claim(&tx, &claim)?;
    append_event(&tx, &event)?;

    if decision == "confirm" {
        for superseded_id in &claim.supersedes {
            let mut previous = read_claim(&tx, superseded_id)?;
            if previous.status != ClaimStatus::Confirmed {
                continue;
            }
            previous.status = ClaimStatus::Superseded;
            previous.updated_at = now.clone();
            write_claim(&tx, &previous)?;
            append_event(
                &tx,
                &MemoryEvent {
                    id: format!("event-{}", Uuid::new_v4()),
                    event_type: EventType::ClaimSuperseded,
                    entity_type: EventEntityType::Claim,
                    entity_id: previous.id.clone(),
                    occurred_at: now.clone(),
                    actor: Actor {
                        actor_type: ActorType::User,
                        id: None,
                    },
                    data: Some(BTreeMap::from([(
                        "supersededBy".to_owned(),
                        Value::String(claim.id.clone()),
                    )])),
                },
            )?;
        }
    }

    tx.commit().map_err(error_text)?;
    Ok(claim)
}

fn all_claims(connection: &Connection) -> Result<Vec<MemoryClaim>, String> {
    let mut statement = connection
        .prepare("SELECT * FROM claims ORDER BY updated_at DESC, id ASC LIMIT 500")
        .map_err(error_text)?;
    let rows = statement.query_map([], claim_from_row).map_err(error_text)?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(error_text)
}

fn claim_status_text(status: &ClaimStatus) -> Result<String, String> {
    enum_text(status)
}

fn is_current(claim: &MemoryClaim, now: &DateTime<Utc>) -> bool {
    let valid_from_ok = claim
        .valid_from
        .as_ref()
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .map(|value| value.with_timezone(&Utc) <= *now)
        .unwrap_or(true);
    let valid_until_ok = claim
        .valid_until
        .as_ref()
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .map(|value| value.with_timezone(&Utc) >= *now)
        .unwrap_or(true);
    valid_from_ok && valid_until_ok
}

#[tauri::command]
fn domain_contract_version() -> &'static str {
    topo_contracts::DOMAIN_CONTRACT_VERSION
}

#[tauri::command]
fn desktop_status() -> Result<DesktopStatus, String> {
    let connection = open_store()?;
    let count = |status: Option<&str>| -> Result<i64, String> {
        if let Some(status) = status {
            connection
                .query_row("SELECT COUNT(*) FROM claims WHERE status = ?1", [status], |row| {
                    row.get(0)
                })
                .map_err(error_text)
        } else {
            connection
                .query_row("SELECT COUNT(*) FROM claims", [], |row| row.get(0))
                .map_err(error_text)
        }
    };
    Ok(DesktopStatus {
        contract_version: topo_contracts::DOMAIN_CONTRACT_VERSION,
        store_path: default_store_path()?.display().to_string(),
        confirmed: count(Some("confirmed"))?,
        candidates: count(Some("candidate"))?,
        total: count(None)?,
    })
}

#[tauri::command(rename_all = "camelCase")]
fn list_claims(status: Option<String>, query: Option<String>) -> Result<Vec<MemoryClaim>, String> {
    let connection = open_store()?;
    let query = query.unwrap_or_default().to_lowercase();
    Ok(all_claims(&connection)?
        .into_iter()
        .filter(|claim| {
            status
                .as_ref()
                .map(|expected| {
                    claim_status_text(&claim.status)
                        .map(|actual| actual == *expected)
                        .unwrap_or(false)
                })
                .unwrap_or(true)
        })
        .filter(|claim| {
            if query.is_empty() {
                return true;
            }
            let haystack = format!(
                "{} {} {} {}",
                claim.subject,
                claim.key,
                serde_json::to_string(&claim.value).unwrap_or_default(),
                claim.category.clone().unwrap_or_default()
            )
            .to_lowercase();
            haystack.contains(&query)
        })
        .collect())
}

#[tauri::command(rename_all = "camelCase")]
fn create_claim(input: ClaimDraftInput, candidate: bool) -> Result<MemoryClaim, String> {
    let connection = open_store()?;
    create_claim_in(&connection, input, candidate)
}

#[tauri::command(rename_all = "camelCase")]
fn edit_candidate_claim(id: String, input: ClaimDraftInput) -> Result<MemoryClaim, String> {
    let connection = open_store()?;
    edit_candidate_in(&connection, &id, input)
}

fn review_candidates_in(
    connection: &Connection,
    ids: &[String],
    decision: &str,
) -> Result<Vec<MemoryClaim>, String> {
    if ids.is_empty() {
        return Err("Choose at least one candidate to review.".to_owned());
    }
    if ids.len() > 200 {
        return Err("Bulk review is limited to 200 candidates at a time.".to_owned());
    }
    if !matches!(decision, "confirm" | "reject") {
        return Err("Decision must be confirm or reject.".to_owned());
    }

    let unique = ids.iter().collect::<std::collections::BTreeSet<_>>();
    if unique.len() != ids.len() {
        return Err("Bulk review candidate ids must be unique.".to_owned());
    }

    // Validate the complete selection before making any durable review decision.
    // TOPO remains a user-governed store: a stale/non-candidate item should stop
    // the batch rather than silently changing only part of the requested set.
    for id in ids {
        let claim = read_claim(connection, id)?;
        if claim.status != ClaimStatus::Candidate {
            return Err(format!("{} is no longer awaiting review.", claim.key));
        }
        if decision == "confirm" && !claim.supersedes.is_empty() {
            return Err(format!(
                "{} may replace existing memory and requires individual confirmation.",
                claim.key
            ));
        }
    }

    let mut reviewed = Vec::with_capacity(ids.len());
    for id in ids {
        reviewed.push(review_candidate_in(connection, id, decision)?);
    }
    Ok(reviewed)
}

#[tauri::command(rename_all = "camelCase")]
fn review_candidate(id: String, decision: String) -> Result<MemoryClaim, String> {
    let connection = open_store()?;
    review_candidate_in(&connection, &id, &decision)
}

#[tauri::command(rename_all = "camelCase")]
fn review_candidates(ids: Vec<String>, decision: String) -> Result<Vec<MemoryClaim>, String> {
    let connection = open_store()?;
    review_candidates_in(&connection, &ids, &decision)
}

fn context_packet_from_store(
    connection: &Connection,
    subject: &str,
    purpose: &str,
    requested_by: &str,
    include_sensitive: bool,
    max_items: usize,
    channel: &str,
) -> Result<ContextPreview, String> {
    if subject.trim().is_empty() || purpose.trim().is_empty() || requested_by.trim().is_empty() {
        return Err("Subject, purpose and requester are required.".to_owned());
    }
    if !(1..=100).contains(&max_items) {
        return Err("maxItems must be between 1 and 100.".to_owned());
    }

    let now = Utc::now();
    let mut selected = all_claims(connection)?
        .into_iter()
        .filter(|claim| claim.status == ClaimStatus::Confirmed)
        .filter(|claim| claim.subject == subject)
        .filter(|claim| is_current(claim, &now))
        .filter(|claim| {
            matches!(claim.sensitivity, Sensitivity::Ordinary | Sensitivity::Personal)
                || include_sensitive
        })
        .take(max_items)
        .collect::<Vec<_>>();

    selected.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    let selected_ids = selected.iter().map(|claim| claim.id.clone()).collect::<Vec<_>>();
    let evidence_refs = selected
        .iter()
        .filter_map(|claim| claim.provenance.source_id.clone())
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let generated_at = now.to_rfc3339();
    let packet_id = format!("ctx-{}", Uuid::new_v4());

    let packet = json!({
        "specversion": "0.1-draft",
        "id": packet_id.clone(),
        "subject": subject,
        "purpose": purpose,
        "requested_by": requested_by,
        "objects": selected.iter().map(|claim| json!({
            "type": "topo.memory_claim",
            "id": claim.id,
            "value": claim,
        })).collect::<Vec<_>>(),
        "evidence_refs": evidence_refs,
        "scope": "private",
        "generated_at": generated_at.clone(),
        "expires_at": Value::Null,
        "permissions": ["local-use-only"],
        "provenance": {
            "source_type": "application",
            "source_id": format!("topo:context:{}", packet_id),
            "created_by": { "type": "system", "id": "topo" },
            "method": "generated",
            "assertion_type": "interpretation",
            "confidence": "high",
            "created_at": generated_at,
            "derived_from": selected_ids.clone(),
            "extensions": {}
        },
        "extensions": {
            "topo.channel": channel,
            "topo.include_sensitive": include_sensitive
        }
    });

    Ok(ContextPreview {
        packet,
        selected_claim_ids: selected_ids,
    })
}

pub(crate) fn resolve_local_context(
    subject: &str,
    purpose: &str,
    requested_by: &str,
    max_items: usize,
) -> Result<Value, String> {
    let connection = open_store()?;
    Ok(context_packet_from_store(
        &connection,
        subject,
        purpose,
        requested_by,
        false,
        max_items,
        "local-endpoint",
    )?
    .packet)
}

#[tauri::command(rename_all = "camelCase")]
fn preview_context(
    subject: String,
    purpose: String,
    include_sensitive: bool,
    max_items: usize,
) -> Result<ContextPreview, String> {
    let connection = open_store()?;
    context_packet_from_store(
        &connection,
        &subject,
        &purpose,
        "topo-desktop-preview",
        include_sensitive,
        max_items,
        "desktop-preview",
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let endpoint = oos_local::LocalOosEndpoint::start()
                .map_err(std::io::Error::other)?;
            app.manage(endpoint);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            domain_contract_version,
            desktop_status,
            list_claims,
            create_claim,
            edit_candidate_claim,
            review_candidate,
            review_candidates,
            preview_context,
            capture_inbox::capture_inbox_status,
            capture_extractor::ollama_extractor_status,
            capture_processor::process_capture_with_ollama,
            oos_local::local_context_sharing_status,
            oos_local::set_local_context_sharing,
            oos_local::set_local_contributions,
            oos_local::set_local_capture
        ])
        .run(tauri::generate_context!())
        .expect("error while running TOPO");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn draft() -> ClaimDraftInput {
        ClaimDraftInput {
            subject: "project:rack".to_owned(),
            key: "writing.locale".to_owned(),
            value: Value::String("en-GB".to_owned()),
            category: Some("writing".to_owned()),
            tags: vec!["writing".to_owned()],
            epistemic_type: EpistemicType::Preference,
            confidence: 1.0,
            sensitivity: Sensitivity::Ordinary,
        }
    }

    #[test]
    fn native_store_uses_the_same_schema_and_candidate_lifecycle() {
        let file = tempfile::NamedTempFile::new().unwrap();
        let connection = Connection::open(file.path()).unwrap();
        migrate(&connection).unwrap();

        let candidate = create_claim_in(&connection, draft(), true).unwrap();
        assert_eq!(candidate.status, ClaimStatus::Candidate);

        let confirmed = review_candidate_in(&connection, &candidate.id, "confirm").unwrap();
        assert_eq!(confirmed.status, ClaimStatus::Confirmed);

        let event_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM events WHERE entity_id = ?1",
                [&candidate.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(event_count, 2);
    }

    #[test]
    fn bulk_review_validates_the_selection_before_deciding() {
        let connection = Connection::open_in_memory().unwrap();
        migrate(&connection).unwrap();

        let first = create_claim_in(&connection, draft(), true).unwrap();
        let mut second_draft = draft();
        second_draft.key = "writing.tone".to_owned();
        let second = create_claim_in(&connection, second_draft, true).unwrap();

        let reviewed = review_candidates_in(
            &connection,
            &[first.id.clone(), second.id.clone()],
            "confirm",
        )
        .unwrap();
        assert_eq!(reviewed.len(), 2);
        assert!(reviewed.iter().all(|claim| claim.status == ClaimStatus::Confirmed));

        let mut third_draft = draft();
        third_draft.key = "writing.spelling".to_owned();
        let third = create_claim_in(&connection, third_draft, true).unwrap();
        let error = review_candidates_in(
            &connection,
            &[third.id.clone(), first.id.clone()],
            "reject",
        )
        .unwrap_err();
        assert!(error.contains("no longer awaiting review"));
        assert_eq!(read_claim(&connection, &third.id).unwrap().status, ClaimStatus::Candidate);

        let mut replacement_draft = draft();
        replacement_draft.key = "writing.locale".to_owned();
        replacement_draft.value = Value::String("en-US".to_owned());
        let mut replacement = create_claim_in(&connection, replacement_draft, true).unwrap();
        replacement.supersedes = vec![first.id.clone()];
        write_claim(&connection, &replacement).unwrap();

        let error = review_candidates_in(
            &connection,
            &[replacement.id.clone()],
            "confirm",
        )
        .unwrap_err();
        assert!(error.contains("requires individual confirmation"));
        assert_eq!(
            read_claim(&connection, &replacement.id).unwrap().status,
            ClaimStatus::Candidate
        );
    }

    #[test]
    fn human_entered_memory_can_be_confirmed_directly() {
        let connection = Connection::open_in_memory().unwrap();
        migrate(&connection).unwrap();

        let claim = create_claim_in(&connection, draft(), false).unwrap();
        assert_eq!(claim.status, ClaimStatus::Confirmed);
        assert_eq!(claim.provenance.source_type, SourceType::Manual);
    }

    #[test]
    fn local_context_never_discloses_restricted_memory_by_default() {
        let connection = Connection::open_in_memory().unwrap();
        migrate(&connection).unwrap();

        let ordinary = create_claim_in(&connection, draft(), false).unwrap();
        let mut restricted_draft = draft();
        restricted_draft.key = "internal.secret".to_owned();
        restricted_draft.value = Value::String("must stay local".to_owned());
        restricted_draft.sensitivity = Sensitivity::Restricted;
        let restricted = create_claim_in(&connection, restricted_draft, false).unwrap();

        let preview = context_packet_from_store(
            &connection,
            "project:rack",
            "prepare implementation",
            "rack",
            false,
            20,
            "test",
        )
        .unwrap();

        let ids = preview
            .packet
            .get("objects")
            .and_then(Value::as_array)
            .unwrap()
            .iter()
            .filter_map(|item| item.get("id").and_then(Value::as_str))
            .collect::<Vec<_>>();

        assert!(ids.contains(&ordinary.id.as_str()));
        assert!(!ids.contains(&restricted.id.as_str()));
    }

}
