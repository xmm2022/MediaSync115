import assert from "node:assert/strict";
import api from "../src/api/client";
import { archiveApi } from "../src/api/archive";
import { quarkApi } from "../src/api/quark";

const originalGet = api.get;

try {
  (api as unknown as { get: typeof api.get }).get = (async (url: string) => {
    if (url === "/archive/folders") {
      return {
        data: {
          cid: "0",
          folders: [{ cid: "100", name: "Movies" }],
        },
      };
    }
    if (url === "/archive/tasks") {
      return {
        data: {
          items: [{ id: 1, status: "processing" }],
          total: 1,
          limit: 50,
          offset: 0,
        },
      };
    }
    if (url === "/quark/folders") {
      return {
        data: {
          folders: [{ fid: "abc", file_name: "Quark Movies", pdir_fid: "0" }],
          total: 1,
          page: 1,
          size: 200,
        },
      };
    }
    throw new Error(`unexpected GET ${url}`);
  }) as typeof api.get;

  const folders = await archiveApi.listFolders("0");
  assert.deepEqual(
    folders.data,
    [{ cid: "100", name: "Movies" }],
    "archive folder responses return folders under the folders key",
  );

  const tasks = await archiveApi.listTasks();
  assert.deepEqual(
    tasks.data,
    [{ id: 1, status: "processing" }],
    "archive task responses return task rows under the items key",
  );

  const quarkFolders = await quarkApi.listFolders("0");
  assert.deepEqual(
    quarkFolders.data,
    [{ fid: "abc", file_name: "Quark Movies", pdir_fid: "0", name: "Quark Movies" }],
    "quark folder responses return folders under the folders key and expose a name field",
  );
} finally {
  (api as unknown as { get: typeof api.get }).get = originalGet;
}

console.log("archive API normalization tests passed");
