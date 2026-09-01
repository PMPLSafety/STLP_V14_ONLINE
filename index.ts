// supabase/functions/send-push-notification/index.ts
//
// Called two ways:
//   1. By the database triggers in push_notifications_setup.sql (new
//      Notification added, or a Training gets published) — no auth header.
//   2. Optionally, directly by an Admin action in future, the same way.
//
// Deploy with:  supabase functions deploy send-push-notification --no-verify-jwt
// (No-verify-jwt is required because DB triggers call this with no user JWT.)
//
// Required secrets (Project Settings > Edge Functions > Secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
// (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are already available by default.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "https://esm.sh/web-push@3.6.7";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
    const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
    const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";

    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

    const { title, body, url } = await req.json();
    if (!title) return json({ error: "title is required" }, 400);

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: subs, error: subsErr } = await adminClient
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth");

    if (subsErr) return json({ error: subsErr.message }, 500);
    if (!subs || subs.length === 0) return json({ sent: 0, message: "No subscriptions." });

    const payload = JSON.stringify({ title, body: body || "", url: url || "./index.html" });

    const staleIds: string[] = [];
    let sent = 0;

    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: s.endpoint,
              keys: { p256dh: s.p256dh, auth: s.auth },
            },
            payload
          );
          sent++;
        } catch (err: any) {
          // 404/410 = subscription is no longer valid (user uninstalled, cleared data, etc.)
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            staleIds.push(s.id);
          }
        }
      })
    );

    if (staleIds.length) {
      await adminClient.from("push_subscriptions").delete().in("id", staleIds);
    }

    return json({ sent, removed_stale: staleIds.length, total_subscriptions: subs.length });
  } catch (e) {
    return json({ error: e?.message || "Unexpected error." }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
