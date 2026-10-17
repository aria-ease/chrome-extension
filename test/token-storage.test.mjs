import assert from "node:assert/strict";
import { test } from "node:test";
import { clearSessionToken, migrateLegacyToken, saveSessionToken } from "../chrome-mvp/token-storage.mjs";

function storageArea(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    async get(defaults) {
      return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, values.has(key) ? values.get(key) : fallback]));
    },
    async set(entries) {
      for (const [key, value] of Object.entries(entries)) values.set(key, value);
    },
    async remove(key) {
      for (const item of Array.isArray(key) ? key : [key]) values.delete(item);
    },
    has(key) { return values.has(key); },
    value(key) { return values.get(key); }
  };
}

test("migrates a persistent legacy token into session storage", async () => {
  const storage = { local: storageArea({ token: " legacy-token " }), session: storageArea() };
  assert.equal(await migrateLegacyToken(storage), "legacy-token");
  assert.equal(storage.session.value("token"), "legacy-token");
  assert.equal(storage.local.has("token"), false);
});

test("keeps the current session token and removes any persistent copy", async () => {
  const storage = {
    local: storageArea({ token: "stale-token" }),
    session: storageArea({ token: "current-token" })
  };
  assert.equal(await migrateLegacyToken(storage), "current-token");
  assert.equal(storage.local.has("token"), false);
});

test("saves and clears tokens only in session storage", async () => {
  const storage = { local: storageArea({ token: "old" }), session: storageArea() };
  assert.equal(await saveSessionToken(" new-token ", storage), "new-token");
  assert.equal(storage.session.value("token"), "new-token");
  assert.equal(storage.local.has("token"), false);
  await clearSessionToken(storage);
  assert.equal(storage.session.has("token"), false);
  assert.equal(storage.local.has("token"), false);
});
