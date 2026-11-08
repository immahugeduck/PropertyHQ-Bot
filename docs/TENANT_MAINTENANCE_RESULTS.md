# Tenant and maintenance upgrade results

Plan: `docs/superpowers/plans/2026-11-08-tenant-maintenance-upgrades.md`.

Work runs in sibling PropertyHQ-Bot and PropertyHQ worktrees on `feat/tenant-maintenance-upgrades`. Base revisions: bot `d369127`, Property HQ `f5c5373`. Existing working branches and live data are untouched.

## Baseline

- Property HQ: Vitest, 7 files / 28 tests passed.
- Bot: 21 of 22 test files passed in the sandbox. The two scheduler CLI subprocess checks fail because `spawnSync` returns `EPERM` in this sandbox, even for a minimal fixture Node process. This is an environment restriction, not a demonstrated bot defect. Retry verification with subprocess execution available.
- Local database examples use PGlite and current migrations from the sibling PropertyHQ checkout.

## Checkpoints

- Upgrade 1: complete. The focused raw-text and database replay checks passed (26 tests). Full bot suite: 230 tests passed. `npm run check` passed. The original BREE wording was observed failing before the parser change. The full suite passes with local fixture subprocesses enabled; no scheduler product fix was needed.
- Upgrade 2: complete. Seven persistence/outbox examples passed, including manager context, one-reference work orders, ambiguous/repeated answer suppression, form intake, post-booking revocation and helper access restrictions. Full bot suite: 236 tests passed; Property HQ: 28 tests passed; bot syntax and diff checks passed.
- Upgrade 3: pending.

## Limits

No live SMS is sent. External AI extraction uses controlled API fixtures, while deterministic entry parsing, coordinator decisions, database commits, reloads and outbox generation run as real code. A missing inbound carrier message is not reproduced by these tests.
