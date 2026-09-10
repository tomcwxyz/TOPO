use rusqlite::{params, Connection};
use std::collections::{BTreeMap, BTreeSet};

use crate::error_text;

const MEMORY_PAGE_INDEX_SCHEMA_VERSION: i64 = 1;

pub fn ensure_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS memory_page_index_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            ) STRICT;",
        )
        .map_err(error_text)?;

    let version: i64 = connection
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM memory_page_index_migrations",
            [],
            |row| row.get(0),
        )
        .map_err(error_text)?;
    if version >= MEMORY_PAGE_INDEX_SCHEMA_VERSION {
        return Ok(());
    }

    let tx = connection.unchecked_transaction().map_err(error_text)?;
    tx.execute_batch(
        "CREATE VIRTUAL TABLE IF NOT EXISTS memory_pages_fts USING fts5(
            memory_id UNINDEXED,
            subject UNINDEXED,
            title,
            summary,
            body,
            category,
            tags,
            tokenize = 'porter unicode61'
        );

        CREATE TRIGGER IF NOT EXISTS memory_pages_fts_after_insert
        AFTER INSERT ON memory_pages BEGIN
            INSERT INTO memory_pages_fts(memory_id, subject, title, summary, body, category, tags)
            VALUES (
                new.id,
                new.subject,
                new.title,
                COALESCE(new.summary, ''),
                new.body,
                COALESCE(new.category, ''),
                new.tags_json
            );
        END;

        CREATE TRIGGER IF NOT EXISTS memory_pages_fts_after_update
        AFTER UPDATE ON memory_pages BEGIN
            DELETE FROM memory_pages_fts WHERE memory_id = old.id;
            INSERT INTO memory_pages_fts(memory_id, subject, title, summary, body, category, tags)
            VALUES (
                new.id,
                new.subject,
                new.title,
                COALESCE(new.summary, ''),
                new.body,
                COALESCE(new.category, ''),
                new.tags_json
            );
        END;

        CREATE TRIGGER IF NOT EXISTS memory_pages_fts_after_delete
        AFTER DELETE ON memory_pages BEGIN
            DELETE FROM memory_pages_fts WHERE memory_id = old.id;
        END;",
    )
    .map_err(error_text)?;

    rebuild_in(&tx)?;
    tx.execute(
        "INSERT OR IGNORE INTO memory_page_index_migrations (version, applied_at)
         VALUES (?1, datetime('now'))",
        [MEMORY_PAGE_INDEX_SCHEMA_VERSION],
    )
    .map_err(error_text)?;
    tx.commit().map_err(error_text)?;
    Ok(())
}

fn rebuild_in(connection: &Connection) -> Result<(), String> {
    connection
        .execute("DELETE FROM memory_pages_fts", [])
        .map_err(error_text)?;
    connection
        .execute(
            "INSERT INTO memory_pages_fts(memory_id, subject, title, summary, body, category, tags)
             SELECT id, subject, title, COALESCE(summary, ''), body,
                    COALESCE(category, ''), tags_json
             FROM memory_pages",
            [],
        )
        .map_err(error_text)?;
    Ok(())
}

/// Rebuild the search projection entirely from canonical Memory Pages.
/// The FTS table carries no durable state and may be discarded safely.
pub fn rebuild(connection: &Connection) -> Result<(), String> {
    ensure_schema(connection)?;
    rebuild_in(connection)
}

fn fts_query(terms: &BTreeSet<String>) -> Option<String> {
    let quoted = terms
        .iter()
        .map(|term| term.trim())
        .filter(|term| !term.is_empty())
        .map(|term| format!("\"{}\"", term.replace('"', "\"\"")))
        .collect::<Vec<_>>();
    (!quoted.is_empty()).then(|| quoted.join(" OR "))
}

