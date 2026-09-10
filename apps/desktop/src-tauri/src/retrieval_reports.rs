use crate::{context_packet_from_store, default_store_path, error_text};
use chrono::Utc;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::BTreeSet, fs, path::PathBuf};
use topo_contracts::{MemoryPage, MemoryPageStatus, Sensitivity};
use uuid::Uuid;

const REPORT_VERSION: &str = "0.1-local-dogfood";
const MAX_NOTE_CHARS: usize = 2_000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrievalReportInput {
    subject: String,
    purpose: String,
    include_sensitive: bool,
    max_items: usize,
    expected_ids: Vec<String>,
    note: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrievalReportResult {
    id: String,
    path: String,
    actual_ids: Vec<String>,
    expected_ids: Vec<String>,
    benchmark_compatible: bool,
}

fn report_directory() -> Result<PathBuf, String> {
    let store = default_store_path()?;
    let topo_dir = store
        .parent()
        .ok_or_else(|| "Unable to determine the TOPO data directory.".to_owned())?;
    Ok(topo_dir.join("evaluation").join("retrieval"))
}

fn validate_input(input: &RetrievalReportInput) -> Result<(), String> {
    if input.subject.trim().is_empty() {
        return Err("Subject is required.".to_owned());
    }
    if input.purpose.trim().is_empty() {
        return Err("Purpose is required.".to_owned());
    }
    if !(1..=100).contains(&input.max_items) {
        return Err("maxItems must be between 1 and 100.".to_owned());
    }
    if input.expected_ids.is_empty() {
        return Err("Choose at least one Memory Page that should have appeared.".to_owned());
    }
    let unique = input.expected_ids.iter().collect::<BTreeSet<_>>();
    if unique.len() != input.expected_ids.len() {
        return Err("Expected Memory Page ids must be unique.".to_owned());
    }
    if input.note.trim().chars().count() > MAX_NOTE_CHARS {
        return Err(format!("Evaluation note must be {MAX_NOTE_CHARS} characters or fewer."));
    }
    Ok(())
}

fn confirmed_subject_pages(connection: &Connection, subject: &str) -> Result<Vec<MemoryPage>, String> {
    Ok(crate::memory_pages::all_memory_pages(connection)?
        .into_iter()
        .filter(|page| page.status == MemoryPageStatus::Confirmed)
        .filter(|page| page.subject == subject)
        .collect())
}

fn page_is_allowed_by_preview(page: &MemoryPage, include_sensitive: bool) -> bool {
    matches!(page.sensitivity, Sensitivity::Ordinary | Sensitivity::Personal) || include_sensitive
}

fn build_report(
    connection: &Connection,
    input: &RetrievalReportInput,
    report_id: &str,
    recorded_at: &str,
) -> Result<(Value, Vec<String>), String> {
    validate_input(input)?;

    let subject = input.subject.trim();
    let purpose = input.purpose.trim();
    let pages = confirmed_subject_pages(connection, subject)?;
    if pages.is_empty() {
        return Err(
            "This subject has no confirmed Memory Pages. That is a capture/memory gap rather than a retrieval ranking miss."
                .to_owned(),
        );
    }

    let page_ids = pages.iter().map(|page| page.id.as_str()).collect::<BTreeSet<_>>();
    for expected_id in &input.expected_ids {
        if !page_ids.contains(expected_id.as_str()) {
            return Err(format!(
                "Expected Memory Page {expected_id} is not a confirmed page for this subject."
            ));
        }
        let page = pages
            .iter()
            .find(|page| page.id == *expected_id)
            .expect("validated expected page should exist");
        if !page_is_allowed_by_preview(page, input.include_sensitive) {
            return Err(format!(
                "Expected Memory Page {expected_id} is outside the sensitivity scope of this preview."
            ));
        }
    }

    let preview = context_packet_from_store(
        connection,
        subject,
        purpose,
        "topo-desktop-dogfood-report",
        None,
        input.include_sensitive,
        input.max_items,
        "desktop-dogfood-report",
    )?;
    let actual_ids = preview
        .packet
        .get("objects")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|object| object.get("id").and_then(Value::as_str).map(str::to_owned))
        .collect::<Vec<_>>();

    let forbidden_ids = if input.include_sensitive {
        Vec::new()
    } else {
        pages
            .iter()
            .filter(|page| matches!(page.sensitivity, Sensitivity::Sensitive | Sensitivity::Restricted))
            .map(|page| page.id.clone())
            .collect::<Vec<_>>()
    };

    let representation = preview.packet["extensions"]["topo.representation"]
        .as_str()
        .unwrap_or("unknown");

    let fixture_pages = pages
        .iter()
        .map(|page| {
            json!({
                "id": page.id,
                "title": page.title,
                "body": page.body,
                "category": page.category,
                "tags": page.tags,
                "sensitivity": page.sensitivity,
                "validUntil": page.valid_until,
                "updatedAt": page.updated_at
            })
        })
        .collect::<Vec<_>>();

    let report = json!({
        "version": REPORT_VERSION,
        "recordedAt": recorded_at,
        "note": input.note.trim(),
        "privacy": {
            "localOnly": true,
            "containsMemoryText": true,
            "redactionRequiredBeforeSharing": true
        },
        "benchmarkCompatible": !input.include_sensitive,
        "actual": {
            "selectedIds": actual_ids,
            "representation": representation
        },
        "candidateFixture": {
            "id": report_id,
            "subject": subject,
            "purpose": purpose,
            "query": Value::Null,
            "maxItems": input.max_items,
            "semanticChallenge": false,
            "expectedIds": input.expected_ids,
            "forbiddenIds": forbidden_ids,
            "pages": fixture_pages
        }
    });

    Ok((report, actual_ids))
}

