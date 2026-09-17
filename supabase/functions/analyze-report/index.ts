import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type AnalysisResult = {
  is_motorcycle: boolean;
  violation_type: string;
  confidence: number;
  evidence_notes: string;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function imageToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function extractText(payload: any) {
  if (typeof payload === "string") return payload;
  const read = (value: any): string => {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map(read).filter(Boolean).join("\n");
    if (value && typeof value === "object") return read(value.text ?? value.content ?? value.value ?? value.output ?? value.response ?? value.result ?? value.generated_text ?? value.message);
    return "";
  };
  const candidates = [
    payload?.choices?.[0]?.message?.content,
    payload?.choices?.[0]?.text,
    payload?.output_text,
    payload?.text,
    payload?.response,
    payload?.result,
    payload?.generated_text,
    payload?.data,
    payload?.candidates?.[0]?.content?.parts,
    payload?.output,
  ];
  for (const candidate of candidates) {
    const text = read(candidate);
    if (text) return text;
  }
  return "";
}

function parseModelJson(text: string): AnalysisResult {
  const cleaned = text.replace(/```json|```/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("AI response was not valid JSON");
  const value = JSON.parse(cleaned.slice(start, end + 1));
  let confidence = Number(value.confidence);
  if (!Number.isFinite(confidence)) confidence = 0;
  if (confidence >= 0 && confidence <= 1) confidence *= 100;
  confidence = Math.max(0, Math.min(100, Math.round(confidence)));
  return {
    is_motorcycle: Boolean(value.is_motorcycle),
    violation_type: String(value.violation_type || "ไม่ระบุ").slice(0, 120),
    confidence,
    evidence_notes: String(value.evidence_notes || "ไม่มีหมายเหตุเพิ่มเติม").slice(0, 500),
  };
}

async function callIntelSphere(imageDataUrl: string, reportDescription: string) {
  const endpoint = Deno.env.get("INTELSPHERE_API_URL");
  const apiKey = Deno.env.get("INTELSPHERE_API_KEY");
  const model = Deno.env.get("INTELSPHERE_MODEL") || "default";
  if (!endpoint || !apiKey) throw new Error("IntelSphere is not configured");

  const prompt = `ตรวจภาพหลักฐานสำหรับระบบ KKU ParkFlow โดยใช้คำอธิบายผู้แจ้ง: ${reportDescription || "ไม่มี"}
พิจารณาเฉพาะรถจักรยานยนต์และการจอดกีดขวาง/ผิดพื้นที่ ห้ามตัดสินลงโทษแทนเจ้าหน้าที่
ตอบเป็น JSON เท่านั้น ตามรูปแบบนี้:
{"is_motorcycle":true,"violation_type":"จอดบนทางเท้า","confidence":0-100,"evidence_notes":"..."}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: imageDataUrl } },
      ] }],
    }),
  });
  const raw = await response.text();
  let payload: any = raw;
  try { payload = JSON.parse(raw); } catch { /* Some gateways return plain text. */ }
  if (!response.ok) throw new Error(`IntelSphere request failed (${response.status})`);
  const text = extractText(payload);
  if (text) return parseModelJson(text);
  if (payload && typeof payload === "object" && ("violation_type" in payload || "is_motorcycle" in payload || "confidence" in payload)) {
    return parseModelJson(JSON.stringify(payload));
  }
  throw new Error("AI response did not contain readable text");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceRoleKey) return json({ error: "Supabase function is not configured" }, 500);
    const authorization = request.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) return json({ error: "Authentication required" }, 401);
    const accessToken = authorization.slice("Bearer ".length);
    const authClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await authClient.auth.getUser(accessToken);
    if (authError || !authData.user) return json({ error: "Invalid session" }, 401);
    const adminClient = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: profile } = await adminClient.from("profiles").select("role").eq("id", authData.user.id).maybeSingle();
    const { reportId } = await request.json();
    if (!reportId) return json({ error: "reportId is required" }, 400);
    const { data: report, error: reportError } = await adminClient.from("reports")
      .select("id, reporter_id, evidence_path, description, violation_type")
      .eq("id", reportId).single();
    if (reportError || !report) return json({ error: "Report not found" }, 404);
    const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";
    if (!isAdmin && report.reporter_id !== authData.user.id) return json({ error: "Forbidden" }, 403);
    if (!report.evidence_path) return json({ error: "Evidence image is missing" }, 400);
    const { data: file, error: fileError } = await adminClient.storage.from("evidence").download(report.evidence_path);
    if (fileError || !file) return json({ error: "Evidence image could not be read" }, 404);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await callIntelSphere(`data:${file.type || "image/jpeg"};base64,${imageToBase64(bytes)}`, report.description);
    const { data: updated, error: updateError } = await adminClient.from("reports").update({
      ai_confidence: result.confidence,
      ai_flags: result,
      violation_type: report.violation_type || result.violation_type,
    }).eq("id", reportId).select().single();
    if (updateError) throw updateError;
    return json({ report: updated, analysis: result });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "AI analysis failed" }, 500);
  }
});
