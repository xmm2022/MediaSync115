# Subscription Record Selection Helper Extraction Design

## Goal

Extract subscription download-record selection helpers from `SubscriptionService` so retry filtering, duplicate merge, and new-record exclusion live in a focused pure module.

## Scope

Move only pure record-list responsibilities into `backend/app/services/subscriptions/record_selection.py`:

- classify whether a record resource type is an offline transfer type
- decide whether a failed record is retryable based on resource type, share-link shape, and retryable error text
- decide whether a pending or matched record can be retried based on resource type and share-link shape
- combine failed and pending rows into the retryable record list
- merge two record lists while preserving order and de-duplicating by database id first, then resource URL
- exclude newly created records from retry records by resource URL
- de-duplicate rows by resource URL for force-retry duplicate link handling

This change does not move database queries, SQLAlchemy models, media statuses, auto-transfer execution, link fallback orchestration, logging, cleanup, or runtime settings.

## Architecture

The new module exposes pure helpers that accept record-like objects with `id`, `resource_type`, `resource_url`, and `error_message` attributes:

- `is_offline_resource_type(resource_type: Any) -> bool`
- `is_retryable_failed_record(record: Any) -> bool`
- `is_retryable_pending_record(record: Any) -> bool`
- `select_retryable_records(failed_rows: Iterable[Any], pending_rows: Iterable[Any]) -> list[Any]`
- `merge_records(primary: Iterable[Any], secondary: Iterable[Any]) -> list[Any]`
- `exclude_new_records(retry_records: Iterable[Any], new_records: Iterable[Any]) -> list[Any]`
- `dedupe_records_by_resource_url(records: Iterable[Any]) -> list[Any]`

`record_selection.py` may import pure classifiers from `resource_metadata.py`, but it must not import `SubscriptionService`, runtime settings, SQLAlchemy sessions, ORM models, API routes, or service clients.

`SubscriptionService` keeps DB loading methods. After queries return ORM rows, it delegates row filtering and list merging to the new helpers. Existing resource-candidate helper wrappers that only forward to `resource_candidates.py` are removed, and call sites use direct imported functions.

## Behavior

The extracted behavior remains compatible:

- Failed rows are retryable when they are offline records or likely 115 share identifiers, and their error text matches the existing retryable transfer tokens.
- Pending and matched rows are retryable when they are offline records or likely 115 share identifiers; they do not require an error-message match.
- Merged record lists preserve first occurrence order.
- Merge de-duplicates by `id` when present, otherwise by `resource_url`.
- New records are excluded from retry records by normalized `resource_url`.
- Force-retry duplicate rows keep only the first row for each non-empty `resource_url`, preserving query order.

## Testing

Add direct tests in `backend/tests/test_subscription_record_selection.py` for:

- offline type classification
- failed-row retry filtering for retryable 115 links, retryable offline rows, non-retryable errors, and invalid links
- pending-row retry filtering without requiring an error message
- merge de-duplication by id and URL while preserving order
- excluding newly created records from retry records
- de-duplicating force-retry rows by resource URL
- dependency-boundary assertions that reject imports of service/runtime/database/API/model layers

Keep existing subscription link-fallback, resource-candidate, auto-transfer, and health tests passing.
