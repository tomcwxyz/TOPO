use rusqlite::{params, Connection, Row};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use topo_contracts::{
    MemoryHorizon, MemoryPage, MemoryPageOrigin, MemoryPageSourceRef, MemoryPageStatus, Sensitivity,
};

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

// The integration harness imports the shipping resolver directly. This minimal
// adapter only supplies the canonical Memory Page table operations the resolver
// needs, keeping test setup independent of the desktop command layer.
mod memory_pages {
    use super::*;

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

    pub fn ensure_schema(connection: &Connection) -> Result<(), String> {
        connection
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS memory_pages (
                    id TEXT PRIMARY KEY,
                    subject TEXT NOT NULL,
                    title TEXT NOT NULL,
                    summary TEXT,
                    body TEXT NOT NULL,
                    category TEXT,
                    tags_json TEXT NOT NULL,
                    status TEXT NOT NULL,
                    sensitivity TEXT NOT NULL,
                    horizon TEXT NOT NULL,
                    origin TEXT NOT NULL,
                    source_refs_json TEXT NOT NULL,
                    annotation_ids_json TEXT NOT NULL,
                    valid_from TEXT,
                    valid_until TEXT,
                    supersedes_json TEXT NOT NULL,
                    revision INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                ) STRICT;",
            )
            .map_err(error_text)
    }

    pub fn all_memory_pages(connection: &Connection) -> Result<Vec<MemoryPage>, String> {
        let mut statement = connection
            .prepare("SELECT * FROM memory_pages ORDER BY updated_at DESC, id ASC")
            .map_err(error_text)?;
        let rows = statement.query_map([], page_from_row).map_err(error_text)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(error_text)
    }

    pub fn write_memory_page(connection: &Connection, page: &MemoryPage) -> Result<(), String> {
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
}

fn migrate(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS sources (
                id TEXT PRIMARY KEY,
                type TEXT NOT NULL,
                captured_at TEXT NOT NULL,
                created_at TEXT NOT NULL,
                sensitivity TEXT NOT NULL
            ) STRICT;",
        )
        .map_err(error_text)
}

