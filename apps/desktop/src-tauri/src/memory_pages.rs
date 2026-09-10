use crate::{enum_text, error_text, open_store};
use chrono::Utc;
use rusqlite::{params, Connection, Row};
use serde::{de::DeserializeOwned, Deserialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use topo_contracts::{
    Actor, ActorType, MemoryHorizon, MemoryPage, MemoryPageEvent, MemoryPageEventType,
    MemoryPageStatus, Sensitivity,
};
use uuid::Uuid;

const MEMORY_PAGE_SCHEMA_VERSION: i64 = 1;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryPageDraftInput {
    pub title: String,
    pub summary: Option<String>,
    pub body: String,
    pub category: Option<String>,
    pub tags: Vec<String>,
    pub sensitivity: Sensitivity,
    pub horizon: MemoryHorizon,
}

pub fn ensure_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS memory_page_schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            ) STRICT;",
        )
        .map_err(error_text)?;

    let version: i64 = connection
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM memory_page_schema_migrations",
            [],
            |row| row.get(0),
        )
        .map_err(error_text)?;
    if version >= MEMORY_PAGE_SCHEMA_VERSION {
        return Ok(());
    }

    let tx = connection.unchecked_transaction().map_err(error_text)?;
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS memory_pages (
            id TEXT PRIMARY KEY,
            subject TEXT NOT NULL,
            title TEXT NOT NULL,
            summary TEXT,
            body TEXT NOT NULL,
            category TEXT,
            tags_json TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN (
              'candidate', 'confirmed', 'rejected', 'superseded', 'expired'
            )),
            sensitivity TEXT NOT NULL CHECK (sensitivity IN (
              'ordinary', 'personal', 'sensitive', 'restricted'
            )),
            horizon TEXT NOT NULL CHECK (horizon IN (
              'durable', 'project', 'temporary'
            )),
            origin TEXT NOT NULL CHECK (origin IN (
              'manual', 'extracted', 'imported', 'compatibility'
            )),
            source_refs_json TEXT NOT NULL,
            annotation_ids_json TEXT NOT NULL,
            valid_from TEXT,
            valid_until TEXT,
            supersedes_json TEXT NOT NULL,
            revision INTEGER NOT NULL CHECK (revision >= 1),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        ) STRICT;

        CREATE TABLE IF NOT EXISTS memory_page_events (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL CHECK (type IN (
              'memory.proposed', 'memory.confirmed', 'memory.edited',
              'memory.rejected', 'memory.superseded', 'memory.expired'
            )),
            entity_id TEXT NOT NULL REFERENCES memory_pages(id) ON DELETE RESTRICT,
            occurred_at TEXT NOT NULL,
            actor_type TEXT NOT NULL CHECK (actor_type IN (
              'user', 'agent', 'system', 'import'
            )),
            actor_id TEXT,
            data_json TEXT
        ) STRICT;

        CREATE INDEX IF NOT EXISTS memory_pages_status_idx ON memory_pages(status);
        CREATE INDEX IF NOT EXISTS memory_pages_subject_idx ON memory_pages(subject);
        CREATE INDEX IF NOT EXISTS memory_pages_category_idx ON memory_pages(category);
        CREATE INDEX IF NOT EXISTS memory_pages_updated_idx ON memory_pages(updated_at);
        CREATE INDEX IF NOT EXISTS memory_page_events_entity_idx ON memory_page_events(entity_id);
        CREATE INDEX IF NOT EXISTS memory_page_events_type_idx ON memory_page_events(type);",
    )
    .map_err(error_text)?;
    tx.execute(
        "INSERT OR IGNORE INTO memory_page_schema_migrations (version, applied_at) VALUES (?1, ?2)",
        params![MEMORY_PAGE_SCHEMA_VERSION, Utc::now().to_rfc3339()],
    )
    .map_err(error_text)?;
    tx.commit().map_err(error_text)?;
    Ok(())
}

fn parse_enum<T: DeserializeOwned>(value: String) -> rusqlite::Result<T> {
    serde_json::from_value(Value::String(value)).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            0,
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })
}

fn parse_json<T: DeserializeOwned>(value: String) -> rusqlite::Result<T> {
    serde_json::from_str(&value).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            0,
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })
}

