import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const searchTab = readFileSync(resolve(import.meta.dirname, "../src/components/SearchTab.tsx"), "utf8");
const mediaDetailTab = readFileSync(resolve(import.meta.dirname, "../src/components/MediaDetailTab.tsx"), "utf8");

for (const [name, source] of [
  ["SearchTab", searchTab],
  ["MediaDetailTab", mediaDetailTab],
]) {
  assert.ok(
    source.includes("createMovieSeedhubMagnetTask"),
    `${name} should expose SeedHub background task creation for movies`,
  );
  assert.ok(
    source.includes("createTvSeedhubMagnetTask"),
    `${name} should expose SeedHub background task creation for TV`,
  );
  assert.ok(
    source.includes("getSeedhubMagnetTask"),
    `${name} should poll SeedHub background task status`,
  );
  assert.ok(
    source.includes("cancelSeedhubMagnetTask"),
    `${name} should expose SeedHub background task cancellation`,
  );
}

assert.match(
  readFileSync(resolve(import.meta.dirname, "../src/api/search.ts"), "utf8"),
  /createTvSeedhubMagnetTask:\s*\([^)]*season[^)]*\)[\s\S]*params:\s*\{\s*season,\s*limit,\s*force_refresh/s,
  "TV SeedHub task API should pass the selected season to the backend",
);

console.log("seedhub task exposure tests passed");
