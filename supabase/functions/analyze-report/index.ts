import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type AnalysisResult = {
  is_motorcycle: boolean;
  ai_triage: "MATCH" | "NO_MATCH" | "MANUAL_REVIEW";
  violation_type: string;
  confidence: number;
  evidence_notes: string;
  ai_available?: boolean;
  ai_error?: string;
  ai_image_available?: boolean;
  ai_generated?: boolean;
  ai_image_confidence?: number;
  ai_image_label?: string;
  ai_image_error?: string;
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

function maxScore(items: Array<{ score?: number }>) {
  return items.reduce((highest, item) => Math.max(highest, Number(item.score) || 0), 0);
}

async function callHuggingFaceModel(
  bytes: Uint8Array,
  token: string,
  model: string,
  parameters: Record<string, unknown>,
) {
  const endpoint = `https://router.huggingface.co/hf-inference/models/${model}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      inputs: imageToBase64(bytes),
      parameters,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(payload)) {
    const apiError = payload?.error || payload?.message || "unknown error";
    throw new Error(`Hugging Face request failed (${response.status}): ${apiError}`);
  }
  return payload;
}

async function callHuggingFace(bytes: Uint8Array, reportDescription: string, mimeType: string): Promise<AnalysisResult> {
  const token = Deno.env.get("HF_TOKEN");
  if (!token) throw new Error("Hugging Face is not configured: add HF_TOKEN to Supabase Edge Function Secrets");

  const model = Deno.env.get("HF_MODEL_ID") || "facebook/detr-resnet-50";
  const originModel = Deno.env.get("HF_IMAGE_ORIGIN_MODEL_ID") || "dima806/ai_vs_human_generated_image_detection";
  const [vehicleResult, originResult] = await Promise.allSettled([
    callHuggingFaceModel(bytes, token, model, { threshold: 0.25 }),
    callHuggingFaceModel(bytes, token, originModel, { top_k: 2 }),
  ]);
  if (vehicleResult.status === "rejected") throw vehicleResult.reason;

  const detections = vehicleResult.value as Array<{ label?: string; score?: number; box?: Record<string, number> }>;
  const motorcyclePattern = /motorcycle|motorbike|scooter|moped|จักรยานยนต์|มอเตอร์ไซค์/i;
  const motorcycleDetections = detections.filter((item) => motorcyclePattern.test(String(item.label || "")));
  const isMotorcycle = motorcycleDetections.length > 0;
  const confidence = Math.round(maxScore(motorcycleDetections) * 100);
  const detectedLabels = detections
    .slice(0, 8)
    .map((item) => `${item.label || "ไม่ทราบวัตถุ"} ${Math.round((Number(item.score) || 0) * 100)}%`)
    .filter(Boolean);

  const result: AnalysisResult = {
    is_motorcycle: isMotorcycle,
    ai_triage: isMotorcycle && confidence >= 60 ? "MATCH" : isMotorcycle ? "MANUAL_REVIEW" : "NO_MATCH",
    violation_type: isMotorcycle ? "ตรวจพบรถจักรยานยนต์ — รอ Admin ตรวจสอบการจอด" : "ไม่พบรถจักรยานยนต์ชัดเจน",
    confidence: Math.max(0, Math.min(100, confidence)),
    evidence_notes: "",
    ai_available: true,
  };

  const notes = [
    `Hugging Face ตรวจด้วยโมเดล ${model} และภาพชนิด ${mimeType || "ไม่ระบุ"}`,
    `คำอธิบายผู้แจ้ง: ${reportDescription || "ไม่มี"}`,
    detectedLabels.length ? `วัตถุที่ตรวจพบ: ${detectedLabels.join(", ")}` : "ไม่พบวัตถุที่ชัดเจน",
  ];

  if (originResult.status === "fulfilled") {
    const originScores = originResult.value as Array<{ label?: string; score?: number }>;
    const ranked = originScores
      .map((item) => ({ label: String(item.label || "unknown"), score: Number(item.score) || 0 }))
      .sort((a, b) => b.score - a.score);
    const aiScore = ranked
      .filter((item) => /ai|generated|synthetic|fake/i.test(item.label))
      .reduce((score, item) => Math.max(score, item.score), 0);
    const humanScore = ranked
      .filter((item) => /human|real|authentic|photo/i.test(item.label))
      .reduce((score, item) => Math.max(score, item.score), 0);
    const top = ranked[0];
    const generated = aiScore > humanScore || (!humanScore && !!top && /ai|generated|synthetic|fake/i.test(top.label));
    const imageConfidence = Math.round(Math.max(aiScore, humanScore, top?.score || 0) * 100);
    result.ai_image_available = true;
    result.ai_generated = generated;
    result.ai_image_confidence = Math.max(0, Math.min(100, imageConfidence));
    result.ai_image_label = top?.label || "unknown";
    notes.push(
      `ตรวจแหล่งที่มาภาพด้วยโมเดล ${originModel}: ${generated ? "มีแนวโน้มภาพที่สร้างด้วย AI" : "มีแนวโน้มภาพถ่ายจริง"} ${result.ai_image_confidence}%`,
    );
  } else {
    const message = originResult.reason instanceof Error ? originResult.reason.message : "image-origin analysis failed";
    result.ai_image_available = false;
    result.ai_image_error = message.slice(0, 240);
    notes.push(`ตรวจแหล่งที่มาภาพไม่ได้: ${message}`);
  }

  notes.push("ผลนี้เป็นการช่วยคัดกรอง ไม่ใช่คำตัดสินลงโทษแทน Admin");
  result.evidence_notes = notes.join(" | ").slice(0, 500);
  return result;
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
      result = await callHuggingFace(bytes, report.description, file.type || "image/jpeg");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Hugging Face analysis failed";
      result = {
        is_motorcycle: false,
        ai_triage: "MANUAL_REVIEW",
        violation_type: "ยังยืนยันไม่ได้ — Admin ต้องตรวจเอง",
        confidence: 0,
        evidence_notes: `Hugging Face วิเคราะห์ไม่ได้: ${message}`.slice(0, 500),
        ai_available: false,
        ai_error: message.slice(0, 240),
        ai_image_available: false,
        ai_image_error: message.slice(0, 240),
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
