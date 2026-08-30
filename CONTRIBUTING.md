# Contributing to TOPO

TOPO is currently in an early architecture and implementation phase.

## Working rules

- Keep the domain model independent of UI, transport and storage.
- Prefer explicit, testable lifecycle rules over implicit AI behaviour.
- Do not introduce a cloud/account dependency into the core path.
- Preserve provenance across extraction, import, transformation and export.
- Treat changes to authority, privacy, source-of-truth or portability semantics as ADR-worthy.
- Machine-originated durable memory is proposal-first unless an explicit higher-trust permission says otherwise.
- Generated documents are projections over claims, not a second source of truth.

## Changes

Use focused branches and pull requests. Include tests for domain/lifecycle behaviour.

Commit messages should use a simple conventional form where practical, for example:

- `feat: add claim proposal lifecycle`
- `fix: preserve source provenance on import`
- `docs: record context resolution decision`
- `test: cover claim supersession`

## Definition of done

A change is not complete if it changes the stored model or portable format without:

- validation;
- migration/version handling where needed;
- tests;
- documentation of user-visible semantics.

Security-sensitive features should include misuse/failure-path tests, not only happy-path coverage.
