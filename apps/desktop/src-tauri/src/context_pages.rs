use chrono::{DateTime, Utc};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};
use topo_contracts::{MemoryPage, MemoryPageStatus, Sensitivity};
use uuid::Uuid;

use crate::memory_pages;
#[path = "memory_page_index.rs"]
mod memory_page_index;

const PURPOSE_STOP_WORDS: &[&str] = &[
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how", "in", "is",
    "it", "of", "on", "or", "please", "should", "that", "the", "this", "to", "what", "with",
];

const MAX_CONTEXT_CHARS: usize = 12_000;
const MAX_PAGE_EXCERPT_CHARS: usize = 2_400;
const MIN_USEFUL_REMAINDER: usize = 160;

type PageRelevance = (u32, Vec<&'static str>);
type RankedPage = (MemoryPage, PageRelevance, Option<f64>);

#[derive(Debug)]
pub struct PageContextResolution {
    pub packet: Value,
    pub selected_ids: Vec<String>,
}

fn lexical_terms(value: &str) -> BTreeSet<String> {
    value
        .to_lowercase()
        .split(|character: char| !character.is_alphanumeric())
        .map(str::trim)
        .filter(|term| term.len() > 1 && !PURPOSE_STOP_WORDS.contains(term))
        .map(str::to_owned)
        .collect()
}

fn context_terms(purpose: &str, query: Option<&str>) -> BTreeSet<String> {
    let mut terms = lexical_terms(purpose);
    if let Some(query) = query {
        terms.extend(lexical_terms(query));
    }
    terms
}

fn page_relevance(page: &MemoryPage, terms: &BTreeSet<String>) -> PageRelevance {
    if terms.is_empty() {
        return (0, Vec::new());
    }

    let title = lexical_terms(&page.title);
    let category = lexical_terms(page.category.as_deref().unwrap_or_default());
    let tags = lexical_terms(&page.tags.join(" "));
    let summary = lexical_terms(page.summary.as_deref().unwrap_or_default());
    let body = lexical_terms(&page.body);

    let mut score = 0;
    let mut fields = BTreeSet::new();
    for term in terms {
        if title.contains(term) {
            score += 8;
            fields.insert("title");
        }
        if category.contains(term) {
            score += 5;
            fields.insert("category");
        }
        if tags.contains(term) {
            score += 4;
            fields.insert("tags");
        }
        if summary.contains(term) {
            score += 3;
            fields.insert("summary");
        }
        if body.contains(term) {
            score += 2;
            fields.insert("body");
        }
    }

    (score, fields.into_iter().collect())
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

fn sensitivity_allowed(page: &MemoryPage, include_sensitive: bool) -> bool {
    matches!(page.sensitivity, Sensitivity::Ordinary | Sensitivity::Personal) || include_sensitive
}

fn compact_excerpt(value: &str, max_chars: usize) -> String {
    let value = value.trim();
    if value.chars().count() <= max_chars {
        return value.to_owned();
    }
    if max_chars <= 1 {
        return "…".to_owned();
    }

    let mut excerpt = value.chars().take(max_chars - 1).collect::<String>();
    if let Some(boundary) = excerpt.rfind(['.', '!', '?', '\n']) {
        if boundary >= max_chars / 2 {
            excerpt.truncate(boundary + 1);
            return excerpt.trim().to_owned();
        }
    }
    while excerpt.ends_with(char::is_whitespace) {
        excerpt.pop();
    }
    format!("{}…", excerpt.trim_end())
}

fn page_cost(page: &MemoryPage, excerpt: &str) -> usize {
    page.title.chars().count()
        + page.summary.as_deref().unwrap_or_default().chars().count()
        + page.category.as_deref().unwrap_or_default().chars().count()
        + page.tags.iter().map(|tag| tag.chars().count()).sum::<usize>()
        + excerpt.chars().count()
        + 96
}

fn compare_ranked_pages(left: &RankedPage, right: &RankedPage) -> Ordering {
    let left_has_match = left.1 .0 > 0 || left.2.is_some();
    let right_has_match = right.1 .0 > 0 || right.2.is_some();

    right_has_match
        .cmp(&left_has_match)
        .then_with(|| right.1 .0.cmp(&left.1 .0))
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

pub fn resolve_page_context(
    connection: &Connection,
    subject: &str,
    purpose: &str,
    requested_by: &str,
    query: Option<&str>,
    include_sensitive: bool,
    max_items: usize,
    channel: &str,
) -> Result<Option<PageContextResolution>, String> {
    if subject.trim().is_empty() || purpose.trim().is_empty() || requested_by.trim().is_empty() {
        return Err("Subject, purpose and requester are required.".to_owned());
    }
    if !(1..=100).contains(&max_items) {
        return Err("maxItems must be between 1 and 100.".to_owned());
    }

    memory_pages::ensure_schema(connection)?;
    let now = Utc::now();
    let all = memory_pages::all_memory_pages(connection)?;
    let confirmed_for_subject = all
        .into_iter()
        .filter(|page| page.status == MemoryPageStatus::Confirmed)
        .filter(|page| page.subject == subject)
        .filter(|page| is_current(page, &now))
        .collect::<Vec<_>>();

    // Compatibility fallback is only appropriate while a subject has no current,
    // confirmed Memory Pages. Once page memory exists, governance decisions on
    // those pages must not be bypassed by older Claim records.
    if confirmed_for_subject.is_empty() {
        return Ok(None);
    }

    let terms = context_terms(purpose, query);
    // FTS is only a ranking signal. We deliberately compute the governance-eligible
    // set first and attach FTS scores by id afterwards: relevance never grants access.
    let fts_scores = memory_page_index::scores_for_terms(connection, &terms)?;
    let mut eligible = confirmed_for_subject
        .into_iter()
        .filter(|page| sensitivity_allowed(page, include_sensitive))
        .map(|page| {
            let relevance = page_relevance(&page, &terms);
            let fts_rank = fts_scores.get(&page.id).copied();
            (page, relevance, fts_rank)
        })
        .collect::<Vec<_>>();

    eligible.sort_by(compare_ranked_pages);

    let mut selected: Vec<(MemoryPage, PageRelevance, Option<f64>, String)> = Vec::new();
    let mut used_chars = 0usize;
    for (page, relevance, fts_rank) in eligible {
        if selected.len() >= max_items || used_chars >= MAX_CONTEXT_CHARS {
            break;
        }

        let remaining = MAX_CONTEXT_CHARS.saturating_sub(used_chars);
        if !selected.is_empty() && remaining < MIN_USEFUL_REMAINDER {
            break;
        }
        let excerpt_limit = remaining.min(MAX_PAGE_EXCERPT_CHARS).max(1);
        let excerpt = compact_excerpt(&page.body, excerpt_limit);
        let cost = page_cost(&page, &excerpt);
        if !selected.is_empty() && cost > remaining {
            continue;
        }
        used_chars += cost.min(remaining);
        selected.push((page, relevance, fts_rank, excerpt));
    }

    let selected_ids = selected
        .iter()
        .map(|(page, _, _, _)| page.id.clone())
        .collect::<Vec<_>>();
    let evidence_refs = selected
        .iter()
        .flat_map(|(page, _, _, _)| {
            page.source_refs
                .iter()
                .map(|reference| reference.source_id.clone())
        })
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let relevance = selected
        .iter()
        .filter(|(_, result, fts_rank, _)| result.0 > 0 || fts_rank.is_some())
        .map(|(page, result, fts_rank, _)| {
            (
                page.id.clone(),
                json!({
                    "score": result.0,
                    "fields": result.1.clone(),
                    "fts_bm25": fts_rank,
                }),
            )
        })
        .collect::<BTreeMap<_, _>>();

    let generated_at = now.to_rfc3339();
    let packet_id = format!("ctx-{}", Uuid::new_v4());
    let packet = json!({
        "specversion": "0.1-draft",
        "id": packet_id.clone(),
        "subject": subject,
        "purpose": purpose,
        "requested_by": requested_by,
        "objects": selected.iter().map(|(page, _, _, excerpt)| json!({
            "type": "topo.memory_page",
            "id": page.id,
            "value": {
                "title": page.title,
                "summary": page.summary,
                "content": excerpt,
                "category": page.category,
                "tags": page.tags,
                "horizon": page.horizon,
                "sensitivity": page.sensitivity,
                "revision": page.revision,
                "updated_at": page.updated_at,
                "source_refs": page.source_refs.iter().map(|reference| json!({
                    "source_id": reference.source_id,
                    "turn_ids": reference.turn_ids,
                })).collect::<Vec<_>>()
            }
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
            "extensions": {
                "memory_representation": "memory-page",
                "page_revisions": selected.iter().map(|(page, _, _, _)| {
                    (page.id.clone(), json!(page.revision))
                }).collect::<BTreeMap<_, _>>()
            }
        },
        "extensions": {
            "topo.channel": channel,
            "topo.representation": "memory-page",
            "topo.include_sensitive": include_sensitive,
            "topo.selection": if terms.is_empty() {
                "confirmed+subject+temporal+sensitivity+page-recency"
            } else {
                "confirmed+subject+temporal+sensitivity+page-lexical+fts5-rank-v1"
            },
            "topo.query_supplied": query.map(str::trim).is_some_and(|value| !value.is_empty()),
            "topo.relevance": relevance,
            "topo.search_index": "sqlite-fts5-disposable",
            "topo.context_budget": {
                "max_items": max_items,
                "max_chars": MAX_CONTEXT_CHARS,
                "max_page_excerpt_chars": MAX_PAGE_EXCERPT_CHARS,
                "used_chars": used_chars,
            }
        }
    });

    Ok(Some(PageContextResolution {
        packet,
        selected_ids,
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

    fn page(id: &str, title: &str, body: &str, updated_at: &str) -> MemoryPage {
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
            revision: 2,
            created_at: "2026-09-01T06:00:00Z".to_owned(),
            updated_at: updated_at.to_owned(),
        }
    }

    fn store_page(connection: &Connection, page: &MemoryPage) {
        add_source(connection, &page.source_refs[0].source_id);
        write_memory_page(connection, page).unwrap();
    }

    #[test]
    fn page_relevance_beats_newer_unrelated_memory() {
        let connection = connection();
        store_page(
            &connection,
            &page(
                "older-relevant",
                "Integration testing boundary",
                "RACK should test the TOPO context boundary with integration tests.",
                "2026-09-01T12:00:00Z",
            ),
        );
        store_page(
            &connection,
            &page(
                "newer-unrelated",
                "Writing preference",
                "Use British English for public copy.",
                "2026-09-10T12:00:00Z",
            ),
        );

        let resolved = resolve_page_context(
            &connection,
            "project:rack",
            "prepare implementation",
            "rack",
            Some("integration tests for context boundary"),
            false,
            1,
            "test",
        )
        .unwrap()
        .unwrap();

        assert_eq!(resolved.selected_ids, vec!["older-relevant"]);
        assert_eq!(resolved.packet["objects"][0]["type"], "topo.memory_page");
        assert_eq!(
            resolved.packet["extensions"]["topo.representation"],
            "memory-page"
        );
        assert_eq!(
            resolved.packet["extensions"]["topo.search_index"],
            "sqlite-fts5-disposable"
        );
    }

    #[test]
    fn fts_stemming_can_rank_a_related_word_form() {
        let connection = connection();
        let mut older = page(
            "older-testing",
            "Release quality",
            "Integration tests exercise changed boundaries.",
            "2026-09-01T12:00:00Z",
        );
        older.category = Some("quality".to_owned());
        older.tags = vec!["quality".to_owned()];
        store_page(&connection, &older);
        store_page(
            &connection,
            &page(
                "newer-unrelated",
                "Writing preference",
                "Use British English for public copy.",
                "2026-09-10T12:00:00Z",
            ),
        );

        let resolved = resolve_page_context(
            &connection,
            "project:rack",
            "testing",
            "rack",
            None,
            false,
            1,
            "test",
        )
        .unwrap()
        .unwrap();

        assert_eq!(resolved.selected_ids, vec!["older-testing"]);
        assert!(resolved.packet["extensions"]["topo.relevance"]["older-testing"]["fts_bm25"]
            .is_number());
    }

    #[test]
    fn restricted_page_is_not_disclosed_and_does_not_trigger_claim_fallback() {
        let connection = connection();
        let mut restricted = page(
            "restricted",
            "Private architecture",
            "A restricted implementation detail.",
            "2026-09-10T12:00:00Z",
        );
        restricted.sensitivity = Sensitivity::Restricted;
        store_page(&connection, &restricted);

        let resolved = resolve_page_context(
            &connection,
            "project:rack",
            "prepare implementation",
            "rack",
            None,
            false,
            20,
            "test",
        )
        .unwrap();

        assert!(resolved.is_some());
        let resolved = resolved.unwrap();
        assert!(resolved.selected_ids.is_empty());
        assert_eq!(resolved.packet["objects"], json!([]));
    }

    #[test]
    fn strongest_fts_match_cannot_widen_sensitivity_access() {
        let connection = connection();
        let mut restricted = page(
            "restricted-search-hit",
            "Secret deployment architecture",
            "The deployment architecture uses a restricted internal credential boundary.",
            "2026-09-10T12:00:00Z",
        );
        restricted.sensitivity = Sensitivity::Restricted;
        restricted.tags = vec!["deployment".to_owned(), "architecture".to_owned()];
        store_page(&connection, &restricted);
        store_page(
            &connection,
            &page(
                "ordinary-page",
                "General RACK architecture",
                "RACK has a local-first architecture.",
                "2026-09-09T12:00:00Z",
            ),
        );

        let resolved = resolve_page_context(
            &connection,
            "project:rack",
            "deployment architecture credential",
            "rack",
            None,
            false,
            20,
            "test",
        )
        .unwrap()
        .unwrap();

        assert!(!resolved.selected_ids.contains(&"restricted-search-hit".to_owned()));
        assert!(resolved.selected_ids.contains(&"ordinary-page".to_owned()));
    }

    #[test]
    fn no_confirmed_page_for_subject_allows_legacy_fallback() {
        let connection = connection();
        assert!(resolve_page_context(
            &connection,
            "project:rack",
            "prepare implementation",
            "rack",
            None,
            false,
            20,
            "test",
        )
        .unwrap()
        .is_none());
    }

    #[test]
    fn expired_pages_are_not_eligible() {
        let connection = connection();
        let mut expired = page(
            "expired-window",
            "Temporary constraint",
            "This should no longer be shared.",
            "2026-09-01T12:00:00Z",
        );
        expired.valid_until = Some("2026-09-01T12:00:00Z".to_owned());
        store_page(&connection, &expired);

        assert!(resolve_page_context(
            &connection,
            "project:rack",
            "prepare implementation",
            "rack",
            None,
            false,
            20,
            "test",
        )
        .unwrap()
        .is_none());
    }
}
