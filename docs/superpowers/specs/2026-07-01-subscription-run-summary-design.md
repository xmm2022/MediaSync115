# Subscription Run Summary Helper Extraction Design

## Goal

Extract subscription-run summary helpers from `SubscriptionService` so channel normalization, final status resolution, and user-facing run messages live in a focused pure module.

## Scope

Move only these pure helper responsibilities into `backend/app/services/subscriptions/run_summary.py`:

- normalize a subscription check channel and reject unsupported values
- resolve the final run status from failed, checked, and auto-transfer-failed counts
- build the final Chinese summary message from the run result counters

This change does not move `run_channel_check()`, operation logs, execution-log persistence, step logs, scanning, auto-transfer, cleanup, database access, runtime settings, or scheduler behavior.

## Architecture

The new module exposes:

- `normalize_subscription_channel(channel: str) -> str`
- `resolve_run_status(failed_count, checked_count, auto_failed_count, *, success_status, failed_status, partial_status) -> Any`
- `build_run_message(result: dict[str, Any]) -> str`

`resolve_run_status()` receives the status values from the caller instead of importing model enums. This keeps the helper pure and easy to unit test while preserving the existing `ExecutionStatus` return values in `SubscriptionService`.

`SubscriptionService` imports these functions and calls them from `run_channel_check()`. The old static helper implementations are removed.

The new module must not import runtime settings, service clients, database sessions, API routes, ORM models, or `SubscriptionService`.

## Behavior

The extracted behavior remains compatible:

- Channels are trimmed and lowercased.
- Supported channels remain `pansou`, `hdhive`, `tg`, `priority`, and `all`.
- Unsupported channels still raise `ValueError("unsupported channel")`.
- Runs with no failures resolve to success.
- Runs where `failed_count >= max(checked_count, 1)` resolve to failed.
- Other failure combinations resolve to partial.
- The final message keeps the same Chinese phrases and ordering:
  `共 N 个订阅` -> new-resource summary -> transfer success/failure -> cleanup -> processing failures.

## Testing

Add direct tests in `backend/tests/test_subscription_run_summary.py` for:

- channel normalization and rejection
- status resolution for success, failed, and partial cases using string status sentinels
- message construction with no new resources
- message construction with new resources, transfer counts, cleanup counts, and processing failures
- dependency-boundary assertions that reject direct imports of service/runtime/database/API/model layers

Keep existing backend tests passing.
