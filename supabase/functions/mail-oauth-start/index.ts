// STLP Mail Integration — Start the Google OAuth authorization flow.
// Admin-only. Returns a Google consent-screen URL for the browser to
// redirect to. Generates a one-time CSRF `state` value stored in
// mail_oauth_state, checked again by mail-oauth-callback.

import { corsHeaders, jsonResponse, adminClient, requireAdmin } from "../_shared/mailHelpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });

  const sb = adminClient();
  const admin = await requireAdmin(req, sb);
  if (!admin) return jsonResponse({ error: "Admin authentication required." }, 401);

  const { data: cfg } = await sb.from("mail_config").select("*").eq("id", 1).single();
  if (!cfg || !cfg.client_id) {
    return jsonResponse({ error: "Save the Google Client ID / Client Secret first (Step 1)." }, 400);
  }

  const state = crypto.randomUUID();
  await sb.from("mail_oauth_state").insert({ state, created_by: admin.id });

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", cfg.client_id);
  url.searchParams.set("redirect_uri", cfg.redirect_uri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "https://www.googleapis.com/auth/gmail.send");
  url.searchParams.set("access_type", "offline"); // required to receive a refresh_token
  url.searchParams.set("prompt", "consent");       // ensures a refresh_token even on reconnect
  url.searchParams.set("state", state);

  return jsonResponse({ url: url.toString() });
});
