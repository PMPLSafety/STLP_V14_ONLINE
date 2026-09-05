// STLP Mail Integration — Connection status for the Settings page.
// Admin-only. Returns only non-sensitive fields — never a token or secret.

import { corsHeaders, jsonResponse, adminClient, requireAdmin } from "../_shared/mailHelpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });

  const sb = adminClient();
  const admin = await requireAdmin(req, sb);
  if (!admin) return jsonResponse({ error: "Admin authentication required." }, 401);

  const [{ data: cfg }, { data: tokenRow }, { data: settings }] = await Promise.all([
    sb.from("mail_config").select("client_id, redirect_uri").eq("id", 1).single(),
    sb.from("mail_tokens").select("connected_email, token_expiry").eq("id", 1).single(),
    sb.from("mail_settings").select("notifications_enabled").eq("id", 1).single(),
  ]);

  return jsonResponse({
    configured: !!(cfg && cfg.client_id),
    redirect_uri: cfg?.redirect_uri || null,
    connected: !!(tokenRow && tokenRow.connected_email),
    connected_email: tokenRow?.connected_email || null,
    notifications_enabled: settings ? settings.notifications_enabled !== false : true,
  });
});
