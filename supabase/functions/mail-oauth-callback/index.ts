// STLP Mail Integration — OAuth callback (Google redirects here directly).
// PUBLIC endpoint (Google's browser redirect carries no STLP session/JWT) —
// protected instead by the one-time `state` value issued by mail-oauth-start.
// Exchanges the authorization code for tokens, stores them encrypted, then
// redirects the browser back to the STLP app with a simple status flag.
// The browser NEVER sees the access_token or refresh_token at any point.

import { adminClient, encryptValue, decryptValue } from "../_shared/mailHelpers.ts";

Deno.serve(async (req) => {
  const sb = adminClient();
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  // Set this to your deployed STLP site (e.g. https://stlp.powermech.example)
  // as an Edge Function secret: STLP_SITE_URL
  const siteUrl = Deno.env.get("STLP_SITE_URL") || "";

  const redirectBack = (status: string, msg = "") =>
    Response.redirect(
      `${siteUrl}/?mailoauth=${status}${msg ? `&msg=${encodeURIComponent(msg)}` : ""}`,
      302
    );

  if (errorParam) return redirectBack("error", errorParam);
  if (!code || !state) return redirectBack("error", "Missing code or state from Google.");

  const { data: stateRow } = await sb.from("mail_oauth_state").select("*").eq("state", state).single();
  if (!stateRow) {
    return redirectBack("error", "Invalid or expired authorization attempt. Please try connecting again.");
  }
  await sb.from("mail_oauth_state").delete().eq("state", state); // one-time use only

  const { data: cfg } = await sb.from("mail_config").select("*").eq("id", 1).single();
  if (!cfg || !cfg.client_id) return redirectBack("error", "Mail configuration is missing.");

  let clientSecret: string;
  try {
    clientSecret = await decryptValue(sb, cfg.client_secret_enc);
  } catch (e) {
    return redirectBack("error", "Could not decrypt stored Client Secret.");
  }

  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: cfg.client_id,
      client_secret: clientSecret,
      redirect_uri: cfg.redirect_uri,
      grant_type: "authorization_code",
    }),
  });
  const tokenJson = await tokenResp.json();

  if (!tokenResp.ok || !tokenJson.access_token) {
    return redirectBack("error", tokenJson.error_description || "Google token exchange failed.");
  }
  if (!tokenJson.refresh_token) {
    return redirectBack(
      "error",
      "Google did not return a refresh token. In your Google Account > Security > Third-party access, remove any prior access for this app, then try connecting again."
    );
  }

  const profileResp = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  const profileJson = await profileResp.json().catch(() => ({}));
  const connectedEmail = profileJson.email || "(unknown)";

  const accessEnc = await encryptValue(sb, tokenJson.access_token);
  const refreshEnc = await encryptValue(sb, tokenJson.refresh_token);
  const expiry = new Date(Date.now() + (tokenJson.expires_in || 3600) * 1000).toISOString();

  await sb.from("mail_tokens").upsert({
    id: 1,
    connected_email: connectedEmail,
    access_token_enc: accessEnc,
    refresh_token_enc: refreshEnc,
    token_expiry: expiry,
    connected_at: new Date().toISOString(),
    connected_by: stateRow.created_by,
  });

  return redirectBack("success");
});
