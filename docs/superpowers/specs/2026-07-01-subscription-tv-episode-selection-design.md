# Subscription TV Episode Selection Extraction Design

## Goal

Extract the pure TV missing-episode file selection logic used during subscription auto-transfer, while keeping Pan115 transfer execution, database writes, logs, and cleanup decisions inside `SubscriptionService`.

## Scope

Move only deterministic data decisions into `backend/app/services/subscriptions/tv_episode_selection.py`:

- identify candidate video files from share file dictionaries
- parse season/episode pairs from file names
- match files against the current missing episode set
- choose one file per missing episode when multiple files match the same pair
- return selected items, selected file IDs, matched pairs, and parse counters for logging

This change does not move share-code extraction, recursive 115 file listing, `save_share_files_directly`, archive post-processing, completion cleanup, operation logs, Kafka events, or database writes.

## Architecture

The new module receives plain data and optional callables:

- `best_picker(items, quality_filter)` selects the best file among duplicate candidates.
- `is_video_file(filename)` lets callers preserve their existing video-extension rules.

This avoids importing `SubscriptionService`, `Pan115Service`, runtime settings, API modules, or database sessions into the pure selector.

`SubscriptionService._auto_save_resources()` calls the new selector and passes its current `_is_video_filename` method plus `pan_service.pick_best_video_file`, preserving existing auto-transfer behavior.

`subscription_source_service.select_missing_episode_files()` remains available as a compatibility wrapper and delegates to the new selector with its existing `Pan115Service.pick_best_video_file` behavior.

## Behavior

The selector preserves current behavior:

- Non-dict items are ignored.
- Items without file ID or file name are ignored.
- Configured `selected_file_ids` restrict matching when provided.
- Non-video files are ignored according to the caller-provided video predicate.
- Parsed videos increment `parsed_count`.
- Unparsed videos increment `unparsed_video_count`.
- Only files whose parsed `(season, episode)` pair is in `missing_episodes` are selected.
- Duplicate candidates for the same pair use `best_picker` when provided, falling back to the first item.
- Selected file IDs are deduplicated in selection order.

## Testing

Add direct tests in `backend/tests/test_subscription_tv_episode_selection.py` for duplicate best-pick behavior, selected ID deduplication, parse counters, and dependency boundaries. Keep existing fixed-source tests and auto-transfer-adjacent subscription tests passing.
