# Subscription Consistency Fixes

## Goal

Fix the high-impact consistency bugs found in the July 1 audit without expanding the MoviePilot/PT ownership boundary:

- local subscription deletion must clean all local child tables on every deletion path;
- MoviePilot/PT local mirror deletion must be explicit and must not be presented as cancelling the external MoviePilot subscription;
- TV precise 115 transfers must converge to a terminal local status when archive is disabled or not triggered;
- creating a 115 subscription with a fixed source must not leave a misleading half-created subscription after source binding fails;
- frontend test entry points must make existing contract drift visible.

## Boundaries

- MoviePilot owns external PT subscription execution. This fix does not invent or guess an upstream MoviePilot unsubscribe endpoint.
- MediaSync115 owns local mirror rows, local download/source/completion records, and UI wording.
- 115 fixed-source binding remains a two-call frontend flow in this pass, but the frontend must compensate if the second call fails.
- Detail page SeedHub behavior is treated as a product-contract drift: current design removed detail-page resource channels, while one test still expects them.

## Design

### 1. Local Subscription Deletion

Add one shared backend helper for local deletion:

1. Load source IDs for the target subscriptions.
2. Delete `SubscriptionSourceFile` rows for those source IDs.
3. Delete `SubscriptionSource`, `DownloadRecord`, and `MoviePilotCompletionRecord` rows.
4. Delete `Subscription` rows.

Use it for:

- `DELETE /api/subscriptions/{subscription_id}`;
- `DELETE /api/subscriptions/batch/{media_type}`;
- subscription-service automatic cleanup.

Batch deletion should exclude ANI-RSS and MoviePilot external mirrors by default. Single deletion may still remove a MoviePilot local mirror, but the response should expose that it was a local mirror deletion.

### 2. MoviePilot/PT UI Semantics

When `provider` or `external_system` is `moviepilot`, frontend delete/cancel copy must say local mirror/delete local record, not cancel PT.

Acceptance:

- no button/log/confirmation claims the external PT subscription was cancelled;
- the user sees that MoviePilot itself remains the authority for the external subscription.

### 3. TV Precise Transfer Status

After successful precise TV transfer:

- call `media_postprocess_service.trigger_archive_after_transfer(...)`;
- if archive is triggered, keep `ARCHIVING`;
- if archive is not triggered, mark the record `COMPLETED` with `completed_at`;
- store a short status reason in step-log payload where practical.

The same rule applies to the "already received" success path.

### 4. 115 Fixed Source Create Compensation

For `SubscriptionDialog` 115 creation:

- if `subscriptionApi.create()` succeeds but `createSource()` fails, delete the newly created subscription as compensation;
- refresh parent state after compensation;
- surface an error explaining that the subscription was rolled back.

This keeps the existing API contract small and avoids introducing a broad transaction endpoint in this pass.

### 5. Test Baseline

Add a frontend `test` script that runs the test families that can run in this repository:

- Python frontend contract tests;
- Node `.mjs` tests.

Do not silently include TypeScript test files unless a TS test runner is added. Resolve SeedHub detail-page drift by updating the stale test to match the current detail-tab design and keep SearchTab SeedHub coverage.

## Verification

- Backend targeted tests for deletion helper, MoviePilot batch exclusion, and TV archive-disabled convergence.
- Frontend build and test script.
- Full backend pytest before final handoff when feasible.
