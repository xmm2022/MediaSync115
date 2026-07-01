import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const animeTab = readFileSync(resolve(root, "src/components/AnimeTab.tsx"), "utf8");

assert.ok(
  animeTab.includes("const [busyCounts, setBusyCounts]"),
  "AnimeTab should track busy state per action instead of using one shared busy key",
);

assert.ok(
  animeTab.includes("startBusy") && animeTab.includes("stopBusy") && !animeTab.includes("setBusyKey"),
  "AnimeTab action busy state should be reference-counted and must not use the legacy setBusyKey reset",
);

assert.ok(
  animeTab.includes("subscriptionRequestSeq") &&
    animeTab.includes("requestId !== subscriptionRequestSeq.current"),
  "AnimeTab subscription loads should ignore stale responses",
);

assert.ok(
  animeTab.includes("addPanelGeneration") &&
    animeTab.includes("generation !== addPanelGeneration.current"),
  "AnimeTab add panel requests should be invalidated when the form is reset or retargeted",
);

assert.ok(
  animeTab.includes("const resetAddForm = useCallback") &&
    animeTab.includes("onClick={closeAddPanel}") &&
    animeTab.includes("resetAddForm();\n      await loadSubscriptions(false, true);"),
  "AnimeTab should reset the add form on close and after a successful create",
);

assert.equal(
  Array.from(animeTab.matchAll(/disabled=\{!canSubmitAniRss \|\| addSubmitBusy\}/g)).length,
  2,
  "AnimeTab preview and create buttons should block each other while either submit action is running",
);

assert.ok(
  animeTab.includes("getAniDisplayStatus") && animeTab.includes("item.recent_error"),
  "AnimeTab should surface recent_error in the same display status used by filters and badges",
);

console.log("anime tab state tests passed");
