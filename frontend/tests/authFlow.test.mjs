import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const app = readFileSync(resolve(import.meta.dirname, "../src/App.tsx"), "utf8");
const initialDataLoader = app.match(/const loadInitialData = useCallback[\s\S]*?\n  \}, \[\]\);/)?.[0] || "";
const loginHandler = app.match(/const handleLogin = async[\s\S]*?const handleLogout = async/)?.[0] || "";

assert.ok(
  !initialDataLoader.includes("archiveApi.listFolders"),
  "initial app data loading should not call 115 folder listing before the user opens a 115-dependent workflow",
);
assert.ok(loginHandler.includes("await authApi.getSession"), "login should confirm the session cookie before mounting app tabs");
assert.ok(
  /await loadInitialData\(\);\s*setAuthenticated\(true\)/.test(loginHandler),
  "login should load authenticated initial data before mounting the main app to avoid child-tab 401 races",
);

console.log("auth flow tests passed");
