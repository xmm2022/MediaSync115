# Subscription Resource Metadata Helper Extraction Design

## Goal

Extract subscription resource metadata helpers from `SubscriptionService` so resource naming, keyword building, link parsing, video detection, and transfer-error classification live in a focused pure module.

## Scope

Move only pure helper responsibilities into `backend/app/services/subscriptions/resource_metadata.py`:

- determine a stored resource type from a URL
- extract a display resource name from a resource dict
- build PanSou, HDHive, and TG search keywords from title/year values
- normalize HDHive resource rows into the shape expected by downstream transfer code
- split a 115 share link and receive code from compact codes, query parameters, or Chinese text hints
- detect video filenames
- classify likely 115 share identifiers
- classify retryable transfer errors
- classify already-received transfer errors

Also remove local private wrappers in `SubscriptionService` that only forward to existing helper modules, and replace their call sites with direct function imports.

This change does not move resource fetching, HDHive unlocking policy, auto-transfer submission, cleanup logic, database access, runtime settings, step logs, operation logs, or notification behavior.

## Architecture

The new module exposes pure functions with primitive inputs:

- `determine_resource_type(url: str) -> str`
- `extract_resource_name(item: dict[str, Any]) -> str`
- `build_pansou_keyword(title: str, year: Any) -> str`
- `build_hdhive_keyword(title: str, year: Any) -> str`
- `build_tg_keyword(title: str, year: Any) -> str`
- `normalize_hdhive_subscription_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]`
- `split_share_link_and_receive_code(raw_link: str) -> tuple[str, str]`
- `is_video_filename(filename: str) -> bool`
- `is_likely_115_share_identifier(raw_link: str) -> bool`
- `is_retryable_transfer_error(error_text: str) -> bool`
- `is_already_received_error(error_text: str) -> bool`

`SubscriptionService` imports these functions and calls them directly. Existing helpers from `resource_candidates.py` and `offline_transfer.py` remain the source of truth for their existing domains; `SubscriptionService` no longer keeps pass-through private wrappers for them.

The new module must not import `SubscriptionService`, runtime settings, service clients, database sessions, API routes, ORM models, or notification systems.

## Behavior

The extracted behavior remains compatible:

- URL types remain `magnet`, `ed2k`, or `pan115`.
- Missing resource names still fall back to `未命名资源`.
- PanSou and TG keywords prefer `title year` when `year` is truthy.
- HDHive keywords keep the same title/year behavior and strip title-only keywords.
- HDHive rows still fill `pan115_share_link` from `share_link` and `name` from `resource_name` when missing.
- Compact `sharecode-pass`, query-style `password=xxxx`, and Chinese `提取码/访问码/密码` hints still produce the same receive code.
- Video extension support remains `.mp4`, `.mkv`, `.avi`, `.ts`, `.rmvb`, `.flv`, `.mov`, `.wmv`, and `.m4v`.
- 115 share identifiers, retryable transfer errors, and already-received errors keep the same token matching rules.

## Testing

Add direct tests in `backend/tests/test_subscription_resource_metadata.py` for:

- resource type and display-name extraction
- keyword building for PanSou, HDHive, and TG
- HDHive row normalization
- receive-code parsing for compact, query, Chinese text, and empty inputs
- video filename detection
- likely 115 share identifier detection
- retryable transfer error classification
- already-received error classification
- dependency-boundary assertions that reject imports of service/runtime/database/API/model layers

Keep the existing subscription resource, HDHive unlock, auto-transfer, and general backend tests passing.
