# Subscription Source Attempts Extraction Design

## Goal

Reduce the orchestration load in `backend/app/services/subscription_service.py` by moving source-attempt summary and source-order decision helpers into a focused, deterministic module.

## Scope

Extract only pure logic around resource source attempts:

- building the Chinese source-attempt summary from attempt dictionaries
- filtering configured source priority down to supported sources
- removing Telegram from the source order when Telegram runtime credentials are incomplete

This change does not move provider calls, operation logs, Kafka events, quality sorting, HDHive unlocks, offline magnet fetching, or database access.

## Architecture

Create `backend/app/services/subscriptions/source_attempts.py` next to the existing `resource_candidates.py` module. The new module must not import `SubscriptionService`, runtime settings, API route modules, database sessions, or provider services.

`SubscriptionService._build_source_attempt_summary()` remains as a compatibility wrapper. `SubscriptionService._resolve_source_order()` continues to read `runtime_settings_service` and passes plain values into `resolve_source_order()`.

## Behavior

The extracted behavior remains unchanged:

- Empty attempts return `未尝试任何来源`.
- Known source display names remain `HDHive`, `Pansou`, `TG`, and `离线磁力`.
- Successful attempts are displayed as `<source>(<count>条)`.
- Failed attempts are displayed as `<source>(失败)`.
- Empty attempts are displayed as `<source>(无资源)`.
- Any success yields `最终命中 ...`; no success yields `均未命中可用资源`.
- Source priority keeps only `hdhive`, `pansou`, and `tg`.
- `tg` is removed when Telegram is not ready.

## Testing

Add direct tests in `backend/tests/test_subscription_source_attempts.py` for summary construction, source-order filtering, and module boundary imports. Keep `backend/tests/test_fetch_resources_waterfall.py` passing to prove the existing fetch metadata shape remains compatible.
