// STLP Mail Integration — Toggle automatic email notifications ON/OFF.
// Admin-only. Does not disconnect the Google account — only pauses sending.

import { corsHeaders, jsonResponse, adminClient, requireAdmin } from "../_shared/mailHelpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });

  const sb = adminClient();
  const admin = await requireAdmin(req, sb);
  if (!admin) return jsonResponse({ error: "Admin authentication required." }, 401);

  const body = await req.json().catch(() => ({}));
  const enabled = !!body.enabled;

  const { error } = await sb.from("mail_settings").upsert({ id: 1, notifications_enabled: enabled });
  if (error) return jsonResponse({ error: error.message }, 500);

  return jsonResponse({ success: true, notifications_enabled: enabled });
});
