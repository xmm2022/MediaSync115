# Subscription Snapshot Model Extraction Design

## Goal

Extract the `SubscriptionSnapshot` data structure from `SubscriptionService` into a focused subscription module so subscription-run helpers and tests can depend on the snapshot type without importing the large service module.

## Scope

Move only the `SubscriptionSnapshot` dataclass into `backend/app/services/subscriptions/snapshot.py`.

This change does not move subscription orchestration, database queries, resource fetching, transfer logic, cleanup, runtime settings, logs, or model conversion logic.

## Architecture

The new module exposes:

- `SubscriptionSnapshot`

`SubscriptionSnapshot` remains a slotted dataclass with the same field names, field order, and type annotations. It imports only `dataclass` and `MediaType`.

`SubscriptionService` imports `SubscriptionSnapshot` from the new module and keeps it available in the `app.services.subscription_service` module namespace. This preserves existing imports such as:

```python
from app.services.subscription_service import SubscriptionSnapshot
```

New code and direct tests may import from:

```python
from app.services.subscriptions.snapshot import SubscriptionSnapshot
```

The new module must not import `SubscriptionService`, runtime settings, service clients, database sessions, API routes, or other orchestration modules.

## Behavior

The extracted behavior remains compatible:

- Constructing `SubscriptionSnapshot` with the existing fields works unchanged.
- The dataclass remains slotted.
- Existing code that imports `SubscriptionSnapshot` from `subscription_service.py` continues to work.
- Service methods continue to receive and build the same snapshot instances.

## Testing

Add direct tests in `backend/tests/test_subscription_snapshot.py` for:

- constructing a snapshot from the new module
- verifying slotted behavior rejects arbitrary attributes
- verifying `subscription_service.SubscriptionSnapshot` is the same class object as the new module export
- dependency-boundary assertions that reject imports of service/runtime/database/API layers

Keep existing fetch-resource, link-fallback, subscription, and health tests passing.
