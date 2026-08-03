---
name: deliver-dondok-feature
description: Implement, change, fix, or review a Dondok product feature across PostgreSQL, Spring Boot/JPA, React/TanStack Query, shared-session concurrency, UX, and QC. Use for membership, assets, income/expense/transfer, categories, card settlement, statistics, ledger deletion, concurrency, API contract, or deployment work in the Dondok repository. Do not use for general questions or design-only discussion that does not change the product.
---

# Deliver Dondok Feature

Deliver the smallest complete vertical slice without losing the shared-ledger invariants.

## 1. Establish context

1. Read `docs/project-context.md` completely.
2. Read `docs/product/open-decisions.md` and stop to ask the user when an affected `OPEN` question has reached its decision deadline. Ask no more than three at once and never treat a recommendation as approval.
3. Read only the affected detailed documents under `docs/architecture`, `docs/design`, `docs/quality`, or `docs/operations`.
4. Inspect the current worktree and preserve unrelated user changes.
5. If application development has not started, stop at contracts and harness preparation unless the user explicitly authorizes scaffolding.

Do not reopen a recorded `D-*` decision. Ask only when an unresolved choice changes stored data, public API behavior, security, destructive behavior, or deployment exposure.

## 2. Map the vertical slice

Read [`references/change-matrix.md`](references/change-matrix.md) and list the affected layers. For each affected boundary, name the source of truth:

- data and invariants: migration plus database design
- commands and responses: OpenAPI plus stable ProblemDetail `errorCode`
- client consistency: aggregate/version, writer cache invalidation target and other-session refetch boundary
- UI: loading, empty, error, offline, conflict and remote-delete states
- tests: lowest layer that proves the rule, plus E2E only for critical user flows

Avoid speculative abstractions. Add a pattern only when it isolates a known variation or protects an invariant.

## 3. Set contracts before implementation

When persistence or external behavior changes:

1. Design a forward-only Flyway migration and rollback/recovery approach.
2. Define request, response, validation boundary, idempotency and concurrency semantics.
3. Define the writer's cache update/invalidation and other-session refetch behavior after command concurrency semantics are clear.
4. Confirm the UX result with existing design tokens and accessibility rules.

Keep money as integer won and activity date as date-only. Keep creator, updater and performer distinct. Treat asset owner as metadata, never authorization.

Prefer one clear command and its authoritative response. Do not add a preview endpoint, approval step, validation, status, or configuration solely because it might be useful later. Add one only when an existing confirmed requirement or invariant cannot be satisfied without it. Reuse existing read models for confirmation screens when they already provide the needed facts.

## 4. Choose tests by risk

Require automated tests for:

- posting balance effects and statistics inclusion/exclusion
- membership and ledger data boundaries
- category fallback, asset archive and ledger deletion
- card purchase, statement/settlement and insufficient-balance policy
- optimistic lock, idempotency, uniqueness and race-prone workflows
- authentication/session and data exposure boundaries
- every reproduced bug before its fix

Prefer unit tests for policies, integration tests for JPA/PostgreSQL and HTTP contracts, and Playwright for high-value user journeys and shared-session conflicts. Do not write tests for trivial accessors, framework defaults, or the same rule at every layer without added confidence.

## 5. Implement and synchronize

Implement one usable slice across all affected layers. Keep REST command results authoritative; update or invalidate the writer's TanStack Query data from the response, and let other sessions refetch on route entry, window focus, or user refresh. Preserve a user's draft on failed mutation, version conflict, or remote deletion. Use accessible roles and labels so QC can test user outcomes.

When multiple agents contribute, reuse the stable PM, Database, Frontend, Backend, QC, and UX/UI roles instead of creating per-question agents. Share contract changes before parallel edits, assign a single owner per file, and re-read changed shared files before editing.

## 6. Verify with evidence

1. Run `bash .agents/skills/deliver-dondok-feature/scripts/verify-harness.sh`.
2. Run the affected backend tests and build when `backend/` exists.
3. Run frontend typecheck, lint, tests and build when `frontend/` exists.
4. Run targeted Playwright tests when a browser flow exists.
5. For concurrency work, exercise at least two member sessions, prove stale version rejection, and correlate request ID through HTTP, backend and DB/audit.

Read exit codes and failure counts. Do not infer success from partial checks.

## 7. Handoff

Report the user-visible result first, followed by contract or migration changes, verification evidence and any remaining risk. Update `docs/project-context.md` only for durable product decisions; update the relevant detailed document for implementation rules. QC failures must follow `docs/quality/qc-strategy.md`.
