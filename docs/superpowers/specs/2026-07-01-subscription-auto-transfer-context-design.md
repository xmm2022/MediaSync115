# Subscription Auto Transfer Context Extraction Design

## Goal

Extract the TV missing-episode context preparation from `SubscriptionService._auto_save_resources()` so the automatic transfer path has a focused, testable boundary before the actual Pan115 transfer branches.

## Scope

Move only the TV missing-context preparation into `backend/app/services/subscriptions/auto_transfer_context.py`:

- determine whether the subscription is a TV transfer with a TMDB id
- reuse a provided missing-status snapshot when available
- fetch missing status through an injected callback when no snapshot is provided
- create the same start, success, and failure step logs through an injected callback
- normalize missing episode pairs into `set[tuple[int, int]]`
- return a small context object with `is_tv_subscription`, `tv_missing_enabled`, and `missing_episodes`

This change does not move Pan115 clients, offline download submission, precise file selection, share transfer, cleanup decisions, operation logs, Kafka events, or record mutation beyond the context variables.

## Architecture

The new module exposes `AutoTransferTvMissingContext` and `build_auto_transfer_tv_missing_context()`. It depends only on plain subscription-like objects and injected callbacks, so it must not import `SubscriptionService`, runtime settings, database sessions/models, API routes, or `tv_missing_service`.

`SubscriptionService._auto_save_resources()` remains the runtime integration point. It builds two small callbacks: one for `self._create_step_log()` with the current run metadata and one for `tv_missing_service.get_tv_missing_status()` using the current subscription scope.

## Behavior

The extracted behavior remains compatible:

- Non-TV subscriptions skip missing-context preparation.
- TV subscriptions without TMDB id skip missing-context preparation.
- Provided snapshots are trusted and do not create fetch start/done/failure logs.
- Fresh fetches create `tv_missing_fetch_start` before calling the missing service.
- Successful fresh fetches create `tv_missing_fetch_done` with aired, existing, and missing counts.
- Failed fresh fetches create `tv_missing_fetch_failed` and leave `tv_missing_enabled` false.
- Missing episode pairs still ignore malformed entries and coerce valid pairs to integers.

## Testing

Add direct tests in `backend/tests/test_subscription_auto_transfer_context.py` for successful fetch, snapshot reuse without logs, failed fetch warning behavior, and dependency boundaries. Keep precise-transfer and link-fallback tests passing to prove surrounding automatic transfer behavior remains intact.
