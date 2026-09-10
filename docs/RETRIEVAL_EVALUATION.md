# TOPO retrieval evaluation

TOPO should add retrieval mechanism only when it measurably improves useful recall.

M4 deliberately uses a small deterministic stack: governance filtering first, then lexical relevance, local SQLite FTS5, recency/revision tie-breaking and an explicit context budget. M5 semantic embeddings are **not** the automatic next step.

The question is:

> Does the current deterministic resolver return the right governed Memory Pages for real future tasks, and where does vocabulary mismatch genuinely cause useful memory to be missed?

## What is measured

The labelled fixture set is `apps/desktop/src-tauri/fixtures/retrieval-evaluation.json`.

Each case contains:

- canonical Memory Pages;
- a subject;
- a purpose and optional query;
- the pages that should be returned;
- pages that must never be returned;
- a context-item budget;
- whether the case is deliberately testing a semantic/vocabulary gap.

The scorer runs the actual Memory Page Context resolver and reports:

- required-page recall;
- recall for ordinary lexical/FTS cases;
- recall for semantic-challenge cases;
- mean reciprocal rank (MRR);
- forbidden disclosures;
- average resolved context characters.

## Hard invariants

These are not optimisation metrics:

1. **Forbidden disclosures must be zero.** A stronger relevance match can never widen sensitivity, review-state, temporal or subject access.
2. **Canonical memory must not depend on the index.** The FTS projection may be deleted and rebuilt without changing Memory Pages.
3. **Context remains bounded.** Retrieval quality cannot be improved by simply returning everything.

A future semantic index must pass exactly the same governance set before its scores are considered.

## Initial deterministic gate

The first synthetic fixture set requires:

- `100%` recall on non-semantic lexical/FTS cases;
- at least `80%` overall required-page recall;
- MRR of at least `0.80`;
- zero forbidden disclosures;
- average context below the resolver's `12,000` character ceiling.

The set intentionally includes a vocabulary-gap example: a page that says a local project works **without a network connection** is requested using the phrase **offline-first**. This is useful because it gives semantic retrieval something real to improve rather than designing a benchmark that FTS already aces.

These thresholds are regression guards, not product claims. The fixture set should grow from dogfooding.

## M5 decision rule

Do **not** implement embeddings merely because semantic retrieval is fashionable or theoretically better.

Add an M5 experiment only when all of the following are true:

- real dogfooding produces repeated misses where the correct Memory Page is present and governed but vocabulary differs materially;
- the misses cannot be solved cleanly through page quality, titles/tags, stemming, purpose wording or deterministic ranking;
- a labelled fixture can reproduce the failure;
- a local semantic approach improves recall/rank on those cases without increasing forbidden disclosures or materially worsening context efficiency;
- the semantic index remains fully disposable and rebuildable from canonical Memory Pages.

If FTS + good Memory Pages is good enough, M5 should remain unbuilt.

## Growing the benchmark

When retrieval fails in actual use:

1. preserve the relevant Memory Pages as a sanitised fixture;
2. record the real purpose/query without rewriting it to help TOPO;
3. label expected and forbidden page IDs;
4. run the deterministic baseline;
5. only then test a candidate retrieval change;
6. keep the case even after it is fixed, so it becomes a regression test.

Prioritise cases involving:

- similar vocabulary but different purposes;
- project boundaries and exceptions;
- rationale expressed differently from the later request;
- temporary or superseded context;
- privacy/sensitivity conflicts where the strongest text match is forbidden;
- concise pages that should beat larger but noisier pages;
- cross-tool phrasing differences between ChatGPT, Claude, RACK and agents.

## Relationship to capture evaluation

`CAPTURE_EVALUATION.md` asks whether TOPO creates memories worth keeping. This benchmark asks whether TOPO can retrieve the right confirmed memories later.

Both must work. Better retrieval cannot compensate for poor memory capture, and better capture is not useful if relevant context cannot surface at the right time.
