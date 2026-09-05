// ============================================================================
// Shared helpers for STLP Mail Integration Edge Functions.
// Used by: mail-config, mail-oauth-start, mail-oauth-callback, mail-status,
//          mail-test, mail-send, mail-disconnect, mail-toggle.
//
// Responsibilities:
//  - Building a service-role Supabase client (server-side only, never exposed).
//  - Verifying the caller is an authenticated STLP admin.
//  - Encrypting/decrypting secrets via Postgres pgcrypto (key never stored in DB).
//  - Refreshing the Google access token when it expires.
//  - Sending a single email through the Gmail API and logging the outcome.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
  });
}

// Service-role client: full DB access, bypasses RLS. Only ever used inside
// Edge Functions, which run server-side. Never send this key to the browser.
export function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

function encryptionKey(): string {
  const k = Deno.env.get("MAIL_ENCRYPTION_KEY");
  if (!k) {
    throw new Error(
      "MAIL_ENCRYPTION_KEY secret is not set on this Edge Function. Set it with: supabase secrets set MAIL_ENCRYPTION_KEY=<random-long-string>"
    );
  }
  return k;
}

export async function encryptValue(sb: any, plain: string): Promise<string> {
  const { data, error } = await sb.rpc("_mail_encrypt", { plain, key: encryptionKey() });
  if (error) throw error;
  return data as string;
}

export async function decryptValue(sb: any, enc: string): Promise<string> {
  const { data, error } = await sb.rpc("_mail_decrypt", { enc, key: encryptionKey() });
  if (error) throw error;
  return data as string;
}

// Verifies the caller's JWT belongs to an STLP admin (profiles.role = 'admin').
// Returns the profile row, or null if not authenticated / not an admin.
export async function requireAdmin(req: Request, sb: any) {
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace("Bearer ", "");
  if (!jwt) return null;

  const { data: userData, error: userErr } = await sb.auth.getUser(jwt);
  if (userErr || !userData?.user) return null;

  const { data: profile } = await sb
    .from("profiles")
    .select("*")
    .eq("id", userData.user.id)
    .single();

  if (!profile || profile.role !== "admin") return null;
  return profile;
}

// Ensures we have a live Google access token, refreshing it via the stored
// refresh token if it has expired (or is about to). Returns the plain access
// token for immediate one-time use — it is not returned to the caller of the
// Edge Function, only used internally to call the Gmail API.
export async function getValidAccessToken(sb: any): Promise<string> {
  const { data: tokenRow } = await sb.from("mail_tokens").select("*").eq("id", 1).single();
  if (!tokenRow || !tokenRow.refresh_token_enc) {
    throw new Error("Mail Integration is not connected.");
  }

  const expiry = tokenRow.token_expiry ? new Date(tokenRow.token_expiry).getTime() : 0;
  const isExpired = !expiry || expiry < Date.now() + 60_000; // refresh 1 min early

  if (!isExpired && tokenRow.access_token_enc) {
    return await decryptValue(sb, tokenRow.access_token_enc);
  }

  const { data: cfg } = await sb.from("mail_config").select("*").eq("id", 1).single();
  if (!cfg || !cfg.client_id) throw new Error("Mail configuration is missing.");

  const clientSecret = await decryptValue(sb, cfg.client_secret_enc);
  const refreshToken = await decryptValue(sb, tokenRow.refresh_token_enc);

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.client_id,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const json = await resp.json();
  if (!resp.ok || !json.access_token) {
    throw new Error(
      "Failed to refresh Google token: " + (json.error_description || json.error || "unknown error")
    );
  }

  const newAccessEnc = await encryptValue(sb, json.access_token);
  const newExpiry = new Date(Date.now() + (json.expires_in || 3600) * 1000).toISOString();
  await sb.from("mail_tokens").update({ access_token_enc: newAccessEnc, token_expiry: newExpiry }).eq("id", 1);

  return json.access_token;
}

// Builds a base64url-encoded RFC 2822 message, as required by the Gmail
// "messages.send" API (the "raw" field).
function buildRawMessage(opts: { from: string; to: string; subject: string; html: string }): string {
  const { from, to, subject, html } = opts;
  const encodedSubject = `=?utf-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`;
  const messageParts = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=utf-8",
    "",
    html,
  ];
  const message = messageParts.join("\r\n");
  return btoa(unescape(encodeURIComponent(message)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Sends one email via Gmail API using the connected Powermech account.
// Always logs the outcome to mail_log. Never throws — callers should treat
// a falsy `ok` as "email failed/skipped, continue the underlying STLP action
// anyway" (per the "email must fail gracefully" requirement).
export async function sendMail(
  sb: any,
  opts: { to: string; subject: string; html: string; eventType: string }
): Promise<{ ok: boolean; skipped?: boolean; error?: unknown }> {
  const { to, subject, html, eventType } = opts;
  try {
    const { data: settings } = await sb.from("mail_settings").select("*").eq("id", 1).single();
    if (settings && settings.notifications_enabled === false) {
      await sb.from("mail_log").insert({
        event_type: eventType, recipient: to || "(none)", subject,
        status: "skipped", error: "Notifications are turned OFF",
      });
      return { ok: false, skipped: true };
    }

    if (!to || to.toLowerCase().endsWith("@tsl.internal")) {
      await sb.from("mail_log").insert({
        event_type: eventType, recipient: to || "(none)", subject,
        status: "skipped", error: "No real email on file for this recipient",
      });
      return { ok: false, skipped: true };
    }

    const accessToken = await getValidAccessToken(sb);
    const { data: tokenRow } = await sb.from("mail_tokens").select("connected_email").eq("id", 1).single();
    const raw = buildRawMessage({ from: tokenRow.connected_email, to, subject, html });

    const resp = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    });
    const respJson = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      await sb.from("mail_log").insert({
        event_type: eventType, recipient: to, subject,
        status: "failed", error: JSON.stringify(respJson).slice(0, 500),
      });
      return { ok: false, error: respJson };
    }

    await sb.from("mail_log").insert({ event_type: eventType, recipient: to, subject, status: "sent" });
    return { ok: true };
  } catch (e) {
    await sb.from("mail_log").insert({
      event_type: eventType, recipient: to || "(none)", subject,
      status: "failed", error: String((e as Error)?.message || e).slice(0, 500),
    });
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}
