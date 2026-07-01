# Subscription Auto Transfer Already-Received Handling Extraction Design

## Goal

Extract the Pan115 already-received recovery branch from `SubscriptionService._auto_save_resources()` so duplicate receive errors are handled by a focused, testable helper.

## Scope

Move only the behavior currently inside `if self._is_already_received_error(str(exc)):` into `backend/app/services/subscriptions/auto_transfer_already_received.py`:

- apply the existing precise-transfer post-process callback for TV precise transfers
- mark non-TV records completed with the current timestamp
- clear the record error message
- send the same transfer-success notification with method text `已在网盘（跳过重复）`
- write the same `auto_transfer_item_done` step log
- write the same `subscription.record.transfer_ok` operation log
- return one saved item and the same loop-control decision
- return the same non-TV subscription cleanup metadata

This change does not move `_is_already_received_error()`, normal transfer failure logging, ordinary share submission, precise transfer submission, offline submission, link fallback, database commits, Pan115 client creation, runtime settings, or cleanup execution.

## Architecture

The new module exposes `AlreadyReceivedHandlingResult` and `handle_already_received_transfer()`. It receives plain subscription/record-like objects, the parent folder id, source name, booleans for TV precise behavior, statuses/timestamps, and injected callbacks for precise post-processing, notification, step logging, and operation logging.

`SubscriptionService._auto_save_resources()` remains the runtime integration point. It keeps the exception classification, then delegates the already-received action to the helper and merges the returned saved count, cleanup metadata, and loop control.

The new module must not import `SubscriptionService`, runtime settings, Pan115 service, operation log service, media postprocess service, Kafka producer, database sessions, API routes, or model classes.

## Behavior

The extracted behavior remains compatible:

- TV subscriptions still use `_apply_precise_transfer_postprocess_status(record)` and continue to the next record after handling the duplicate receive condition.
- Non-TV subscriptions still set status to `COMPLETED`, set `completed_at`, clear errors, increment saved count, and stop processing records.
- Step log `auto_transfer_item_done` keeps reason `already_received` plus archive trigger/skip metadata.
- Operation log `subscription.record.transfer_ok` keeps reason `already_received`.
- Non-TV cleanup metadata remains `subscription_cleanup_transferred` with message `资源已在网盘中，已自动删除订阅`.
- The helper does not emit Kafka events because the existing branch does not emit them.

## Testing

Add direct tests in `backend/tests/test_subscription_auto_transfer_already_received.py` for:

- non-TV duplicate receive handling mutating the record, writing notification/log payloads, and returning cleanup metadata with `should_stop=True`
- TV duplicate receive handling using the precise post-process callback, not forcing completed status, and returning `should_continue=True`
- dependency-boundary assertions that reject direct imports of service/runtime/database/API/model layers

Keep the existing auto-transfer precise, share, offline, context, TV selection, and link-fallback tests passing.
