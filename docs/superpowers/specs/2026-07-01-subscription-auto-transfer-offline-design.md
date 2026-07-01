# Subscription Auto Transfer Offline Submission Extraction Design

## Goal

Extract the magnet/ED2K offline-submission branch from `SubscriptionService._auto_save_resources()` so automatic transfer execution can be split by transfer mode.

## Scope

Move only the single-record offline submission branch into `backend/app/services/subscriptions/auto_transfer_offline.py`:

- detect whether a record uses an offline-transfer resource type
- set the record to the downloading status before submitting
- call an injected offline task submitter with the record URL and offline folder id
- build submitted offline metadata from the submission payload and original URL
- update the record to offline-submitted state
- call injected operation-log, transfer-event, and step-log callbacks with the same payload shape
- return whether the caller should stop processing after the submission

This change does not move Pan115 client creation, runtime folder lookup, TV precise-transfer logic, share transfer logic, cleanup decisions, link-fallback loops, database commits, or offline monitor behavior.

## Architecture

The new module exposes `OfflineTransferSubmissionResult`, `is_offline_transfer_record()`, and `submit_offline_transfer_record()`. It receives plain subscription/record-like objects plus injected callbacks for task submission, step logging, operation logging, event emission, and current time.

`SubscriptionService._auto_save_resources()` remains the runtime integration point. It provides `pan_service.offline_task_add`, `runtime_settings_service.get_pan115_offline_folder()`, `operation_log_service.log_background_event()`, Kafka event emission, and `self._create_step_log()`.

The new module must not import `SubscriptionService`, runtime settings, Pan115 service, operation log service, Kafka producer, database sessions, API routes, or model classes.

## Behavior

The extracted behavior remains compatible:

- Only `magnet` and `ed2k` resource types use the offline submission path.
- Records are set to `DOWNLOADING` before the offline task is submitted.
- Successful submissions set status to `OFFLINE_SUBMITTED`, clear completion/error fields, fill offline hash/task id, and set `file_id` to the offline folder id.
- The operation-log message and extra fields stay the same.
- The transfer-success event data stays the same.
- The `auto_transfer_offline_done` step log payload stays the same.
- Movie offline submissions stop the record loop; TV offline submissions continue to the next record.

## Testing

Add direct tests in `backend/tests/test_subscription_auto_transfer_offline.py` for record detection, successful mutation/log/event behavior, movie stop behavior, TV continue behavior, and dependency boundaries. Keep link-fallback, offline metadata, and auto-transfer context tests passing.
