# Cross-System Completion Design

## Goal

Finish the practical integration path across MediaSync115, MoviePilot, Twilight, and Symedia without duplicating responsibilities between systems.

## Scope

This phase completes what can be owned and verified inside MediaSync115:

- Mirror MoviePilot subscription, active download, and transfer-history state into MediaSync115.
- Add a scheduler job so MoviePilot state can sync automatically.
- Keep Symedia integration directory-based: MoviePilot downloads to the configured incoming path, Symedia watches and archives/scrapes/STRM according to its own rules.
- Add a lightweight Twilight external-service entry in MediaSync115: URL/API key settings, health/status check, and navigation link. Twilight continues to own Emby/Jellyfin user, invite, card, permission, line, device, and risk management.

Out of scope for MediaSync115:

- Reimplementing Twilight user management, invite trees, registration cards, Emby permissions, or Telegram policies.
- Direct Symedia API integration before a local Symedia repository/API contract is available.
- Replacing MoviePilot's PT site rules, downloader integration, RSS/search execution, or transfer workflow.

## Architecture

MediaSync115 remains the unified media-task dashboard. MoviePilot is treated as an external execution provider. Twilight and Symedia are treated as neighboring systems with explicit ownership boundaries.

MoviePilot provider sync has three layers:

1. Subscription metadata sync updates `Subscription.external_status`.
2. Active download sync creates or updates local `DownloadRecord` rows from MoviePilot `/api/v1/download`.
3. Transfer-history sync marks matching local `DownloadRecord` rows as completed or failed from MoviePilot `/api/v1/history/transfer`.

Matching is conservative. MediaSync115 first matches by download hash, then by external MoviePilot subscription title when a hash is unavailable. Unknown MoviePilot items are returned in sync summaries but are not imported as new local subscriptions.

## Data Flow

1. User creates a PT subscription in MediaSync115.
2. MediaSync115 creates a local subscription row and calls MoviePilot.
3. MoviePilot downloads into the configured incoming path.
4. MediaSync115 scheduled sync polls MoviePilot subscriptions, active downloads, and transfer history.
5. Local download rows show current MoviePilot state for dashboard/list visibility.
6. Symedia sees files in its watched incoming directory and performs archive/scrape/STRM independently.
7. Twilight manages Emby/Jellyfin users and permissions separately; MediaSync115 only links to and health-checks Twilight.

## Error Handling

- Missing MoviePilot configuration returns a clear provider error.
- MoviePilot upstream failures are logged and surfaced through API responses without exposing credentials.
- Sync jobs are idempotent: repeated syncs update existing rows rather than creating duplicates.
- Transfer history failures update existing records to failed with an error message; success marks records completed.
- Twilight health checks use only configured URL/API key and do not require storing Twilight user credentials.

## Testing

- Unit tests cover MoviePilot download and transfer-history normalization.
- Provider tests cover creating/updating `DownloadRecord` rows and idempotency.
- API tests cover sync summary shape and upstream error handling.
- Frontend TypeScript contract checks cover new API responses.
- Existing MoviePilot and broad backend regression subsets remain required before deployment.
