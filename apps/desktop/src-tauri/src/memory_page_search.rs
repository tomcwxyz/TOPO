use chrono::{DateTime, Utc};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::cmp::Ordering;
use std::collections::BTreeSet;
use topo_contracts::{MemoryPage, MemoryPageStatus, Sensitivity};

use crate::memory_pages;
#[path = "memory_page_index.rs"]
mod memory_page_index;

const MAX_SEARCH_RESULTS: usize = 100;
const MAX_SEARCH_EXCERPT_CHARS: usize = 1_200;
const SEARCH_STOP_WORDS: &[&str] = &[
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how", "in", "is",
    "it", "of", "on", "or", "please", "should", "that", "the", "this", "to", "what", "with",
];

type RankedSearchPage = (MemoryPage, u32, Option<f64>);

fn lexical_terms(value: &str) -> BTreeSet<String> {
    value
        .to_lowercase()
        .split(|character: char| !character.is_alphanumeric())
        .map(str::trim)
        .filter(|term| term.len() > 1 && !SEARCH_STOP_WORDS.contains(term))
        .map(str::to_owned)
        .collect()
}

fn is_current(page: &MemoryPage, now: &DateTime<Utc>) -> bool {
    let valid_from_ok = page
        .valid_from
        .as_ref()
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .map(|value| value.with_timezone(&Utc) <= *now)
        .unwrap_or(true);
    let valid_until_ok = page
        .valid_until
        .as_ref()
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .map(|value| value.with_timezone(&Utc) >= *now)
        .unwrap_or(true);
    valid_from_ok && valid_until_ok
}

fn lexical_score(page: &MemoryPage, terms: &BTreeSet<String>) -> u32 {
    let title = lexical_terms(&page.title);
    let category = lexical_terms(page.category.as_deref().unwrap_or_default());
    let tags = lexical_terms(&page.tags.join(" "));
    let summary = lexical_terms(page.summary.as_deref().unwrap_or_default());
    let body = lexical_terms(&page.body);

    terms
        .iter()
        .map(|term| {
            let mut score = 0;
            if title.contains(term) {
                score += 8;
            }
            if category.contains(term) {
                score += 5;
            }
            if tags.contains(term) {
                score += 4;
            }
            if summary.contains(term) {
                score += 3;
            }
            if body.contains(term) {
                score += 2;
            }
            score
        })
        .sum()
}

fn compare_ranked(left: &RankedSearchPage, right: &RankedSearchPage) -> Ordering {
    right
        .1
        .cmp(&left.1)
        .then_with(|| match (left.2, right.2) {
            (Some(left_rank), Some(right_rank)) => left_rank
                .partial_cmp(&right_rank)
                .unwrap_or(Ordering::Equal),
            (Some(_), None) => Ordering::Less,
            (None, Some(_)) => Ordering::Greater,
            (None, None) => Ordering::Equal,
        })
        .then_with(|| right.0.updated_at.cmp(&left.0.updated_at))
        .then_with(|| right.0.revision.cmp(&left.0.revision))
        .then_with(|| left.0.id.cmp(&right.0.id))
}

fn compact_excerpt(value: &str) -> String {
    let value = value.trim();
    if value.chars().count() <= MAX_SEARCH_EXCERPT_CHARS {
        return value.to_owned();
    }

    let mut excerpt = value
        .chars()
        .take(MAX_SEARCH_EXCERPT_CHARS - 1)
        .collect::<String>();
    if let Some(boundary) = excerpt.rfind(['.', '!', '?', '\n']) {
        if boundary >= MAX_SEARCH_EXCERPT_CHARS / 2 {
            excerpt.truncate(boundary + 1);
            return excerpt.trim().to_owned();
        }
    }
    format!("{}…", excerpt.trim_end())
}