// Use the shipping M4 resolver and its shipping FTS implementation, rather than
// reproducing retrieval logic in the benchmark.
#[path = "../src/context_pages.rs"]
mod context_pages;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RetrievalFixtureSet {
    version: String,
    cases: Vec<RetrievalCase>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RetrievalCase {
    id: String,
    subject: String,
    purpose: String,
    query: Option<String>,
    max_items: usize,
    semantic_challenge: bool,
    expected_ids: Vec<String>,
    forbidden_ids: Vec<String>,
    pages: Vec<FixturePage>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixturePage {
    id: String,
    title: String,
    body: String,
    category: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
    sensitivity: Sensitivity,
    valid_until: Option<String>,
    updated_at: String,
}

#[derive(Debug, Default)]
struct RetrievalScore {
    cases: usize,
    required: usize,
    hits: usize,
    non_semantic_required: usize,
    non_semantic_hits: usize,
    semantic_required: usize,
    semantic_hits: usize,
    reciprocal_rank_sum: f64,
    ranked_cases: usize,
    forbidden_disclosures: usize,
    total_context_chars: u64,
}

impl RetrievalScore {
    fn recall(&self) -> f64 {
        ratio(self.hits, self.required)
    }

    fn non_semantic_recall(&self) -> f64 {
        ratio(self.non_semantic_hits, self.non_semantic_required)
    }

    fn semantic_recall(&self) -> f64 {
        ratio(self.semantic_hits, self.semantic_required)
    }

    fn mean_reciprocal_rank(&self) -> f64 {
        if self.ranked_cases == 0 {
            1.0
        } else {
            self.reciprocal_rank_sum / self.ranked_cases as f64
        }
    }

    fn average_context_chars(&self) -> f64 {
        if self.cases == 0 {
            0.0
        } else {
            self.total_context_chars as f64 / self.cases as f64
        }
    }
}

fn ratio(numerator: usize, denominator: usize) -> f64 {
    if denominator == 0 {
        1.0
    } else {
        numerator as f64 / denominator as f64
    }
}

fn fixtures() -> RetrievalFixtureSet {
    serde_json::from_str(include_str!("../fixtures/retrieval-evaluation.json"))
        .expect("retrieval evaluation fixture should be valid JSON")
}

fn seed_case(case: &RetrievalCase) -> Connection {
    let connection = Connection::open_in_memory().expect("in-memory sqlite");
    migrate(&connection).expect("core fixture schema");
    memory_pages::ensure_schema(&connection).expect("memory page fixture schema");

    for fixture in &case.pages {
        let source_id = format!("source-{}-{}", case.id, fixture.id);
        connection
            .execute(
                "INSERT INTO sources (id, type, captured_at, created_at, sensitivity)
                 VALUES (?1, 'conversation', ?2, ?2, 'ordinary')",
                [&source_id, &fixture.updated_at],
            )
            .expect("fixture source should persist");

        let page = MemoryPage {
            id: fixture.id.clone(),
            subject: case.subject.clone(),
            title: fixture.title.clone(),
            summary: None,
            body: fixture.body.clone(),
            category: fixture.category.clone(),
            tags: fixture.tags.clone(),
            status: MemoryPageStatus::Confirmed,
            sensitivity: fixture.sensitivity.clone(),
            horizon: MemoryHorizon::Project,
            origin: MemoryPageOrigin::Extracted,
            source_refs: vec![MemoryPageSourceRef {
                source_id,
                evidence: Some("labelled retrieval evaluation fixture".to_owned()),
                turn_ids: Some(vec!["u1".to_owned()]),
            }],
            annotation_ids: vec![],
            valid_from: None,
            valid_until: fixture.valid_until.clone(),
            supersedes: vec![],
            revision: 1,
            created_at: fixture.updated_at.clone(),
            updated_at: fixture.updated_at.clone(),
        };
        memory_pages::write_memory_page(&connection, &page).expect("fixture page should persist");
    }

    connection
}

fn score_fixtures(set: &RetrievalFixtureSet) -> RetrievalScore {
    let mut score = RetrievalScore::default();

    for case in &set.cases {
        let connection = seed_case(case);
        let resolved = context_pages::resolve_page_context(
            &connection,
            &case.subject,
            &case.purpose,
            "retrieval-evaluation",
            case.query.as_deref(),
            false,
            case.max_items,
            "evaluation",
        )
        .expect("retrieval fixture should resolve")
        .expect("every fixture should retain at least one current confirmed Memory Page");

        let selected = resolved.selected_ids;
        let expected = case.expected_ids.iter().collect::<std::collections::BTreeSet<_>>();
        let hits = selected.iter().filter(|id| expected.contains(id)).count();

        score.cases += 1;
        score.required += case.expected_ids.len();
        score.hits += hits;
        if case.semantic_challenge {
            score.semantic_required += case.expected_ids.len();
            score.semantic_hits += hits;
        } else {
            score.non_semantic_required += case.expected_ids.len();
            score.non_semantic_hits += hits;
        }
        score.forbidden_disclosures += selected
            .iter()
            .filter(|id| case.forbidden_ids.contains(id))
            .count();

        if !case.expected_ids.is_empty() {
            score.ranked_cases += 1;
            if let Some(index) = selected.iter().position(|id| case.expected_ids.contains(id)) {
                score.reciprocal_rank_sum += 1.0 / (index + 1) as f64;
            }
        }

        score.total_context_chars += resolved.packet["extensions"]["topo.context_budget"]
            ["used_chars"]
            .as_u64()
            .unwrap_or(0);
    }

    score
}

#[test]
fn deterministic_retrieval_baseline_is_measurable_before_m5() {
    let set = fixtures();
    assert_eq!(set.version, "0.1");
    assert!(set.cases.iter().any(|case| case.semantic_challenge));

    let score = score_fixtures(&set);
    println!(
        "TOPO retrieval baseline: cases={} recall={:.3} non_semantic_recall={:.3} semantic_recall={:.3} mrr={:.3} forbidden={} avg_context_chars={:.0}",
        score.cases,
        score.recall(),
        score.non_semantic_recall(),
        score.semantic_recall(),
        score.mean_reciprocal_rank(),
        score.forbidden_disclosures,
        score.average_context_chars(),
    );

    assert_eq!(score.forbidden_disclosures, 0);
    assert_eq!(score.non_semantic_recall(), 1.0);
    assert!(score.recall() >= 0.80);
    assert!(score.mean_reciprocal_rank() >= 0.80);
    assert!(score.average_context_chars() < 12_000.0);
}
