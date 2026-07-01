# Subscription Auto Transfer Precise Submission Extraction Design

## Goal

Extract the TV missing-episode precise-transfer success branch from `SubscriptionService._auto_save_resources()` so automatic transfer execution is split by transfer mode.

## Scope

Move only the successful TV precise-transfer branch into `backend/app/services/subscriptions/auto_transfer_precise.py`:

- extract a share code from the already-normalized share link
- fetch all files from the Pan115 share
- select files that match the current missing episode set
- log parsed file counts and skip resources with no matching missing episodes
- transfer selected file ids into the configured parent folder
- remove matched episode pairs from the mutable missing set after successful transfer
- apply the existing precise-transfer archive post-process callback
- mark the record target folder id and report one saved item
- send the same transfer notification, operation log, step log, and transfer-success event payloads
- evaluate TV cleanup when the missing set becomes empty
- return cleanup metadata and stop/continue hints to the caller

This change does not move non-TV share transfer, offline submission, already-received exception handling, general transfer failure logging, link fallback, database commits, Pan115 client creation, runtime settings, or cleanup execution.

## Architecture

The new module exposes `PreciseTransferSubmissionResult` and `submit_precise_transfer_record()`. It receives plain subscription/record-like objects, the mutable missing-episode set, share link details, quality filter, parent folder id, and injected callbacks for Pan115 operations, file selection, archive post-processing, notifications, logging, event emission, follow-mode normalization, upcoming-episode lookup, cleanup policy evaluation, and video filename detection.

`SubscriptionService._auto_save_resources()` remains the runtime integration point. It continues to create `Pan115Service`, resolve runtime settings, split share links, build TV missing context, own database-backed step log callbacks, and decide which transfer mode applies. The precise helper returns all state changes the loop needs: saved increment, whether to continue to the next record, whether to stop processing, cleanup metadata, and remaining missing count through the shared set.

The new module must not import `SubscriptionService`, runtime settings, Pan115 service, operation log service, media postprocess service, Kafka producer, database sessions, API routes, or model classes. It may depend on the small existing `tv_episode_selection` value object through the injected selector result shape, but should keep selection itself injectable for direct unit tests.

## Behavior

The extracted behavior remains compatible:

- Invalid share links still raise `ValueError("无效的分享链接，无法提取分享码")`.
- File parsing still logs `tv_record_files_parsed` with total, parsed, matched, unparsed, and remaining counts.
- Resources with no selected file ids still revert the record to `MATCHED`, clear completion/error state, log `tv_record_skip_no_missing`, and continue to the next record.
- Successful precise transfer still calls `save_share_files_directly()` with `share_url`, `file_ids`, `parent_id`, and `receive_code`.
- Matched missing pairs are removed only after the save callback succeeds.
- The archive post-process callback still controls whether the record becomes completed or archiving.
- Success log `tv_transfer_selected_done`, operation log `subscription.record.transfer_ok`, TG notification method text `精准转存`, and transfer-success event `transfer_type: precise` keep the same payload shapes.
- When no missing episodes remain, cleanup policy is evaluated with the normalized follow mode and upcoming-episode callback. If cleanup is allowed, the helper returns `subscription_cleanup_tv_completed_after_transfer` metadata and asks the caller to stop.

## Testing

Add direct tests in `backend/tests/test_subscription_auto_transfer_precise.py` for:

- successful selected-file transfer mutating the record, removing missing pairs, logging callback payloads, emitting events, and returning cleanup metadata when the TV subscription is complete
- no-selected-file skip behavior returning `should_continue=True` without saving or emitting a success event
- invalid share code raising the same `ValueError`
- event-emission errors being best-effort
- dependency-boundary assertions that reject direct imports of service/runtime/database/API/model layers

Keep the existing auto-transfer share, offline, context, TV selection, and link-fallback tests passing.