fn page_from_row(row: &Row<'_>) -> rusqlite::Result<MemoryPage> {
    Ok(MemoryPage {
        id: row.get("id")?,
        subject: row.get("subject")?,
        title: row.get("title")?,
        summary: row.get("summary")?,
        body: row.get("body")?,
        category: row.get("category")?,
        tags: parse_json(row.get("tags_json")?)?,
        status: parse_enum(row.get("status")?)?,
        sensitivity: parse_enum(row.get("sensitivity")?)?,
        horizon: parse_enum(row.get("horizon")?)?,
        origin: parse_enum(row.get("origin")?)?,
        source_refs: parse_json(row.get("source_refs_json")?)?,
        annotation_ids: parse_json(row.get("annotation_ids_json")?)?,
        valid_from: row.get("valid_from")?,
        valid_until: row.get("valid_until")?,
        supersedes: parse_json(row.get("supersedes_json")?)?,
        revision: row.get::<_, i64>("revision")? as u64,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub fn read_memory_page(connection: &Connection, id: &str) -> Result<MemoryPage, String> {
    connection
        .query_row("SELECT * FROM memory_pages WHERE id = ?1", [id], page_from_row)
        .map_err(error_text)
}

pub fn all_memory_pages(connection: &Connection) -> Result<Vec<MemoryPage>, String> {
    let mut statement = connection
        .prepare("SELECT * FROM memory_pages ORDER BY updated_at DESC, id ASC")
        .map_err(error_text)?;
    let rows = statement
        .query_map([], page_from_row)
        .map_err(error_text)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(error_text)
}

fn assert_sources_exist(connection: &Connection, page: &MemoryPage) -> Result<(), String> {
    for reference in &page.source_refs {
        let count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sources WHERE id = ?1",
                [&reference.source_id],
                |row| row.get(0),
            )
            .map_err(error_text)?;
        if count == 0 {
            return Err(format!(
                "Memory Page {} references missing source {}",
                page.id, reference.source_id
            ));
        }
    }
    Ok(())
}

pub fn write_memory_page(connection: &Connection, page: &MemoryPage) -> Result<(), String> {
    assert_sources_exist(connection, page)?;
    connection
        .execute(
            "INSERT INTO memory_pages (
              id, subject, title, summary, body, category, tags_json,
              status, sensitivity, horizon, origin, source_refs_json,
              annotation_ids_json, valid_from, valid_until, supersedes_json,
              revision, created_at, updated_at
            ) VALUES (
              ?1, ?2, ?3, ?4, ?5, ?6, ?7,
              ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16,
              ?17, ?18, ?19
            )
            ON CONFLICT(id) DO UPDATE SET
              subject = excluded.subject,
              title = excluded.title,
              summary = excluded.summary,
              body = excluded.body,
              category = excluded.category,
              tags_json = excluded.tags_json,
              status = excluded.status,
              sensitivity = excluded.sensitivity,
              horizon = excluded.horizon,
              origin = excluded.origin,
              source_refs_json = excluded.source_refs_json,
              annotation_ids_json = excluded.annotation_ids_json,
              valid_from = excluded.valid_from,
              valid_until = excluded.valid_until,
              supersedes_json = excluded.supersedes_json,
              revision = excluded.revision,
              created_at = excluded.created_at,
              updated_at = excluded.updated_at",
            params![
                page.id,
                page.subject,
                page.title,
                page.summary,
                page.body,
                page.category,
                serde_json::to_string(&page.tags).map_err(error_text)?,
                enum_text(&page.status)?,
                enum_text(&page.sensitivity)?,
                enum_text(&page.horizon)?,
                enum_text(&page.origin)?,
                serde_json::to_string(&page.source_refs).map_err(error_text)?,
                serde_json::to_string(&page.annotation_ids).map_err(error_text)?,
                page.valid_from,
                page.valid_until,
                serde_json::to_string(&page.supersedes).map_err(error_text)?,
                i64::try_from(page.revision).map_err(error_text)?,
                page.created_at,
                page.updated_at,
            ],
        )
        .map_err(error_text)?;
    Ok(())
}

pub fn append_memory_page_event(
    connection: &Connection,
    event: &MemoryPageEvent,
) -> Result<(), String> {
    let data_json = event
        .data
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(error_text)?;
    connection
        .execute(
            "INSERT INTO memory_page_events (
              id, type, entity_id, occurred_at, actor_type, actor_id, data_json
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                event.id,
                enum_text(&event.event_type)?,
                event.entity_id,
                event.occurred_at,
                enum_text(&event.actor.actor_type)?,
                event.actor.id,
                data_json,
            ],
        )
        .map_err(error_text)?;
    Ok(())
}

