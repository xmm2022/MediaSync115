import assert from "node:assert/strict";
import {
  ACTIVE_ARCHIVE_TASK_STATUS,
  LOG_TOTAL_LIST_PARAMS,
  DEFAULT_EXPLORE_BOARD,
  getExplorePosterSrc,
} from "../src/utils/runtimeDefaults";

assert.equal(
  ACTIVE_ARCHIVE_TASK_STATUS,
  "processing",
  "archive task filters must use backend ArchiveStatus values",
);

assert.deepEqual(
  LOG_TOTAL_LIST_PARAMS,
  { limit: 1 },
  "logs API rejects limit=0; request one item and read total from pagination metadata",
);

assert.equal(
  DEFAULT_EXPLORE_BOARD,
  "douban",
  "the default explore board should work without a TMDB API key",
);

assert.equal(
  getExplorePosterSrc("https://img9.doubanio.com/view/photo/m_ratio_poster/public/p2933012346.webp"),
  "/api/search/explore/poster?url=https%3A%2F%2Fimg9.doubanio.com%2Fview%2Fphoto%2Fm_ratio_poster%2Fpublic%2Fp2933012346.webp",
  "remote poster URLs should go through the backend poster proxy",
);

assert.equal(
  getExplorePosterSrc("data:image/svg+xml,%3Csvg%3E%3C/svg%3E"),
  "data:image/svg+xml,%3Csvg%3E%3C/svg%3E",
  "data URLs should not be proxied",
);

assert.equal(
  getExplorePosterSrc(""),
  "",
  "empty poster URLs should stay empty so callers can apply their own fallback",
);

console.log("runtime default tests passed");
