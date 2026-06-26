import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

function source(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

const app = source("src/App.tsx");
const dashboard = source("src/components/DashboardTab.tsx");
const usage = source("src/components/UsageTab.tsx");
const explore = source("src/components/ExploreTab.tsx");

assert.ok(
  !app.includes('status: "archiving"') && !dashboard.includes('status: "archiving"'),
  "archive task filters must not send the legacy archiving status",
);

assert.ok(
  !usage.includes("limit: 0"),
  "logs API calls must not request limit=0 because the backend rejects it",
);

assert.ok(
  !explore.includes('useState<BoardKey>("tmdb")'),
  "explore should not default to TMDB because it requires a configured TMDB API key",
);

assert.ok(
  explore.includes("getExplorePosterSrc"),
  "explore posters should use the backend poster proxy helper",
);

console.log("runtime default usage tests passed");
