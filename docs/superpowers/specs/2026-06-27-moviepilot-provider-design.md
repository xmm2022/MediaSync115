# MoviePilot Provider Integration Design

## Goal

MediaSync115 becomes the unified media task entry for 115/Quark and MoviePilot-backed PT subscriptions. Twilight remains responsible for Emby/Jellyfin users and permissions. Symedia is not integrated through API in this phase; it consumes files from agreed incoming directories and performs archive/scrape/STRM work independently.

## Scope

Phase 1 adds a backend MoviePilot provider MVP:

- Store MoviePilot connection settings in runtime settings.
- Provide a MoviePilot HTTP client with token login and retry on expired tokens.
- Expose API endpoints for configuration status, health check, title search, subscription creation, subscription sync, and manual subscription search.
- Store external MoviePilot identifiers on local subscriptions so MediaSync115 can show unified state.

Frontend polish and Twilight integration are deferred until the backend contract is stable.

## Boundaries

- MediaSync115 owns user-facing media tasks and local subscription records.
- MoviePilot owns PT site rules, RSS/search execution, downloaders, and PT download state.
- Symedia owns post-download file handling through directory rules only.
- Emby/Jellyfin library permissions remain in Twilight.

## Data Flow

1. A user creates a PT subscription in MediaSync115.
2. MediaSync115 creates or reuses a local subscription row with `provider = moviepilot`.
3. MediaSync115 calls MoviePilot `POST /api/v1/subscribe/`.
4. MediaSync115 stores MoviePilot's subscription id in `external_subscription_id`.
5. Manual search uses MoviePilot `GET /api/v1/subscribe/search/{id}`.
6. Periodic or manual sync uses MoviePilot `GET /api/v1/subscribe/`, `GET /api/v1/download`, and later transfer history endpoints.
7. MoviePilot downloads into the Symedia incoming path configured in MoviePilot or passed as save path where supported.
8. Symedia archives and scrapes files without MediaSync115 API coupling.

## Error Handling

- Missing MoviePilot base URL, username, or password returns a configuration error.
- A 401/403 response triggers one login refresh and one retry.
- Upstream errors are returned with sanitized messages and logged through normal API logging.
- Duplicate local subscriptions reuse the existing local row where identifiers match.

## Testing

- Unit tests cover MoviePilot client login, retry, payload normalization, and provider mapping.
- API tests cover unavailable configuration and subscription creation with a fake provider.
- Database tests cover added subscription provider columns through startup migration.
