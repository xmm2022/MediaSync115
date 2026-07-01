# Subscription Offline Transfer Metadata Extraction Design

## Goal

Extract deterministic offline-transfer metadata parsing from `SubscriptionService` so the automatic transfer flow can keep shrinking without changing offline submission behavior.

## Scope

Move only pure parsing helpers into `backend/app/services/subscriptions/offline_transfer.py`:

- extract BT info-hash from magnet URLs
- recursively extract the first non-empty nested value for a set of keys
- extract offline `info_hash` from Pan115 offline submission payloads
- extract offline task id from Pan115 offline submission payloads
- build submitted offline metadata from submission payload plus original resource URL

This change does not move `offline_task_add`, runtime folder lookup, `DownloadRecord` mutations, operation logs, Kafka events, step logs, or offline monitor behavior.

## Architecture

The new module receives plain strings and payload dictionaries/lists, and returns strings or a small dataclass. It must not import `SubscriptionService`, runtime settings, database models/sessions, API route modules, or Pan115 clients.

`SubscriptionService` keeps private wrapper methods for the existing helper names. The offline branch calls the new `build_submitted_offline_metadata()` helper and assigns its result to the current `DownloadRecord` fields.

## Behavior

The extracted behavior remains compatible:

- Empty URLs return an empty hash.
- Magnet hashes are normalized to uppercase.
- Both 32-character and 40-character BTIH values are accepted.
- Nested dict/list payloads are searched depth-first.
- Supported info-hash keys remain `info_hash`, `infoHash`, `hash`, `task_hash`, and `taskHash`.
- Supported task-id keys remain `task_id`, `taskId`, `taskid`, and `id`.
- Submission payload info-hash wins over URL-derived hash; URL hash is a fallback.

## Testing

Add direct tests in `backend/tests/test_subscription_offline_transfer.py` for hash extraction, nested metadata extraction, URL fallback, and dependency boundaries. Keep subscription link/resource tests passing to prove wrapper compatibility.
