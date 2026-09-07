# TOPO capture evaluation

TOPO should optimise for **a small number of genuinely useful memories**, not maximum extraction volume.

The alpha evaluation loop therefore measures the complete product path:

```text
known conversation
      ↓
expected useful memories
      ↓
TOPO extraction
      ↓
candidates shown
      ↓
human review
      ↓
accepted memory
      ↓
purpose-bound recall
```

## Core metrics

For each labelled conversation or daily-use sample record:

- `expectedKeys` — the memories a human believes would materially improve a future interaction;
- `proposedKeys` — the distinct keys TOPO actually proposed;
- `acceptedKeys` — the distinct keys the reviewer kept;
- `candidatesShown` — total candidate cards shown to the reviewer, including duplicates;
- `duplicateCandidates` — candidate cards that should have been absorbed as duplicates/supporting evidence;
- `reviewSeconds` — active review time for the sample.

The scorer reports:

- **precision** — expected proposals / all distinct proposals;
- **recall** — expected proposals found / expected memories;
- **memory yield** — accepted memories / distinct proposals;
- **overreach rate** — proposals that were not expected / all proposals;
- **duplicate rate** — duplicate candidate cards / candidate cards shown;
- **review seconds per accepted memory** — governance effort, rather than raw processing speed.

Run the deterministic scorer with:

```text
npm run test:capture-eval
```

The scoring script itself is `scripts/score-capture-eval.mjs`. It can also score a labelled JSON result file during development or a dogfood review.

## Alpha targets

These are product targets, not claims that the current extractor already meets them:

| Metric | Initial target |
| --- | ---: |
| Precision | ≥ 0.80 |
| Recall | ≥ 0.70 |
| Memory yield | ≥ 0.70 |
| Overreach | ≤ 0.20 |
| Duplicate rate | ≤ 0.10 |
| Review time | ≤ 20 seconds per accepted memory |

A clean conversation where nothing should be remembered is a successful result when TOPO proposes nothing.

## Daily-use test

At least once per dogfood day:

1. use supported AI tools normally;
2. record obvious capture misses or selector failures;
3. label a small sample of conversations with the memories that were actually worth keeping;
4. process captures locally;
5. review the inbox without changing the expected labels to fit TOPO's output;
6. record accepted/rejected/duplicate candidates and review time;
7. score the sample;
8. later request purpose-bound context for a real task and record whether the accepted memory was recalled correctly.

Do not tune solely against one user's wording or one provider. Keep a mixed fixture set covering:

- explicit durable preferences;
- project decisions and constraints;
- temporary circumstances that should expire;
- changed/superseding information;
- questions that should **not** become personal facts;
- assistant statements that are not user evidence;
- conversations containing no worthwhile memory;
- sensitive material that should be omitted or correctly classified.

## Release principle

Adding more providers, embeddings or automatic confirmation is lower priority than improving these numbers and reducing review effort.

The practical alpha exit remains:

> Use AI normally for a day, open TOPO, review a short high-quality inbox in a few minutes, and see confirmed context surface correctly in another tool.