fn validate_draft(input: &MemoryPageDraftInput) -> Result<(), String> {
    if input.title.trim().is_empty() {
        return Err("Title is required.".to_owned());
    }
    if input.body.trim().is_empty() {
        return Err("Memory body is required.".to_owned());
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

fn user_actor() -> Actor {
    Actor {
        actor_type: ActorType::User,
        id: None,
    }
}

fn page_event(
    page: &MemoryPage,
    event_type: MemoryPageEventType,
    now: &str,
    data: Option<BTreeMap<String, Value>>,
) -> MemoryPageEvent {
    MemoryPageEvent {
        id: format!("event-{}", Uuid::new_v4()),
        event_type,
        entity_type: "memory".to_owned(),
        entity_id: page.id.clone(),
        occurred_at: now.to_owned(),
        actor: user_actor(),
        data,
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn list_memory_pages(
    status: Option<String>,
    query: Option<String>,
) -> Result<Vec<MemoryPage>, String> {
    let connection = open_store()?;
    let mut pages = all_memory_pages(&connection)?;
    if let Some(status) = status.filter(|value| !value.trim().is_empty()) {
        pages.retain(|page| enum_text(&page.status).map(|value| value == status).unwrap_or(false));
    }
    if let Some(query) = query.map(|value| value.trim().to_ascii_lowercase()).filter(|value| !value.is_empty()) {
        pages.retain(|page| {
            page.title.to_ascii_lowercase().contains(&query)
                || page.body.to_ascii_lowercase().contains(&query)
                || page.summary.as_ref().is_some_and(|value| value.to_ascii_lowercase().contains(&query))
                || page.category.as_ref().is_some_and(|value| value.to_ascii_lowercase().contains(&query))
                || page.tags.iter().any(|tag| tag.to_ascii_lowercase().contains(&query))
        });
    }
    Ok(pages)
}

#[tauri::command(rename_all = "camelCase")]
pub fn edit_candidate_memory_page(
    id: String,
    input: MemoryPageDraftInput,
) -> Result<MemoryPage, String> {
    validate_draft(&input)?;
    let connection = open_store()?;
    let tx = connection.unchecked_transaction().map_err(error_text)?;
    let mut page = read_memory_page(&tx, &id)?;
    if page.status != MemoryPageStatus::Candidate {
        return Err("Only candidate Memory Pages can be edited.".to_owned());
    }

    page.title = input.title.trim().to_owned();
    page.summary = input
        .summary
        .and_then(|value| (!value.trim().is_empty()).then(|| value.trim().to_owned()));
    page.body = input.body.trim().to_owned();
    page.category = input
        .category
        .and_then(|value| (!value.trim().is_empty()).then(|| value.trim().to_owned()));
    page.tags = input
        .tags
        .into_iter()
        .map(|tag| tag.trim().to_owned())
        .filter(|tag| !tag.is_empty())
        .collect();
    page.sensitivity = input.sensitivity;
    page.horizon = input.horizon;
    page.revision += 1;
    page.updated_at = Utc::now().to_rfc3339();

    write_memory_page(&tx, &page)?;
    append_memory_page_event(
        &tx,
        &page_event(
            &page,
            MemoryPageEventType::Edited,
            &page.updated_at,
            Some(BTreeMap::from([("revision".to_owned(), json!(page.revision))])),
        ),
    )?;
    tx.commit().map_err(error_text)?;
    Ok(page)
}

fn review_page_in(
    connection: &Connection,
    id: &str,
    decision: &str,
    allow_superseding: bool,
) -> Result<MemoryPage, String> {
    let mut page = read_memory_page(connection, id)?;
    if page.status != MemoryPageStatus::Candidate {
        return Err(format!("Memory Page {} is no longer a candidate.", page.id));
    }
    if decision != "confirm" && decision != "reject" {
        return Err("Decision must be confirm or reject.".to_owned());
    }
    if decision == "confirm" && !allow_superseding && !page.supersedes.is_empty() {
        return Err("Potential changes need individual confirmation.".to_owned());
    }

    let now = Utc::now().to_rfc3339();
    if decision == "confirm" {
        page.status = MemoryPageStatus::Confirmed;
        page.revision += 1;
        page.updated_at = now.clone();
        write_memory_page(connection, &page)?;
        append_memory_page_event(
            connection,
            &page_event(
                &page,
                MemoryPageEventType::Confirmed,
                &now,
                Some(BTreeMap::from([
                    ("fromStatus".to_owned(), Value::String("candidate".to_owned())),
                    ("toStatus".to_owned(), Value::String("confirmed".to_owned())),
                    ("revision".to_owned(), json!(page.revision)),
                ])),
            ),
        )?;

        for superseded_id in page.supersedes.clone() {
            let Ok(mut superseded) = read_memory_page(connection, &superseded_id) else {
                continue;
            };
            if superseded.status != MemoryPageStatus::Confirmed {
                continue;
            }
            superseded.status = MemoryPageStatus::Superseded;
            superseded.revision += 1;
            superseded.updated_at = now.clone();
            write_memory_page(connection, &superseded)?;
            append_memory_page_event(
                connection,
                &page_event(
                    &superseded,
                    MemoryPageEventType::Superseded,
                    &now,
                    Some(BTreeMap::from([
                        ("replacementId".to_owned(), Value::String(page.id.clone())),
                        ("revision".to_owned(), json!(superseded.revision)),
                    ])),
                ),
            )?;
        }
    } else {
        page.status = MemoryPageStatus::Rejected;
        page.revision += 1;
        page.updated_at = now.clone();
        write_memory_page(connection, &page)?;
        append_memory_page_event(
            connection,
            &page_event(
                &page,
                MemoryPageEventType::Rejected,
                &now,
                Some(BTreeMap::from([
                    ("fromStatus".to_owned(), Value::String("candidate".to_owned())),
                    ("toStatus".to_owned(), Value::String("rejected".to_owned())),
                    ("revision".to_owned(), json!(page.revision)),
                ])),
            ),
        )?;
    }
    Ok(page)
}

#[tauri::command(rename_all = "camelCase")]
pub fn review_memory_page(id: String, decision: String) -> Result<MemoryPage, String> {
    let connection = open_store()?;
    let tx = connection.unchecked_transaction().map_err(error_text)?;
    let page = review_page_in(&tx, &id, &decision, true)?;
    tx.commit().map_err(error_text)?;
    Ok(page)
}

#[tauri::command(rename_all = "camelCase")]
pub fn review_memory_pages(ids: Vec<String>, decision: String) -> Result<Vec<MemoryPage>, String> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let connection = open_store()?;
    let tx = connection.unchecked_transaction().map_err(error_text)?;
    let mut reviewed = Vec::with_capacity(ids.len());
    for id in ids {
        reviewed.push(review_page_in(&tx, &id, &decision, false)?);
    }
    tx.commit().map_err(error_text)?;
    Ok(reviewed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use topo_contracts::{MemoryPageOrigin, MemoryPageSourceRef, SourceType, MemorySource};

    fn source() -> MemorySource {
        MemorySource {
            id: "source-1".to_owned(),
            source_type: SourceType::Conversation,
            title: None,
            provider: Some("test".to_owned()),
            external_id: None,
            captured_at: "2026-09-10T05:00:00Z".to_owned(),
            created_at: "2026-09-10T05:00:00Z".to_owned(),
            sensitivity: Sensitivity::Ordinary,
            metadata: None,
        }
    }

    fn page() -> MemoryPage {
        MemoryPage {
            id: "memory-1".to_owned(),
            subject: "self".to_owned(),
            title: "Test memory".to_owned(),
            summary: None,
            body: "A coherent test memory.".to_owned(),
            category: None,
            tags: vec![],
            status: MemoryPageStatus::Candidate,
            sensitivity: Sensitivity::Ordinary,
            horizon: MemoryHorizon::Project,
            origin: MemoryPageOrigin::Extracted,
            source_refs: vec![MemoryPageSourceRef {
                source_id: "source-1".to_owned(),
                evidence: Some("test evidence".to_owned()),
                turn_ids: Some(vec!["u1".to_owned()]),
            }],
            annotation_ids: vec![],
            valid_from: None,
            valid_until: None,
            supersedes: vec![],
            revision: 1,
            created_at: "2026-09-10T05:01:00Z".to_owned(),
            updated_at: "2026-09-10T05:01:00Z".to_owned(),
        }
    }

    fn write_test_source(connection: &Connection, source: &MemorySource) {
        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS sources (
                id TEXT PRIMARY KEY,
                type TEXT NOT NULL,
                title TEXT,
                provider TEXT,
                external_id TEXT,
                captured_at TEXT NOT NULL,
                created_at TEXT NOT NULL,
                sensitivity TEXT NOT NULL,
                metadata_json TEXT
            ) STRICT;",
        ).unwrap();
        connection.execute(
            "INSERT INTO sources (id, type, provider, captured_at, created_at, sensitivity)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![source.id, "conversation", source.provider, source.captured_at, source.created_at, "ordinary"],
        ).unwrap();
    }

    #[test]
    fn native_memory_page_store_round_trips() {
        let connection = Connection::open_in_memory().unwrap();
        write_test_source(&connection, &source());
        ensure_schema(&connection).unwrap();
        write_memory_page(&connection, &page()).unwrap();
        let stored = read_memory_page(&connection, "memory-1").unwrap();
        assert_eq!(stored.title, "Test memory");
        assert_eq!(stored.status, MemoryPageStatus::Candidate);
    }
}
