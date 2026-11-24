export interface MetaSignupConfig {
  appId: string;
  appSecret: string;
  configId: string;
  graphVersion: string;
}

async function graph<T>(config: MetaSignupConfig, path: string, init: RequestInit, fetchImpl: typeof fetch): Promise<T> {
  try {
    const response = await fetchImpl(`https://graph.facebook.com/${config.graphVersion}/${path}`, {
      ...init, redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) return await response.json() as T;
  } catch {
    // Omit provider errors and URLs, which may carry tokens or personal data.
  }
  throw new Error("Meta management request failed");
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export async function verifyMetaSignup(
  config: MetaSignupConfig,
  input: { code: string; wabaId: string; phoneNumberId: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ token: string; displayPhone: string | null }> {
  const exchange = new URLSearchParams({ client_id: config.appId, client_secret: config.appSecret, code: input.code });
  const { access_token: token } = await graph<{ access_token?: string }>(config, `oauth/access_token?${exchange}`, {}, fetchImpl);
  if (!token || token.length > 4096) throw new Error("Meta did not return a business credential");

  const debugParams = new URLSearchParams({ input_token: token });
  const { data } = await graph<{ data?: {
    app_id?: string; is_valid?: boolean; granular_scopes?: { scope?: string; target_ids?: string[] }[];
  } }>(config, `debug_token?${debugParams}`, { headers: bearer(`${config.appId}|${config.appSecret}`) }, fetchImpl);
  const permissions = ["whatsapp_business_management", "whatsapp_business_messaging"];
  if (!data?.is_valid || data.app_id !== config.appId || !permissions.every((permission) =>
    data.granular_scopes?.some(({ scope, target_ids: targets }) =>
      scope === permission && targets?.length === 1 && targets[0] === input.wabaId))) {
    throw new Error("Meta credential does not authorize the requested WABA");
  }
  const phones = await graph<{ data?: { id?: string; display_phone_number?: string }[] }>(config, `${input.wabaId}/phone_numbers?fields=id,display_phone_number`, {
    headers: bearer(token),
  }, fetchImpl);
  const phone = phones.data?.find(({ id }) => id === input.phoneNumberId);
  if (!phone) {
    throw new Error("Meta phone does not belong to the authorized WABA");
  }
  const displayPhone = phone.display_phone_number?.replace(/[ +().-]/g, "");
  return { token, displayPhone: displayPhone && /^[1-9]\d{7,14}$/.test(displayPhone) ? displayPhone : null };
}

export async function manageMetaSubscription(
  config: MetaSignupConfig,
  wabaId: string,
  token: string,
  method: "POST" | "DELETE",
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const data = await graph<{ success?: boolean }>(config, `${wabaId}/subscribed_apps`, {
    method, headers: bearer(token),
  }, fetchImpl);
  return data.success === true;
}

export async function revokeMetaToken(
  config: MetaSignupConfig,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const params = new URLSearchParams({
    client_id: config.appId, client_secret: config.appSecret, revoke_token: token, access_token: token,
  });
  // A prior request may have revoked this token even if its response was lost.
  // Only an explicit invalid token from Meta's inspector closes local offboarding.
  await graph(config, `oauth/revoke?${params}`, {}, fetchImpl).catch(() => undefined);
  const debug = new URLSearchParams({ input_token: token });
  const confirmed = await graph<{ data?: { is_valid?: boolean } }>(config, `debug_token?${debug}`, {
    headers: bearer(`${config.appId}|${config.appSecret}`),
  }, fetchImpl);
  return confirmed.data?.is_valid === false;
}

export async function checkMetaPhone(config: MetaSignupConfig, wabaId: string, phoneNumberId: string, token: string): Promise<boolean> {
  const phones = await graph<{ data?: { id?: string }[] }>(config, `${wabaId}/phone_numbers?fields=id`, {
    headers: bearer(token),
  }, fetch);
  return phones.data?.some(({ id }) => id === phoneNumberId) ?? false;
}

export async function readMetaTemplates(config: MetaSignupConfig, wabaId: string, token: string) {
  return graph<{ data?: { id?: string; name?: string; language?: string; category?: string; status?: string }[] }>(
    config, `${wabaId}/message_templates?fields=id,name,language,category,status&limit=100`,
    { headers: bearer(token) }, fetch,
  );
}
