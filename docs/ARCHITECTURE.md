# MediaSync115 Architecture Roadmap

This document records the current module boundaries and the recommended stabilization path before adding large new features.

## Current Shape

MediaSync115 is now a multi-system orchestration app, not a small single-purpose tool. The main domains are:

- Discovery: TMDB, Douban, Pansou, HDHive, Telegram, SeedHub, Butailing.
- Storage execution: 115, Quark, offline tasks, share transfer, file operations.
- Subscriptions: MediaSync115 115 subscriptions, fixed 115 sources, ANI-RSS, MoviePilot.
- Media library: Emby, Feiniu, STRM, archive, missing episode status.
- Operations: scheduler, runtime settings, logs, health checks, Docker deployment.

The project should be split by domain boundaries, not by file size alone.

## Core Problems

- `backend/app/services/subscription_service.py` depends on helpers from `backend/app/api/search.py`. This is a layer inversion: services should not depend on API route modules.
- Large API files contain business logic and serialization together, especially `backend/app/api/search.py`, `backend/app/api/subscriptions.py`, and `backend/app/api/settings.py`.
- Frontend page components own whole workflows, API orchestration, UI state, and rendering in the same files.
- Test and deployment verification is documented but not centralized in executable scripts.
- Documentation includes current facts, historical design docs, generated snapshots, and next-session notes without clear status markers.

## Target Boundaries

### Backend

```text
backend/app/services/
  resource_search/
    facade.py
    keyword_builder.py
    normalizers.py
    providers/
      pansou.py
      hdhive.py
      tg.py
      seedhub.py
      butailing.py

  subscriptions/
    run_service.py
    resource_resolver.py
    transfer_executor.py
    link_fallback_executor.py
    cleanup_service.py
    log_writer.py

  pan115/
    client_adapter.py
    request_executor.py
    files.py
    offline.py
    share.py
    transfer.py
    qr_login.py
    video_selector.py
```

The first backend target is `resource_search`, because it removes the service-to-API dependency without changing public endpoints.

### Frontend

```text
frontend/src/
  app/
    AppShell.tsx
    LoginScreen.tsx
    navigation.ts
    useAppBootstrap.ts
    useAuthSession.ts

  features/
    settings/
    subscriptions/
    pan115/
    search/
    anime/

  shared/
    components/ui/
    utils/
```

The first frontend target is extracting pure helpers and small display components before moving stateful workflows.

## Priority

### P0

- Extract backend `resource_search` from `backend/app/api/search.py`.
- Split `backend/app/services/subscription_service.py` after `resource_search` exists.
- Split `frontend/src/components/SettingsTab.tsx` state/actions from rendering.
- Split `frontend/src/components/SubscriptionDialog.tsx` helper functions and flow-specific panels.
- Split `frontend/src/components/SubscriptionTab.tsx` list/detail/source/log boundaries.
- Centralize verification scripts and docs.

### P1

- Split `backend/app/services/pan115_service.py` into client, queue, file, offline, share, transfer, and QR login services.
- Move `backend/app/api/subscriptions.py` schemas and serializers out of the route module.
- Split `backend/app/services/archive_service.py` into scan, identify, plan, move, cleanup, and task repository pieces.
- Split `frontend/src/components/Pan115FilesTab.tsx`, `SearchTab.tsx`, and `AnimeTab.tsx`.

### P2

- Split ANI-RSS and MoviePilot services after the core subscription/search boundary is stable.
- Split `frontend/src/App.tsx`.
- Gradually break up `frontend/src/api/types.ts` into domain type modules while keeping a barrel export.
- Do not split `backend/app/models/models.py` first; it is import-heavy and small enough to leave until service boundaries settle.

## Guardrails

- Keep public API response shapes unchanged during extraction.
- Keep old imports working until each migration is complete.
- Prefer moving pure functions first.
- Add or update tests before behavior-affecting refactors.
- Do not introduce a generic provider base class until concrete provider adapters are already stable.
- Do not mix new product features with module extraction in the same change set.

