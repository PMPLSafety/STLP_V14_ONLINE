// STLP Mail Integration — Central Mail Notification Service.
// Called by existing STLP modules (training assignment, certificate issuance,
// manual notifications) right after their own DB action succeeds. Requires
// any valid logged-in STLP session (not admin-only, since e.g. a user passing
// their own assessment triggers "certificate_issued" for themself) — but the
// recipient is always resolved server-side from `recipient_profile_id`, so a
// caller can never make Gmail send to an arbitrary address, and the event
// type is restricted to a fixed allow-list.

import { corsHeaders, jsonResponse, adminClient, sendMail } from "../_shared/mailHelpers.ts";

const ALLOWED_EVENTS = new Set([
  "training_assigned",
  "training_completed",
  "certificate_issued",
  "manual_notification",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });

  const sb = adminClient();

  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace("Bearer ", "");
  const { data: userData, error: userErr } = await sb.auth.getUser(jwt);
  if (userErr || !userData?.user) return jsonResponse({ error: "Authentication required." }, 401);

  const body = await req.json().catch(() => ({}));
  const eventType = String(body.event_type || "");
  const recipientProfileId = body.recipient_profile_id;
  const subject = String(body.subject || "").trim();
  const html = body.html || `<p>${String(body.message || "").trim()}</p>`;

  if (!ALLOWED_EVENTS.has(eventType)) return jsonResponse({ error: "Unknown event_type." }, 400);
  if (!recipientProfileId || !subject) {
    return jsonResponse({ error: "recipient_profile_id and subject are required." }, 400);
  }

  const { data: recipientProfile } = await sb
    .from("profiles")
    .select("username")
    .eq("id", recipientProfileId)
    .single();

  const to = recipientProfile?.username || "";

  const result = await sendMail(sb, { to, subject, html, eventType });
  return jsonResponse({ success: result.ok, skipped: !!result.skipped });
});
