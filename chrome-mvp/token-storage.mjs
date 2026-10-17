export async function migrateLegacyToken(storage = chrome.storage) {
  const [sessionValues, localValues] = await Promise.all([
    storage.session.get({ token: "" }),
    storage.local.get({ token: "" })
  ]);
  const sessionToken = typeof sessionValues.token === "string" ? sessionValues.token.trim() : "";
  const legacyToken = typeof localValues.token === "string" ? localValues.token.trim() : "";
  const token = sessionToken || legacyToken;
  if (!sessionToken && legacyToken) await storage.session.set({ token: legacyToken });
  await storage.local.remove("token");
  return token;
}

export async function saveSessionToken(token, storage = chrome.storage) {
  const normalized = typeof token === "string" ? token.trim() : "";
  if (!normalized) throw new Error("Enter the bearer token printed by the local service.");
  await Promise.all([
    storage.session.set({ token: normalized }),
    storage.local.remove("token")
  ]);
  return normalized;
}

export async function clearSessionToken(storage = chrome.storage) {
  await Promise.all([
    storage.session.remove("token"),
    storage.local.remove("token")
  ]);
}
