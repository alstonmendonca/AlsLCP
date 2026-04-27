import { corsHeaders } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ success: false, message: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const version = String(body.version || "").trim();
    const platform = String(body.platform || "win32").trim();
    const arch = String(body.arch || "x64").trim();
    const channel = String(body.channel || "stable").trim().toLowerCase();
    const storagePath = String(body.storagePath || "").trim();
    const fileName = String(body.fileName || "").trim();
    const sha256 = String(body.sha256 || "").trim();
    const releaseNotes = String(body.releaseNotes || "").trim();
    const minSupportedVersion = String(body.minSupportedVersion || "").trim() || null;
    const mandatory = Boolean(body.mandatory);
    const rolloutPercent = Number(body.rolloutPercent ?? 100);

    if (!version || !storagePath || !fileName) {
      return new Response(JSON.stringify({ success: false, message: "version, storagePath, and fileName are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = getServiceClient();

    const { data: existing, error: checkErr } = await supabase
      .from("app_releases")
      .select("id")
      .eq("channel", channel)
      .eq("platform", platform)
      .eq("arch", arch)
      .eq("version", version)
      .maybeSingle();

    if (existing) {
      return new Response(JSON.stringify({ success: false, message: `Release ${version} for ${platform}/${arch}/${channel} already exists` }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: release, error: insertErr } = await supabase
      .from("app_releases")
      .insert({
        channel,
        platform,
        arch,
        version,
        storage_bucket: "app-releases",
        storage_path: storagePath,
        file_name: fileName,
        sha256: sha256 || null,
        release_notes: releaseNotes || null,
        min_supported_version: minSupportedVersion,
        mandatory,
        rollout_percent: Math.max(0, Math.min(100, rolloutPercent)),
        active: true,
        published_at: new Date().toISOString(),
      })
      .select("id, version")
      .single();

    if (insertErr || !release) {
      return new Response(JSON.stringify({ success: false, message: insertErr?.message || "Failed to create release" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      release: {
        id: release.id,
        version: release.version,
      },
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, message: error.message || "Unexpected error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
