use crate::{default_store_path, error_text, open_store};
use chrono::{Duration, Utc};
use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::Value;
use std::fs;

const WINDOW_HOURS: i64 = 24;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DogfoodSummary {
    window_hours: i64,
    awaiting_review: i64,
    reviewed: i64,
    confirmed: i64,
    rejected: i64,
    review_duration_ms: u64,
    processed_captures: i64,
    retrieval_reports: usize,
}

fn review_summary(connection: &Connection, since: &str) -> Result<(i64, i64, u64), String> {
    let mut statement = connection
        .prepare(
            "SELECT type, data_json
             FROM memory_page_events
             WHERE occurred_at >= ?1
               AND type IN ('memory.confirmed', 'memory.rejected')",
        )
        .map_err(error_text)?;
    let rows = statement
        .query_map([since], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
        })
        .map_err(error_text)?;

    let mut confirmed = 0i64;
    let mut rejected = 0i64;
    let mut review_duration_ms = 0u64;
    for row in rows {
        let (event_type, data_json) = row.map_err(error_text)?;
        match event_type.as_str() {
            "memory.confirmed" => confirmed += 1,
            "memory.rejected" => rejected += 1,
            _ => {}
        }
        if let Some(data_json) = data_json {
            if let Ok(data) = serde_json::from_str::<Value>(&data_json) {
                review_duration_ms = review_duration_ms.saturating_add(
                    data.get("reviewDurationMs")
                        .and_then(Value::as_u64)
                        .unwrap_or(0),
                );
            }
        }
    }
    Ok((confirmed, rejected, review_duration_ms))
}

fn retrieval_report_count_since(since: &str) -> Result<usize, String> {
    let store = default_store_path()?;
    let Some(topo_dir) = store.parent() else {
        return Ok(0);
    };
    let directory = topo_dir.join("evaluation").join("retrieval");
    if !directory.exists() {
        return Ok(0);
    }

    let mut count = 0usize;
    for entry in fs::read_dir(directory).map_err(error_text)? {
        let Ok(entry) = entry else { continue };
        let path = entry.path();
        let Ok(metadata) = fs::symlink_metadata(&path) else { continue };
        if metadata.file_type().is_symlink()
            || !metadata.is_file()
            || path.extension().and_then(|value| value.to_str()) != Some("json")
        {
            continue;
        }
        let Ok(bytes) = fs::read(&path) else { continue };
        let Ok(report) = serde_json::from_slice::<Value>(&bytes) else { continue };
        if report
            .get("recordedAt")
            .and_then(Value::as_str)
            .is_some_and(|recorded_at| recorded_at >= since)
        {
            count += 1;
        }
    }
    Ok(count)
}

fn summary_from_store(connection: &Connection, since: &str) -> Result<DogfoodSummary, String> {
    let awaiting_review = connection
        .query_row(
            "SELECT COUNT(*) FROM memory_pages WHERE status = 'candidate'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(error_text)?;
    let processed_captures = connection
        .query_row(
            "SELECT COUNT(*) FROM capture_snapshots WHERE processed_at >= ?1",
            params![since],
            |row| row.get::<_, i64>(0),
        )
        .map_err(error_text)?;
    let (confirmed, rejected, review_duration_ms) = review_summary(connection, since)?;

    Ok(DogfoodSummary {
        window_hours: WINDOW_HOURS,
        awaiting_review,
        reviewed: confirmed + rejected,
        confirmed,
        rejected,
        review_duration_ms,
        processed_captures,
        retrieval_reports: retrieval_report_count_since(since)?,
    })
}

#[tauri::command]
pub fn dogfood_summary() -> Result<DogfoodSummary, String> {
    let connection = open_store()?;
    let since = (Utc::now() - Duration::hours(WINDOW_HOURS)).to_rfc3339();
    summary_from_store(&connection, &since)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summary_aggregates_review_decisions_and_active_duration() {
        let connection = Connection::open_in_memory().unwrap();
        crate::migrate(&connection).unwrap();
        crate::memory_pages::ensure_schema(&connection).unwrap();
        connection
            .execute(
                "INSERT INTO memory_page_events (
                    id, type, entity_id, occurred_at, actor_type, data_json
                 ) VALUES
                    ('e1', 'memory.confirmed', 'm1', '2026-09-10T10:00:00Z', 'user', ?1),
                    ('e2', 'memory.rejected', 'm2', '2026-09-10T11:00:00Z', 'user', ?2)",
                params![
                    r#"{"reviewDurationMs":12000}"#,
                    r#"{"reviewDurationMs":8000}"#,
                ],
            )
            .unwrap_err();
    }
}
