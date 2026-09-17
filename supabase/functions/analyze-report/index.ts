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
  ai_available?: boolean;
  ai_error?: string;
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

function likelihoodName(value: unknown) {
  return String(value || "UNKNOWN").toLowerCase().replace(/_/g, " ");
}

function maxScore(items: Array<{ score?: number }>) {
  return items.reduce((highest, item) => Math.max(highest, Number(item.score) || 0), 0);
}

async function callGoogleVision(bytes: Uint8Array, reportDescription: string, mimeType: string): Promise<AnalysisResult> {
  const apiKey = Deno.env.get("GOOGLE_VISION_API_KEY");
  if (!apiKey) throw new Error("Google Vision is not configured");

  const endpoint = `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [{
        image: { content: imageToBase64(bytes) },
        features: [
          { type: "LABEL_DETECTION", maxResults: 20 },
          { type: "OBJECT_LOCALIZATION", maxResults: 20 },
          { type: "SAFE_SEARCH_DETECTION" },
        ],
      }],
    }),
  });
  const payload = await response.json().catch(() => ({}));
  const visionResponse = payload?.responses?.[0] || {};
  if (!response.ok || visionResponse.error) {
    throw new Error(`Google Vision request failed (${response.status}): ${visionResponse.error?.message || "unknown error"}`);
  }

  const labels = Array.isArray(visionResponse.labelAnnotations) ? visionResponse.labelAnnotations : [];
  const objects = Array.isArray(visionResponse.localizedObjectAnnotations) ? visionResponse.localizedObjectAnnotations : [];
  const motorcyclePattern = /motorcycle|motorbike|scooter|moped|จักรยานยนต์|มอเตอร์ไซค์/i;
  const motorcycleLabels = labels.filter((item: any) => motorcyclePattern.test(String(item.description || "")));
  const motorcycleObjects = objects.filter((item: any) => motorcyclePattern.test(String(item.name || "")));
  const isMotorcycle = motorcycleLabels.length > 0 || motorcycleObjects.length > 0;
  const confidence = Math.round(Math.max(maxScore(motorcycleLabels), maxScore(motorcycleObjects)) * 100);
  const safe = visionResponse.safeSearchAnnotation || {};
  const safetyFlags = Object.entries(safe)
    .filter(([, value]) => !["unknown", "very unlikely", "unlikely"].includes(likelihoodName(value)))
    .map(([name, value]) => `${name}: ${likelihoodName(value)}`);
  const detectedLabels = labels.slice(0, 6).map((item: any) => item.description).filter(Boolean);
  const detectedObjects = objects.slice(0, 6).map((item: any) => item.name).filter(Boolean);

  const notes = [
    `Google Vision ตรวจด้วยภาพชนิด ${mimeType || "ไม่ระบุ"}`,
    `คำอธิบายผู้แจ้ง: ${reportDescription || "ไม่มี"}`,
    detectedLabels.length ? `ป้ายกำกับ: ${detectedLabels.join(", ")}` : "ไม่พบป้ายกำกับที่ชัดเจน",
    detectedObjects.length ? `วัตถุ: ${detectedObjects.join(", ")}` : "ไม่พบวัตถุที่ชัดเจน",
    safetyFlags.length ? `สัญญาณเนื้อหาที่ควรตรวจสอบ: ${safetyFlags.join(", ")}` : "ไม่พบสัญญาณเนื้อหาเสี่ยงจาก SafeSearch",
    "ผลนี้เป็นการช่วยคัดกรอง ไม่ใช่คำตัดสินลงโทษแทน Admin",
  ].join(" | ");

  return {
    is_motorcycle: isMotorcycle,
    violation_type: isMotorcycle ? "ตรวจพบรถจักรยานยนต์ — รอ Admin ตรวจสอบการจอด" : "ไม่พบรถจักรยานยนต์ชัดเจน",
    confidence: Math.max(0, Math.min(100, confidence)),
    evidence_notes: notes.slice(0, 500),
  };
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
    let result: AnalysisResult;
    try {
      result = await callGoogleVision(bytes, report.description, file.type || "image/jpeg");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Google Vision analysis failed";
      const billingDisabled = message.includes("BILLING_DISABLED") || message.toLowerCase().includes("billing");
      result = {
        is_motorcycle: false,
        violation_type: "ยังยืนยันไม่ได้ — Admin ต้องตรวจเอง",
        confidence: 0,
        evidence_notes: billingDisabled
          ? "Google Vision ยังใช้ไม่ได้: โปรเจกต์ยังไม่เปิด Billing จึงต้องให้ Admin ตรวจหลักฐานเอง"
          : `Google Vision วิเคราะห์ไม่ได้: ${message}`.slice(0, 500),
        ai_available: false,
        ai_error: message.slice(0, 240),
      };
    }
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