/// Return FTS5 BM25 scores for page ids matching the supplied, already-normalised
/// purpose/query terms. Lower BM25 scores are better. Callers must intersect these
/// results with their governance-eligible page set; search relevance is never access.
pub fn scores_for_terms(
    connection: &Connection,
    terms: &BTreeSet<String>,
) -> Result<BTreeMap<String, f64>, String> {
    ensure_schema(connection)?;
    let Some(query) = fts_query(terms) else {
        return Ok(BTreeMap::new());
    };

    let mut statement = connection
        .prepare(
            "SELECT memory_id, bm25(memory_pages_fts, 0.0, 0.0, 8.0, 3.0, 2.0, 5.0, 4.0) AS rank
             FROM memory_pages_fts
             WHERE memory_pages_fts MATCH ?1
             ORDER BY rank ASC",
        )
        .map_err(error_text)?;
    let rows = statement
        .query_map(params![query], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?))
        })
        .map_err(error_text)?;

    rows.collect::<Result<BTreeMap<_, _>, _>>().map_err(error_text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memory_pages::{self, write_memory_page};
    use topo_contracts::{
        MemoryHorizon, MemoryPage, MemoryPageOrigin, MemoryPageSourceRef, MemoryPageStatus,
        Sensitivity,
    };

    fn connection() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        crate::migrate(&connection).unwrap();
        memory_pages::ensure_schema(&connection).unwrap();
        ensure_schema(&connection).unwrap();
        connection
    }

    fn add_source(connection: &Connection) {
        connection
            .execute(
                "INSERT INTO sources (id, type, captured_at, created_at, sensitivity)
                 VALUES ('source-index', 'conversation', '2026-09-10T06:00:00Z',
                         '2026-09-10T06:00:00Z', 'ordinary')",
                [],
            )
            .unwrap();
    }

    fn page(body: &str) -> MemoryPage {
        MemoryPage {
            id: "memory-index".to_owned(),
            subject: "project:rack".to_owned(),
            title: "Testing the context boundary".to_owned(),
            summary: Some("Integration testing for RACK and TOPO.".to_owned()),
            body: body.to_owned(),
            category: Some("architecture".to_owned()),
            tags: vec!["rack".to_owned(), "testing".to_owned()],
            status: MemoryPageStatus::Confirmed,
            sensitivity: Sensitivity::Ordinary,
            horizon: MemoryHorizon::Project,
            origin: MemoryPageOrigin::Extracted,
            source_refs: vec![MemoryPageSourceRef {
                source_id: "source-index".to_owned(),
                evidence: Some("test the context boundary".to_owned()),
                turn_ids: Some(vec!["u1".to_owned()]),
            }],
            annotation_ids: vec![],
            valid_from: None,
            valid_until: None,
            supersedes: vec![],
            revision: 1,
            created_at: "2026-09-10T06:01:00Z".to_owned(),
            updated_at: "2026-09-10T06:01:00Z".to_owned(),
        }
    }

    #[test]
    fn writes_and_updates_are_reflected_by_the_projection() {
        let connection = connection();
        add_source(&connection);
        let mut stored = page("Integration tests should exercise changed boundaries.");
        write_memory_page(&connection, &stored).unwrap();

        let terms = BTreeSet::from(["integration".to_owned()]);
        assert!(scores_for_terms(&connection, &terms)
            .unwrap()
            .contains_key(&stored.id));

        stored.body = "Accessibility checks belong in the release path.".to_owned();
        stored.summary = None;
        stored.tags = vec!["accessibility".to_owned()];
        stored.revision += 1;
        write_memory_page(&connection, &stored).unwrap();

        assert!(!scores_for_terms(&connection, &terms)
            .unwrap()
            .contains_key(&stored.id));
        assert!(scores_for_terms(
            &connection,
            &BTreeSet::from(["accessibility".to_owned()])
        )
        .unwrap()
        .contains_key(&stored.id));
    }

    #[test]
    fn projection_can_be_deleted_and_rebuilt_from_canonical_pages() {
        let connection = connection();
        add_source(&connection);
        let stored = page("Integration tests should exercise changed boundaries.");
        write_memory_page(&connection, &stored).unwrap();

        connection.execute("DELETE FROM memory_pages_fts", []).unwrap();
        let terms = BTreeSet::from(["integration".to_owned()]);
        assert!(scores_for_terms(&connection, &terms).unwrap().is_empty());

        rebuild(&connection).unwrap();
        assert!(scores_for_terms(&connection, &terms)
            .unwrap()
            .contains_key(&stored.id));
        assert_eq!(memory_pages::all_memory_pages(&connection).unwrap().len(), 1);
    }

    #[test]
    fn porter_tokenisation_matches_related_word_forms() {
        let connection = connection();
        add_source(&connection);
        let stored = page("Integration tests should exercise changed boundaries.");
        write_memory_page(&connection, &stored).unwrap();

        let scores = scores_for_terms(
            &connection,
            &BTreeSet::from(["testing".to_owned()]),
        )
        .unwrap();
        assert!(scores.contains_key(&stored.id));
    }
}
