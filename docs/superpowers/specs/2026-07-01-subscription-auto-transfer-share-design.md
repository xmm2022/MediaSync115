# Subscription Auto Transfer Share Submission Extraction Design

## Goal

Extract the ordinary Pan115 share-transfer success branch from `SubscriptionService._auto_save_resources()` so automatic transfer execution is split by transfer mode.

## Scope

Move only the non-TV-precise, non-offline direct share transfer branch into `backend/app/services/subscriptions/auto_transfer_share.py`:

- call an injected direct share saver with share URL, parent folder, receive code, and quality filter
- mark the record completed and clear transfer errors
- set the target folder id on the record
- send the transfer notification through an injected callback
- trigger archive post-processing through an injected callback
- write the same step log and operation log payloads through injected callbacks
- emit the same transfer-success event through an injected callback
- return the same subscription-cleanup metadata currently assembled inline

This change does not move TV precise-transfer logic, already-received exception handling, offline submission, link fallback, database commits, Pan115 client creation, runtime settings, or cleanup execution.

## Architecture

The new module exposes `ShareTransferSubmissionResult` and `submit_share_transfer_record()`. It receives plain subscription/record-like objects plus injected callbacks for saving, notification, archive trigger, step logging, operation logging, event emission, and current time.

`SubscriptionService._auto_save_resources()` remains the runtime integration point. It passes the already-split share link and receive code, `pan_service.save_share_directly`, `self._notify_transfer_success`, `media_postprocess_service.trigger_archive_after_transfer`, `self._create_step_log()`, operation logs, and Kafka emission.

The new module must not import `SubscriptionService`, runtime settings, Pan115 service, operation log service, media postprocess service, Kafka producer, database sessions, API routes, or model classes.

## Behavior

The extracted behavior remains compatible:

- Direct share transfer still uses `save_share_directly()` with the same keyword arguments.
- Successful transfer sets status to `COMPLETED`, sets `completed_at`, clears `error_message`, and writes `file_id`.
- TG transfer notification still uses method text `分享转存`.
- Archive post-processing still triggers with `subscription_transfer`.
- Step log `auto_transfer_item_done` and operation log `subscription.record.transfer_ok` keep the same messages and payload shapes.
- Transfer-success event keeps `transfer_type: share` and `status: success`.
- The helper returns `subscription_cleanup_transferred` cleanup metadata and indicates that the caller should stop processing records.

## Testing

Add direct tests in `backend/tests/test_subscription_auto_transfer_share.py` for successful record mutation, callback payloads, cleanup metadata, event-emission best-effort behavior, and dependency boundaries. Keep offline, context, and link-fallback tests passing.
