// STLP Mail Integration — Send Test Email.
// Admin-only. Verifies the connection end-to-end without affecting the
// automatic notification pipeline.

import { corsHeaders, jsonResponse, adminClient, requireAdmin, sendMail } from "../_shared/mailHelpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });

  const sb = adminClient();
  const admin = await requireAdmin(req, sb);
  if (!admin) return jsonResponse({ error: "Admin authentication required." }, 401);

  const body = await req.json().catch(() => ({}));
  const to = String(body.recipient || "").trim();
  if (!to) return jsonResponse({ error: "Recipient email is required." }, 400);

  const result = await sendMail(sb, {
    to,
    subject: "STLP Mail Integration — Test Email",
    html: `<p>This is a test email from the Safety Training &amp; Learning Portal (STLP).</p>
           <p>If you received this, Mail Integration is connected and working correctly.</p>`,
    eventType: "test_email",
  });

  if (!result.ok) {
    const msg = result.skipped
      ? "Email notifications are turned OFF, or this address has no real email registered."
      : "Failed to send test email: " + JSON.stringify(result.error);
    return jsonResponse({ error: msg }, 500);
  }

  return jsonResponse({ success: true });
});
