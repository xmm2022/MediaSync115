# Subscription HDHive Unlock Extraction Design

## Goal

Extract the HDHive locked-resource auto-unlock flow from `SubscriptionService` so the subscription service keeps shrinking without changing source fetching, unlock policy, or trace behavior.

## Scope

Move the HDHive unlock policy helpers and unlock loop into `backend/app/services/subscriptions/hdhive_unlock.py`:

- build the per-run unlock context dictionary from explicit setting values
- normalize and scan HDHive resource items
- skip locked items according to enablement, slug, point threshold, budget, and circuit state
- call an injected unlock function for eligible resources
- update share-link fields, budget, stats, and trace entries
- stop after the configured unlock count or circuit-breaker conditions
- keep the small compatibility methods on `SubscriptionService`

This change does not move HDHive fetching, source waterfall ordering, database writes, Pan115 transfer logic, cleanup, operation logs, Kafka events, or subscription execution orchestration.

## Architecture

The new module is a subscription-domain helper with injected dependencies. It receives plain resource dictionaries, a mutable context dictionary, a trace list, and small callback functions for item normalization, URL extraction, URL normalization, unlocking, and sleeping.

`SubscriptionService` remains the runtime integration point. It reads `runtime_settings_service`, passes `hdhive_service.unlock_resource` into the helper, and keeps private wrapper methods with the existing names so tests and callers that patch the service instance still work.

The new module must not import `SubscriptionService`, database models/sessions, API route modules, or runtime settings directly. That keeps the helper reusable when `_fetch_resources` is split later.

## Behavior

The extracted behavior remains compatible:

- Auto-unlock still attempts at most one successful HDHive unlock per run by default.
- Disabled unlocks, missing slugs, invalid points, over-threshold items, open circuit state, and budget exhaustion still create skip traces.
- A successful unlock still writes both `pan115_share_link` and `share_link`, sets `pan115_savable`, decrements budget, resets consecutive failures, and updates stats.
- Unlock failures still increment consecutive failures and may open the circuit on auth/token/cookie/points messages.
- Three consecutive failures still open the circuit by default.
- Summary traces still include local counts and accumulated total stats.

## Testing

Extend `backend/tests/test_hdhive_unlock_policy.py` with direct tests for the new helper module, including stop-after-first-success, context construction, stop-message policy, and dependency boundaries. Keep the existing `SubscriptionService._prepare_hdhive_locked_resources()` test to prove wrapper compatibility.
