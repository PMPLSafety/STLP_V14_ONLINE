// STLP Mail Integration — Disconnect / Remove Configuration.
// Admin-only. Best-effort revokes the Google OAuth token, then always
// deletes the locally stored (encrypted) tokens regardless of revoke result,
// so automatic emails stop immediately either way.

import { corsHeaders, jsonResponse, adminClient, requireAdmin, decryptValue } from "../_shared/mailHelpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });

  const sb = adminClient();
  const admin = await requireAdmin(req, sb);
  if (!admin) return jsonResponse({ error: "Admin authentication required." }, 401);

  const { data: tokenRow } = await sb.from("mail_tokens").select("*").eq("id", 1).single();

  if (tokenRow?.refresh_token_enc) {
    try {
      const refreshToken = await decryptValue(sb, tokenRow.refresh_token_enc);
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: refreshToken }),
      });
    } catch (_e) {
      // Best-effort revoke only — local cleanup below still proceeds.
    }
  }

  await sb.from("mail_tokens").delete().eq("id", 1);

  return jsonResponse({ success: true });
});
