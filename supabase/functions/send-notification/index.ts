import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function providerError(payload: unknown, status: number) {
  if (payload && typeof payload === "object") {
    const value = payload as Record<string, unknown>;
    const message = value.message || value.error || value.name;
    const nested = value.data && typeof value.data === "object" ? value.data as Record<string, unknown> : null;
    const nestedMessage = nested?.error || nested?.message || nested?.error_code;
    if (message) return `${message} (SMTP2GO ${status})`;
    if (nestedMessage) return `${nestedMessage} (SMTP2GO ${status})`;
  }
  return `SMTP2GO API error (${status})`;
}

function parseSender(value: string) {
  const match = value.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return match ? { name: match[1].trim(), email: match[2].trim() } : { email: value.trim() };
}

function htmlEscape(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[character] || character));
}

async function markStatus(adminClient: ReturnType<typeof createClient>, id: string, status: string) {
  const { error } = await adminClient.from("notification_queue").update({
    status,
    sent_at: status === "SENT" ? new Date().toISOString() : null,
  }).eq("id", id);
  if (error) throw error;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const smtp2goKey = Deno.env.get("SMTP2GO_API_KEY");
    const from = Deno.env.get("MAIL_FROM");
    if (!url || !anonKey || !serviceRoleKey) return json({ error: "Supabase function is not configured" }, 500);
    if (!smtp2goKey || !from) {
      return json({
        error: "ยังไม่ได้ตั้งค่า SMTP2GO_API_KEY และ MAIL_FROM",
        code: "EMAIL_PROVIDER_NOT_CONFIGURED",
      }, 503);
    }

    const authorization = request.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) return json({ error: "Authentication required" }, 401);
    const accessToken = authorization.slice("Bearer ".length);
    const authClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await authClient.auth.getUser(accessToken);
    if (authError || !authData.user) return json({ error: "Invalid session" }, 401);

    const adminClient = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: profile } = await adminClient.from("profiles").select("role").eq("id", authData.user.id).maybeSingle();
    if (!["admin", "super_admin"].includes(profile?.role || "")) return json({ error: "Forbidden" }, 403);

    const { notificationId } = await request.json();
    if (!notificationId) return json({ error: "notificationId is required" }, 400);
    const { data: notification, error: notificationError } = await adminClient.from("notification_queue")
      .select("id, report_id, recipient_email, subject, body, status")
      .eq("id", notificationId).single();
    if (notificationError || !notification) return json({ error: "Notification not found" }, 404);
    if (notification.status === "SENT") return json({ message: "ส่งอีเมลไปแล้ว", status: "SENT" });
    if (!notification.recipient_email) {
      await markStatus(adminClient, notification.id, "NO_RECIPIENT");
      return json({ message: "ไม่พบอีเมลผู้รับ", status: "NO_RECIPIENT" });
    }

    const textBody = String(notification.body || "");
    const htmlBody = `<div style="font-family:Arial,sans-serif;line-height:1.7"><h2>${htmlEscape(String(notification.subject))}</h2><p>${htmlEscape(textBody).replace(/\n/g, "<br>")}</p><hr><small>ส่งจาก KKU ParkFlow</small></div>`;
    const mailResponse = await fetch("https://api.smtp2go.com/v3/email/send", {
      method: "POST",
      headers: {
        "X-Smtp2go-Api-Key": smtp2goKey,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: smtp2goKey,
        sender: parseSender(from).email,
        to: [notification.recipient_email],
        subject: notification.subject,
        text_body: textBody,
        html_body: htmlBody,
      }),
    });
    const mailPayload = await mailResponse.json().catch(() => ({}));
    if (!mailResponse.ok) {
      await markStatus(adminClient, notification.id, "FAILED");
      return json({
        error: `ส่งอีเมลผ่าน SMTP2GO ไม่สำเร็จ: ${providerError(mailPayload, mailResponse.status)}`,
        code: "EMAIL_PROVIDER_REJECTED",
        status: "FAILED",
      }, 502);
    }
    await markStatus(adminClient, notification.id, "SENT");
    return json({
      message: `ส่งอีเมลไปที่ ${notification.recipient_email} แล้ว`,
      status: "SENT",
      providerId: mailPayload?.email_response?.email_id || mailPayload?.request_id || null,
    });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Notification sending failed" }, 500);
  }
});