#[tauri::command(rename_all = "camelCase")]
pub fn record_retrieval_report(input: RetrievalReportInput) -> Result<RetrievalReportResult, String> {
    let connection = crate::open_store()?;
    let report_id = format!("dogfood-{}", Uuid::new_v4());
    let recorded_at = Utc::now().to_rfc3339();
    let (report, actual_ids) = build_report(&connection, &input, &report_id, &recorded_at)?;

    let directory = report_directory()?;
    fs::create_dir_all(&directory).map_err(error_text)?;
    let filename = format!(
        "{}-{}.json",
        Utc::now().format("%Y%m%dT%H%M%SZ"),
        report_id
    );
    let path = directory.join(filename);
    fs::write(
        &path,
        serde_json::to_string_pretty(&report).map_err(error_text)?,
    )
    .map_err(error_text)?;

    Ok(RetrievalReportResult {
        id: report_id,
        path: path.display().to_string(),
        actual_ids,
        expected_ids: input.expected_ids,
        benchmark_compatible: !input.include_sensitive,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memory_pages::{ensure_schema, write_memory_page};
    use rusqlite::params;
    use topo_contracts::{
        MemoryHorizon, MemoryPageOrigin, MemoryPageSourceRef, MemorySource, SourceType,
    };

    fn setup() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        crate::migrate(&connection).unwrap();
        ensure_schema(&connection).unwrap();
        connection
    }

    fn write_source(connection: &Connection, id: &str) {
        let now = "2026-09-10T12:00:00Z";
        connection
            .execute(
                "INSERT INTO sources (
                    id, type, captured_at, created_at, sensitivity
                 ) VALUES (?1, 'conversation', ?2, ?2, 'ordinary')",
                params![id, now],
            )
            .unwrap();
    }

    fn page(id: &str, title: &str, body: &str, sensitivity: Sensitivity) -> MemoryPage {
        let source_id = format!("source-{id}");
        MemoryPage {
            id: id.to_owned(),
            subject: "project:rack".to_owned(),
            title: title.to_owned(),
            summary: None,
            body: body.to_owned(),
            category: Some("architecture".to_owned()),
            tags: vec!["rack".to_owned()],
            status: MemoryPageStatus::Confirmed,
            sensitivity,
            horizon: MemoryHorizon::Project,
            origin: MemoryPageOrigin::Extracted,
            source_refs: vec![MemoryPageSourceRef {
                source_id,
                evidence: Some("test evidence".to_owned()),
                turn_ids: Some(vec!["u1".to_owned()]),
            }],
            annotation_ids: vec![],
            valid_from: None,
            valid_until: None,
            supersedes: vec![],
            revision: 1,
            created_at: "2026-09-10T12:00:00Z".to_owned(),
            updated_at: "2026-09-10T12:00:00Z".to_owned(),
        }
    }

    fn persist_page(connection: &Connection, page: &MemoryPage) {
        write_source(connection, &page.source_refs[0].source_id);
        write_memory_page(connection, page).unwrap();
    }

    #[test]
    fn report_snapshots_a_replayable_subject_corpus_and_actual_selection() {
        let connection = setup();
        let expected = page(
            "memory-neon",
            "RACK database",
            "RACK uses Neon rather than Supabase.",
            Sensitivity::Ordinary,
        );
        let other = page(
            "memory-writing",
            "Writing style",
            "Use concise British English.",
            Sensitivity::Ordinary,
        );
        persist_page(&connection, &expected);
        persist_page(&connection, &other);

        let input = RetrievalReportInput {
            subject: "project:rack".to_owned(),
            purpose: "choose the database architecture".to_owned(),
            include_sensitive: false,
            max_items: 1,
            expected_ids: vec![expected.id.clone()],
            note: "The architecture page should have appeared.".to_owned(),
        };
        let (report, actual_ids) = build_report(
            &connection,
            &input,
            "dogfood-test",
            "2026-09-10T13:00:00Z",
        )
        .unwrap();

        assert_eq!(report["candidateFixture"]["expectedIds"][0], expected.id);
        assert_eq!(report["candidateFixture"]["pages"].as_array().unwrap().len(), 2);
        assert_eq!(report["actual"]["selectedIds"], json!(actual_ids));
        assert_eq!(report["privacy"]["redactionRequiredBeforeSharing"], true);
        assert_eq!(report["benchmarkCompatible"], true);
    }

    #[test]
    fn default_scope_marks_sensitive_pages_as_forbidden() {
        let connection = setup();
        let expected = page(
            "memory-public",
            "Public architecture",
            "Use a local database.",
            Sensitivity::Ordinary,
        );
        let restricted = page(
            "memory-secret",
            "Private architecture note",
            "Sensitive implementation detail.",
            Sensitivity::Restricted,
        );
        persist_page(&connection, &expected);
        persist_page(&connection, &restricted);

        let input = RetrievalReportInput {
            subject: "project:rack".to_owned(),
            purpose: "review architecture".to_owned(),
            include_sensitive: false,
            max_items: 2,
            expected_ids: vec![expected.id.clone()],
            note: String::new(),
        };
        let (report, _) = build_report(
            &connection,
            &input,
            "dogfood-test",
            "2026-09-10T13:00:00Z",
        )
        .unwrap();

        assert_eq!(
            report["candidateFixture"]["forbiddenIds"],
            json!([restricted.id])
        );
    }

    #[test]
    fn report_rejects_an_expected_page_outside_preview_sensitivity_scope() {
        let connection = setup();
        let restricted = page(
            "memory-secret",
            "Private architecture note",
            "Sensitive implementation detail.",
            Sensitivity::Restricted,
        );
        persist_page(&connection, &restricted);

        let input = RetrievalReportInput {
            subject: "project:rack".to_owned(),
            purpose: "review architecture".to_owned(),
            include_sensitive: false,
            max_items: 2,
            expected_ids: vec![restricted.id.clone()],
            note: String::new(),
        };
        let error = build_report(
            &connection,
            &input,
            "dogfood-test",
            "2026-09-10T13:00:00Z",
        )
        .unwrap_err();
        assert!(error.contains("outside the sensitivity scope"));
    }
}
