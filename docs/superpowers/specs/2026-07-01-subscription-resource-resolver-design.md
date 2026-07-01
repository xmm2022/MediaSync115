# Subscription Resource Resolver Extraction Design

## Goal

Extract the subscription source waterfall from `SubscriptionService._fetch_resources()` so source ordering, attempt metadata, source traces, offline append behavior, and final quality filtering live in a focused subscription module.

## Scope

Move only the orchestration inside `_fetch_resources()` into `backend/app/services/subscriptions/resource_resolver.py`:

- resolve the active source order from either an explicit order or a callback
- append source-order and empty-order traces
- try Pansou, HDHive, and TG sources in priority order
- record per-source attempts and stop once a primary source returns usable resources
- apply resolution sorting and quality filtering in the same order as today
- run HDHive locked-resource preparation through an injected callback
- exclude already-tried URLs before moving to the next source
- append offline magnet resources after primary source selection
- build the final source attempt metadata and quality preference traces

This change does not move source-specific fetch implementations, runtime settings, HDHive unlock internals, operation log implementation, Kafka implementation, transfer logic, cleanup, database writes, or subscription run orchestration.

## Architecture

The new module exposes `resolve_subscription_resources()` plus a `ResourceResolverDependencies` dataclass. Dependencies are callbacks for source fetchers, offline fetcher, source order resolution, resolution/quality preference resolution, HDHive preparation, URL exclusion, source fetch logging, and source attempt event emission.

`SubscriptionService._fetch_resources()` remains the compatibility entry point. It constructs `ResourceResolverDependencies` from existing private methods and service functions, then delegates to the new helper. Existing tests that monkeypatch `_fetch_from_pansou`, `_fetch_from_hdhive`, `_fetch_from_tg`, `_fetch_offline_magnets`, or `_prepare_hdhive_locked_resources` must continue to work.

The new module must not import `SubscriptionService`, runtime settings, operation log service, Kafka producer, database models/sessions, API routes, or source-specific services.

## Behavior

The extracted behavior remains compatible:

- Empty active source order returns no resources and a `summary` of `无可用来源`.
- Source fetch exceptions become warning traces, failed attempt metadata, and do not stop the waterfall.
- A successful primary source stops later primary-source fetches.
- If all resources from a source are excluded by attempted URLs, the attempt becomes `empty` and the waterfall continues.
- HDHive resources are resolution-sorted, quality-filtered, and auto-unlocked before URL exclusion.
- Non-HDHive primary resources are resolution-sorted before URL exclusion.
- Offline resources are fetched after the primary source loop and appended when available.
- The final global quality filter still applies to all primary and offline resources.
- Source attempt log/event side effects remain best-effort through injected callbacks.

## Testing

Extend `backend/tests/test_fetch_resources_waterfall.py` with direct tests for the new helper module, including first-source stop, excluded-source fallback, empty source order, and dependency boundaries. Keep the existing `SubscriptionService._fetch_resources()` tests to prove wrapper compatibility.
