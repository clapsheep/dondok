# Change impact matrix

Use the smallest applicable row set. A checked layer needs either a change or an explicit no-change conclusion.

| Domain | Database | Backend/API | Frontend/UX | Client refresh/shared-session | Minimum proof |
|---|---|---|---|---|---|
| Signup/session | user identity, uniqueness | auth boundary, ProblemDetail | form, session expiry | usually none | API integration + critical E2E |
| Invite/membership | invite/member constraints and lock | accept/decline idempotency | no-ledger and N-member states | writer member/list invalidation, focus refetch | race integration + multi-user E2E |
| Asset | asset/detail/owner marker | strategy, limit and archive policy | conditional form, balance and conflict draft | asset/balance invalidation, version conflict | policy unit + PostgreSQL integration |
| Transaction | transaction/posting integrity | command factory and posting policy | draft preservation and performer | transaction/balance/stat invalidation, version conflict | posting integration + primary E2E |
| Category | fallback uniqueness and reassignment | single transaction with lock | delete consequence copy | category/transaction invalidation | reassignment integration |
| Card | card detail, statement/settlement | closing and settlement policy | due/paid/stat-excluded labels | card/balance/stat invalidation | fixed-clock integration + E2E |
| Statistics | query indexes and grouping | bounded read model/filter contract | 공동 전체 default and filters | statistics invalidation/refetch | SQL plan/aggregation test |
| Ledger deletion | cascade boundary | destructive confirmation | typed confirmation and exit | next read 404 clears cache | isolated deletion smoke test |
| Deployment | volume/migration ownership | health/readiness | static health/fallback | same-origin API proxy | clean Compose boot + restore smoke |

## Risk scale

- High: money postings, destructive deletion, authentication/data boundary, card settlement, concurrency and migrations. Require regression/integration evidence and relevant E2E.
- Medium: API shape, cache invalidation, forms and filters. Require contract/component tests and one representative flow.
- Low: copy, spacing and non-semantic styling. Require lint/build and visual/accessibility inspection; do not add redundant business tests.

## Contract change questions

Before implementation, answer:

1. Does stored data or a constraint change?
2. Does an HTTP status, field or stable error code change?
3. Which aggregate version and query keys become stale?
4. What happens if another member changes or deletes it mid-edit?
5. What is the smallest automated proof that would fail on regression?