pub fn search_memory_pages(
    connection: &Connection,
    query: &str,
    requested_by: &str,
    category: Option<&str>,
    limit: usize,
) -> Result<Value, String> {
    if query.trim().is_empty() || requested_by.trim().is_empty() {
        return Err("query and requestedBy are required.".to_owned());
    }
    if !(1..=MAX_SEARCH_RESULTS).contains(&limit) {
        return Err(format!("limit must be between 1 and {MAX_SEARCH_RESULTS}."));
    }

    memory_pages::ensure_schema(connection)?;
    let terms = lexical_terms(query);
    let fts_scores = memory_page_index::scores_for_terms(connection, &terms)?;
    let now = Utc::now();
    let category = category
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_lowercase);

    // Search is global rather than purpose-bound, but it is still governed. The
    // candidate set is fixed before any lexical/FTS relevance signal is applied.
    let mut results = memory_pages::all_memory_pages(connection)?
        .into_iter()
        .filter(|page| page.status == MemoryPageStatus::Confirmed)
        .filter(|page| matches!(page.sensitivity, Sensitivity::Ordinary | Sensitivity::Personal))
        .filter(|page| is_current(page, &now))
        .filter(|page| {
            category.as_ref().map_or(true, |expected| {
                page.category
                    .as_deref()
                    .map(str::to_lowercase)
                    .as_deref()
                    == Some(expected.as_str())
            })
        })
        .filter_map(|page| {
            let lexical = lexical_score(&page, &terms);
            let fts_rank = fts_scores.get(&page.id).copied();
            (lexical > 0 || fts_rank.is_some()).then_some((page, lexical, fts_rank))
        })
        .collect::<Vec<_>>();

    results.sort_by(compare_ranked);
    results.truncate(limit);

    Ok(json!({
        "requestedBy": requested_by,
        "query": query,
        "representation": "memory-page",
        "searchIndex": "sqlite-fts5-disposable",
        "results": results.into_iter().map(|(page, lexical, fts_rank)| json!({
            "memoryPage": {
                "id": page.id,
                "subject": page.subject,
                "title": page.title,
                "summary": page.summary,
                "content": compact_excerpt(&page.body),
                "category": page.category,
                "tags": page.tags,
                "horizon": page.horizon,
                "sensitivity": page.sensitivity,
                "revision": page.revision,
                "updatedAt": page.updated_at,
                "sourceRefs": page.source_refs.iter().map(|reference| json!({
                    "sourceId": reference.source_id,
                    "turnIds": reference.turn_ids,
                })).collect::<Vec<_>>()
            },
            "score": {
                "lexical": lexical,
                "ftsBm25": fts_rank,
            }
        })).collect::<Vec<_>>()
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memory_pages::write_memory_page;
    use topo_contracts::{MemoryHorizon, MemoryPageOrigin, MemoryPageSourceRef};

    fn connection() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        crate::migrate(&connection).unwrap();
        memory_pages::ensure_schema(&connection).unwrap();
        connection
    }

    fn add_source(connection: &Connection, id: &str) {
        connection
            .execute(
                "INSERT INTO sources (id, type, captured_at, created_at, sensitivity)
                 VALUES (?1, 'conversation', '2026-09-10T06:00:00Z', '2026-09-10T06:00:00Z', 'ordinary')",
                [id],
            )
            .unwrap();
    }

    fn page(id: &str, title: &str, body: &str) -> MemoryPage {
        MemoryPage {
            id: id.to_owned(),
            subject: "project:rack".to_owned(),
            title: title.to_owned(),
            summary: None,
            body: body.to_owned(),
            category: Some("architecture".to_owned()),
            tags: vec!["rack".to_owned()],
            status: MemoryPageStatus::Confirmed,
            sensitivity: Sensitivity::Ordinary,
            horizon: MemoryHorizon::Project,
            origin: MemoryPageOrigin::Extracted,
            source_refs: vec![MemoryPageSourceRef {
                source_id: format!("source-{id}"),
                evidence: Some("user evidence".to_owned()),
                turn_ids: Some(vec!["u1".to_owned()]),
            }],
            annotation_ids: vec![],
            valid_from: None,
            valid_until: None,
            supersedes: vec![],
            revision: 1,
            created_at: "2026-09-10T06:00:00Z".to_owned(),
            updated_at: "2026-09-10T06:00:00Z".to_owned(),
        }
    }

    fn store_page(connection: &Connection, page: &MemoryPage) {
        add_source(connection, &page.source_refs[0].source_id);
        write_memory_page(connection, page).unwrap();
    }

    #[test]
    fn search_returns_confirmed_memory_pages_with_compact_provenance() {
        let connection = connection();
        store_page(
            &connection,
            &page(
                "testing",
                "Integration testing",
                "RACK should test the TOPO context boundary with integration tests.",
            ),
        );

        let result = search_memory_pages(&connection, "integration tests", "rack", None, 20).unwrap();
        assert_eq!(result["representation"], "memory-page");
        assert_eq!(result["results"][0]["memoryPage"]["id"], "testing");
        assert_eq!(result["results"][0]["memoryPage"]["sourceRefs"][0]["sourceId"], "source-testing");
    }

    #[test]
    fn strongest_restricted_match_never_enters_search_results() {
        let connection = connection();
        let mut restricted = page(
            "restricted",
            "Secret deployment credential",
            "The deployment credential is restricted.",
        );
        restricted.sensitivity = Sensitivity::Restricted;
        store_page(&connection, &restricted);
        store_page(
            &connection,
            &page(
                "ordinary",
                "Deployment overview",
                "The public deployment overview describes the architecture.",
            ),
        );

        let result = search_memory_pages(
            &connection,
            "deployment credential architecture",
            "rack",
            None,
            20,
        )
        .unwrap();
        let ids = result["results"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|value| value["memoryPage"]["id"].as_str())
            .collect::<Vec<_>>();
        assert!(ids.contains(&"ordinary"));
        assert!(!ids.contains(&"restricted"));
    }

    #[test]
    fn expired_pages_do_not_surface() {
        let connection = connection();
        let mut expired = page("expired", "Testing history", "Integration testing notes.");
        expired.valid_until = Some("2026-09-01T00:00:00Z".to_owned());
        store_page(&connection, &expired);

        let result = search_memory_pages(&connection, "testing", "rack", None, 20).unwrap();
        assert_eq!(result["results"], json!([]));
    }

    #[test]
    fn category_filter_is_applied_before_ranking() {
        let connection = connection();
        let architecture = page("architecture", "Testing architecture", "Testing architecture.");
        store_page(&connection, &architecture);
        let mut writing = page("writing", "Testing writing", "Testing writing guidance.");
        writing.category = Some("writing".to_owned());
        store_page(&connection, &writing);

        let result = search_memory_pages(
            &connection,
            "testing",
            "rack",
            Some("writing"),
            20,
        )
        .unwrap();
        assert_eq!(result["results"].as_array().unwrap().len(), 1);
        assert_eq!(result["results"][0]["memoryPage"]["id"], "writing");
    }

    #[test]
    fn porter_stemming_supports_related_word_forms() {
        let connection = connection();
        store_page(
            &connection,
            &page("tests", "Release quality", "Integration tests exercise boundaries."),
        );

        let result = search_memory_pages(&connection, "testing", "rack", None, 20).unwrap();
        assert_eq!(result["results"][0]["memoryPage"]["id"], "tests");
        assert!(result["results"][0]["score"]["ftsBm25"].is_number());
    }
}
