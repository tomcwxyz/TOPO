use rusqlite::Connection;
use serde::Deserialize;
use serde_json::Value;
use topo_contracts::{
    MemoryHorizon, MemoryPage, MemoryPageOrigin, MemoryPageSourceRef, MemoryPageStatus, Sensitivity,
};

use crate::{context_pages, memory_pages};

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
    crate::migrate(&connection).expect("core schema");
    memory_pages::ensure_schema(&connection).expect("memory page schema");

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
        .expect("every fixture has at least one current confirmed Memory Page");

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
            if let Some(index) = selected
                .iter()
                .position(|id| case.expected_ids.contains(id))
            {
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

    // Governance is a hard invariant, not a ranking metric.
    assert_eq!(score.forbidden_disclosures, 0);

    // The deterministic resolver should fully solve the lexical/FTS-labelled cases.
    // Semantic challenge cases are measured separately and are allowed to expose a
    // baseline gap; improving them is the evidence gate for optional M5 embeddings.
    assert_eq!(score.non_semantic_recall(), 1.0);
    assert!(score.recall() >= 0.80);
    assert!(score.mean_reciprocal_rank() >= 0.80);
    assert!(score.average_context_chars() < 12_000.0);
}
