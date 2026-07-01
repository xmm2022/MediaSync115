# Subscription Resource Candidates Extraction Design

## Goal

Reduce `backend/app/services/subscription_service.py` by moving pure resource candidate helpers into a focused module without changing subscription behavior or public API responses.

## Scope

This change extracts only deterministic helpers that do not touch the database, network, runtime settings, logs, or Pan115 clients:

- resource URL normalization and extraction from search result items
- offline magnet/ED2K URL extraction
- candidate URL selection for deduplication
- filtering fetched resources against previously attempted URLs
- merging auto-save statistics across fallback rounds
- deciding whether link fallback should continue after a transfer round

This change does not move `_fetch_resources`, `_auto_save_resources`, TV missing checks, database queries, or transfer execution.

## Architecture

Create `backend/app/services/subscriptions/resource_candidates.py` for pure candidate-processing functions. The module can depend on `app.models.models.MediaType` for the fallback decision, but it must not import `SubscriptionService`, API route modules, database sessions, or provider services.

`SubscriptionService` keeps its existing private methods as compatibility wrappers, so current callers and tests do not need a broad rewrite. New tests should import the extracted module directly and add a dependency-boundary check that the new module does not import `subscription_service`.

## Behavior

The extracted functions preserve the current behavior:

- 115 CDN URLs normalize to `https://115.com/`.
- URL fragments are stripped.
- Candidate URLs prefer 115 share URLs and fall back to magnet/ED2K URLs.
- Resources whose candidate URL is in the exclusion set are removed.
- Link fallback stops when the subscription is completed.
- Movie fallback continues only when nothing was saved and at least one record was attempted.
- TV fallback continues when `remaining_missing_count` is present and greater than zero; otherwise it follows the same "nothing saved and attempted" rule.

## Testing

Add tests in `backend/tests/test_subscription_resource_candidates.py` for direct module behavior. Keep `backend/tests/test_subscription_link_fallback.py` working through the `SubscriptionService` wrappers to prove backward compatibility.

Run targeted tests first, then backend quick/full verification before committing.
