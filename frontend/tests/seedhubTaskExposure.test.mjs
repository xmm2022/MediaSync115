import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const searchTab = readFileSync(resolve(import.meta.dirname, "../src/components/SearchTab.tsx"), "utf8");
const mediaDetailTab = readFileSync(resolve(import.meta.dirname, "../src/components/MediaDetailTab.tsx"), "utf8");

assert.ok(
  searchTab.includes("createMovieSeedhubMagnetTask"),
  "SearchTab should expose SeedHub background task creation for movies",
);
assert.ok(
  searchTab.includes("createTvSeedhubMagnetTask"),
  "SearchTab should expose SeedHub background task creation for TV",
);
assert.ok(
  searchTab.includes("getSeedhubMagnetTask"),
  "SearchTab should poll SeedHub background task status",
);
assert.ok(
  searchTab.includes("cancelSeedhubMagnetTask"),
  "SearchTab should expose SeedHub background task cancellation",
);

assert.ok(
  mediaDetailTab.includes("相似影片推荐"),
  "MediaDetailTab should keep the refactored recommendations section",
);
assert.ok(
  !mediaDetailTab.includes("createMovieSeedhubMagnetTask"),
  "MediaDetailTab should not reintroduce the removed resource-channel task creation",
);
assert.ok(
  !mediaDetailTab.includes("cancelSeedhubMagnetTask"),
  "MediaDetailTab should not reintroduce removed resource-channel cancellation",
);

assert.match(
  readFileSync(resolve(import.meta.dirname, "../src/api/search.ts"), "utf8"),
  /createTvSeedhubMagnetTask:\s*\([^)]*season[^)]*\)[\s\S]*params:\s*\{\s*season,\s*limit,\s*force_refresh/s,
  "TV SeedHub task API should pass the selected season to the backend",
);

console.log("seedhub task exposure tests passed");
