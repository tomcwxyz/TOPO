# TOPO capture evaluation

TOPO should optimise for **a small number of genuinely useful memories**, not maximum extraction volume.

The page-first architecture changes the unit of evaluation from extracted keys/claims to coherent memories that improve later work.

The alpha evaluation loop therefore measures the complete product path:

```text
known source interaction
      ↓
expected useful memories
      ↓
TOPO Memory Page proposals
      ↓
human review/edit
      ↓
confirmed portable memory
      ↓
purpose-bound recall
      ↓
useful context in another tool/model
```

## Core metrics

For each labelled conversation or daily-use sample record:

- `expectedMemories` — the pieces of context a human believes would materially improve a future interaction;
- `proposedMemories` — distinct Memory Pages TOPO proposed;
- `acceptedMemories` — pages the reviewer kept after any edits/merges;
- `reviewSeconds` — active review time;
- `duplicateOrFragmented` — candidates that should have been absorbed into another page or expressed as one coherent memory;
- `unsupportedMemories` — proposals not adequately supported by source evidence;
- `laterRecallExpected` — memories that should be selected for a labelled future task;
- `laterRecallReturned` — memories/context actually returned for that task.

The scorer should report or make it possible to assess:

- **useful-memory precision** — expected/useful proposals divided by all distinct proposals;
- **useful-memory recall** — expected memories found divided by expected memories;
- **memory yield** — accepted memories divided by proposed memories;
- **overreach rate** — unsupported or unwarranted proposals divided by all proposals;
- **fragmentation rate** — proposals that should have been merged into a coherent memory;
- **duplicate rate** — repeated candidates that add no useful new meaning;
- **faithfulness** — accepted/proposed prose is supported by cited evidence;
- **contextual completeness** — the memory preserves enough surrounding meaning to be useful later without reopening the full source;
- **temporal correctness** — temporary, changed and superseded context is represented correctly;
- **review seconds per accepted memory** — governance effort;
- **cross-tool recall precision/recall** — the right memories are returned for a future purpose/task;
- **portable round-trip integrity** — Markdown export/import preserves meaning, governance and evidence links;
- **context efficiency** — useful resolved context per token/character budget.

A clean interaction where nothing should be remembered is a successful result when TOPO proposes nothing.

## Review-time measurement

The desktop alpha records review effort on the Memory Page confirm/reject event rather than as a separate analytics stream.

`reviewDurationMs` is measured with method `desktop-active-panel-v1`:

- timing accrues only while the Memory Page panel is hovered or keyboard-focused;
- timing pauses when the app becomes hidden or focus/pointer activity leaves the panel;
- editing a candidate counts as review effort because it is part of governing the proposed memory;
- backend write/refresh time is excluded;
- the accumulated duration resets only after a successful review decision, so a failed local write does not discard the measurement;
- bulk review apportions the active duration across the reviewed pages so review-event data can be aggregated.

This is deliberately local product instrumentation, not telemetry. It stays in TOPO's local event history and is intended to test the product claim that a normal day's inbox can be governed in a few minutes.

## Qualitative scoring

Some page-first qualities are not well represented by key matching alone. Labelled fixtures should therefore include small human judgements, for example:

### Faithfulness

- `2` — clearly supported by source evidence;
- `1` — mostly supported but phrasing adds interpretation;
- `0` — unsupported, misleading or invented.

### Contextual completeness

- `2` — enough context to guide a later interaction correctly;
- `1` — broadly right but missing an important qualifier/rationale/boundary;
- `0` — atomised or ambiguous enough to mislead later use.

### Portability

- `2` — understandable and useful as standalone Markdown;
- `1` — understandable but depends on TOPO-specific field knowledge;
- `0` — meaning is not recoverable outside the internal model.

The aim is not to maximise prose length. A concise memory can score highly if it preserves the right context.

## Initial targets

These are product targets, not claims that the current page-first extractor already meets them:

| Metric | Initial target |
| --- | ---: |
| Useful-memory precision | ≥ 0.80 |
| Useful-memory recall | ≥ 0.70 |
| Memory yield | ≥ 0.70 |
| Overreach | ≤ 0.20 |
| Duplicate + fragmentation | ≤ 0.15 |
| Review time | ≤ 30 seconds per accepted memory |
| Faithfulness average | ≥ 1.8 / 2 |
| Contextual completeness average | ≥ 1.6 / 2 |
| Portable round-trip integrity | 100% metadata/evidence identity preservation |

These targets should be calibrated against real dogfooding rather than treated as permanent benchmarks.

## Migration comparison

During the transition, run the same source samples through the existing claim-based extractor and the new page-first extractor.

Compare:

- number of review objects generated;
- review time;
- accepted useful information;
- lost qualifiers/context;
- later recall quality;
- token size of resolved context.

The page-first approach should not be accepted merely because it feels nicer. It should demonstrate lower review burden and equal or better later usefulness.

## Daily-use test

At least once per dogfood day:

1. use supported AI tools normally;
2. record obvious capture misses or selector failures;
3. label a small sample of conversations with the memories actually worth keeping;
4. process captures locally;
5. review the inbox without changing expected labels to fit TOPO's output;
6. record accepted/rejected/merged candidates and review time;
7. inspect source faithfulness and contextual completeness;
8. export/import at least a small sample during migration;
9. later request purpose-bound context for a real task;
10. record whether the correct memory was recalled and whether it improved the interaction.

Do not tune solely against one user's wording or one provider. Keep a mixed fixture set covering:

- explicit durable preferences;
- project decisions and their rationale/boundaries;
- temporary circumstances that should expire;
- changed/superseding information;
- questions that should **not** become personal facts;
- assistant statements that are not user evidence;
- nuanced context that would be damaged by atomisation;
- interactions containing no worthwhile memory;
- sensitive material that should be omitted or correctly classified;
- two memories with similar vocabulary but different purposes;
- one memory that should be useful across several different AI systems.

## Release principle

Adding more providers, a larger ontology, a vector database or automatic confirmation is lower priority than proving that page-first memory improves real recall while reducing review effort.

The practical alpha exit becomes:

> Use AI normally for a day, review a small high-quality set of coherent memories in a few minutes, export them in a form that still makes sense outside TOPO, and see the right context surface correctly in a different tool or model.
