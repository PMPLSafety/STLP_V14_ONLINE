// STLP Mail Integration — Save Google OAuth Client ID / Client Secret.
// Admin-only. The Client Secret is encrypted before it ever touches the
// database and is never returned to the browser again.

import { corsHeaders, jsonResponse, adminClient, requireAdmin, encryptValue } from "../_shared/mailHelpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });

  const sb = adminClient();
  const admin = await requireAdmin(req, sb);
  if (!admin) return jsonResponse({ error: "Admin authentication required." }, 401);

  try {
    const body = await req.json();
    const clientId = String(body.client_id || "").trim();
    const clientSecret = String(body.client_secret || "").trim();
    const redirectUri = String(body.redirect_uri || "").trim();

    if (!clientId || !clientSecret || !redirectUri) {
      return jsonResponse(
        { error: "Client ID, Client Secret and Redirect URI are all required." },
        400
      );
    }

    const clientSecretEnc = await encryptValue(sb, clientSecret);

    const { error } = await sb.from("mail_config").upsert({
      id: 1,
      client_id: clientId,
      client_secret_enc: clientSecretEnc,
      redirect_uri: redirectUri,
      updated_at: new Date().toISOString(),
      updated_by: admin.id,
    });

    if (error) return jsonResponse({ error: error.message }, 500);
    return jsonResponse({ success: true });
  } catch (e) {
    return jsonResponse({ error: String((e as Error)?.message || e) }, 500);
  }
});
