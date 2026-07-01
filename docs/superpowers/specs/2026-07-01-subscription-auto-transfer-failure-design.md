# Subscription Auto Transfer Failure Logging Extraction Design

## Goal

Extract the ordinary auto-transfer failure logging branch from `SubscriptionService._auto_save_resources()` so failed transfer records are handled by a focused helper.

## Scope

Move only the behavior after the already-received branch falls through into `backend/app/services/subscriptions/auto_transfer_failure.py`:

- mark the record failed with the injected failed status
- store the truncated error message on the record
- write the `auto_transfer_try_next_link` step log
- write the `auto_transfer_item_failed` step log
- write the `subscription.record.transfer_fail` operation log
- return one failed item and the same error detail entry currently appended to `errors`

This change does not move already-received handling, successful share transfer, precise transfer, offline submission, link fallback, resource fetching, database commits, runtime settings, or cleanup execution.

## Architecture

The new module exposes `TransferFailureHandlingResult` and `handle_transfer_failure()`. It receives plain subscription/record-like objects, the source name, exception object, failed status, trace id, and injected callbacks for step logging and operation logging.

`SubscriptionService._auto_save_resources()` remains the runtime integration point. It keeps exception classification and calls the failure helper only for ordinary transfer exceptions, then merges `failed_increment` and `error_entry` into the surrounding counters.

The new module must not import `SubscriptionService`, runtime settings, Pan115 service, operation log service, media postprocess service, Kafka producer, database sessions, API routes, or model classes.

## Behavior

The extracted behavior remains compatible:

- `record.status` is set to `MediaStatus.FAILED`.
- `record.error_message` keeps `str(exc)[:1000]`.
- Step log `auto_transfer_try_next_link` keeps the same info status, message truncation, and payload error truncation to 300 characters.
- Step log `auto_transfer_item_failed` keeps the same failed status, message truncation, and payload error truncation to 500 characters.
- Operation log `subscription.record.transfer_fail` keeps the same failed status, message truncation to 200 characters, and payload error truncation to 300 characters.
- Error detail entry keeps `source`, `subscription_id`, `title`, `resource`, and full `str(exc)`.

## Testing

Add direct tests in `backend/tests/test_subscription_auto_transfer_failure.py` for:

- failed record mutation, step log payloads, operation log payloads, and returned error entry
- long error truncation boundaries for record error, step payloads, and operation payloads
- dependency-boundary assertions that reject direct imports of service/runtime/database/API/model layers

Keep the existing auto-transfer already-received, precise, share, offline, context, and link-fallback tests passing.
