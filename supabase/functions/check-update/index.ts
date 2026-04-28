import { corsHeaders } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/supabase.ts";

function compareVersions(left: string, right: string): number {
  const leftParts = String(left || "0").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = String(right || "0").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] || 0;
    const rightPart = rightParts[index] || 0;

    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }

  return 0;
}

function rolloutBucket(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % 100;
}

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
    const tenantId = String(body.tenantId || "").trim();
    const appInstanceId = String(body.appInstanceId || "").trim();
    const currentVersion = String(body.currentVersion || "0.0.0").trim();
    const platform = String(body.platform || "").trim() || "win32";
    const arch = String(body.arch || "").trim() || "x64";
    const channel = String(body.channel || "stable").trim().toLowerCase();

    if (!tenantId || !appInstanceId) {
      return new Response(JSON.stringify({ success: false, message: "Tenant and installation identity are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = getServiceClient();
    const nowIso = new Date().toISOString();

    const { data: tenant, error: tenantErr } = await supabase
      .from("tenants")
      .select("id, tenant_id, activation_status")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (tenantErr || !tenant) {
      return new Response(JSON.stringify({ success: false, message: "Tenant not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (tenant.activation_status !== "active") {
      return new Response(JSON.stringify({ success: false, message: "Tenant is not active" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.rpc("expire_due_tenant_subscriptions", { p_tenant_id: tenant.id });

    const { data: subscription, error: subscriptionErr } = await supabase
      .from("tenant_subscriptions")
      .select("status, expires_at, grace_until, plan_name")
      .eq("tenant_id", tenant.id)
      .maybeSingle();

    if (subscriptionErr || !subscription) {
      return new Response(JSON.stringify({ success: false, message: "No active subscription found" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const expiresAt = subscription.expires_at ? new Date(subscription.expires_at).getTime() : null;
    const graceUntil = subscription.grace_until ? new Date(subscription.grace_until).getTime() : null;
    const now = Date.now();
    const subscriptionAllowed =
      subscription.status === "active" ||
      subscription.status === "trial" ||
      (subscription.status === "past_due" && graceUntil !== null && graceUntil >= now);
    const notExpired = expiresAt === null || expiresAt >= now;

    if (!subscriptionAllowed || !notExpired) {
      return new Response(JSON.stringify({ success: false, message: "Subscription is not active" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: device, error: deviceErr } = await supabase
      .from("tenant_devices")
      .select("id, status")
      .eq("tenant_id", tenant.id)
      .eq("app_instance_id", appInstanceId)
      .maybeSingle();

    if (deviceErr || !device) {
      return new Response(JSON.stringify({ success: false, message: "This installation is not registered" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (device.status !== "active") {
      return new Response(JSON.stringify({ success: false, message: "This installation has been revoked" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase
      .from("tenant_devices")
      .update({ last_seen_at: nowIso, app_version: String(body.appVersion || currentVersion).trim() || currentVersion })
      .eq("id", device.id);

    const isSubscribed = subscription.status === "active" || subscription.status === "trial";
    let effectiveChannel = "stable";

    if (isSubscribed) {
      const { data: premiumRelease } = await supabase
        .from("app_releases")
        .select("id")
        .eq("channel", "premium")
        .eq("platform", platform)
        .eq("arch", arch)
        .eq("active", true)
        .limit(1)
        .maybeSingle();

      if (premiumRelease) {
        effectiveChannel = "premium";
      }
    }

    const { data: release, error: releaseErr } = await supabase
      .from("app_releases")
      .select("id, channel, platform, arch, version, storage_bucket, storage_path, file_name, sha256, release_notes, min_supported_version, mandatory, rollout_percent, active, published_at, chunk_count, file_size")
      .eq("channel", effectiveChannel)
      .eq("platform", platform)
      .eq("arch", arch)
      .eq("active", true)
      .order("published_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (releaseErr || !release) {
      await supabase.from("update_audit_log").insert({
        tenant_id: tenant.id,
        app_instance_id: appInstanceId,
        current_version: currentVersion,
        latest_version: null,
        channel: effectiveChannel,
        platform,
        arch,
        result: "no_update",
        reason: "No release configured for this platform/channel",
      });

      return new Response(JSON.stringify({
        success: true,
        updateAvailable: false,
        message: "No release is configured for this platform yet",
        currentVersion,
        latestVersion: null,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const shouldRollout = Number(release.rollout_percent || 100) >= rolloutBucket(`${tenantId}:${appInstanceId}:${release.version}`);
    const versionComparison = compareVersions(currentVersion, release.version);
    const updateAvailable = versionComparison < 0;
    const downloadAllowed = shouldRollout || release.mandatory;

    if (!downloadAllowed) {
      await supabase.from("update_audit_log").insert({
        tenant_id: tenant.id,
        app_instance_id: appInstanceId,
        current_version: currentVersion,
        latest_version: release.version,
        channel: effectiveChannel,
        platform,
        arch,
        result: "denied",
        reason: "Release not included in rollout bucket",
      });

      return new Response(JSON.stringify({
        success: true,
        updateAvailable: false,
        message: "Update is not rolled out to this installation yet",
        currentVersion,
        latestVersion: release.version,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!updateAvailable) {
      await supabase.from("update_audit_log").insert({
        tenant_id: tenant.id,
        app_instance_id: appInstanceId,
        current_version: currentVersion,
        latest_version: release.version,
        channel: effectiveChannel,
        platform,
        arch,
        result: "no_update",
        reason: "Client is already on the latest version",
      });

      return new Response(JSON.stringify({
        success: true,
        updateAvailable: false,
        message: "You are already on the latest version",
        currentVersion,
        latestVersion: release.version,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const chunkCount = Number(release.chunk_count || 1);
    const fileSize = release.file_size != null ? Number(release.file_size) : null;

    let downloadUrl: string | null = null;
    let chunkUrls: string[] | null = null;

    if (chunkCount > 1) {
      const urls: string[] = [];
      for (let i = 0; i < chunkCount; i++) {
        const chunkPath = `${release.storage_path}.part${i}`;
        const { data: chunkSigned, error: chunkErr } = await supabase.storage
          .from(release.storage_bucket)
          .createSignedUrl(chunkPath, 300);
        if (chunkErr || !chunkSigned?.signedUrl) {
          await supabase.from("update_audit_log").insert({
            tenant_id: tenant.id,
            app_instance_id: appInstanceId,
            current_version: currentVersion,
            latest_version: release.version,
            channel: effectiveChannel,
            platform,
            arch,
            result: "error",
            reason: `Failed to create signed URL for chunk ${i}`,
          });
          return new Response(JSON.stringify({ success: false, message: "Failed to create download URLs" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        urls.push(chunkSigned.signedUrl);
      }
      chunkUrls = urls;
    } else {
      const { data: signedUrlData, error: signedUrlErr } = await supabase.storage
        .from(release.storage_bucket)
        .createSignedUrl(release.storage_path, 300);

      if (signedUrlErr || !signedUrlData?.signedUrl) {
        await supabase.from("update_audit_log").insert({
          tenant_id: tenant.id,
          app_instance_id: appInstanceId,
          current_version: currentVersion,
          latest_version: release.version,
          channel: effectiveChannel,
          platform,
          arch,
          result: "error",
          reason: signedUrlErr?.message || "Failed to create signed download URL",
        });

        return new Response(JSON.stringify({ success: false, message: "Failed to create download URL" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      downloadUrl = signedUrlData.signedUrl;
    }

    await supabase.from("update_audit_log").insert({
      tenant_id: tenant.id,
      app_instance_id: appInstanceId,
      current_version: currentVersion,
      latest_version: release.version,
      channel: effectiveChannel,
      platform,
      arch,
      result: "allowed",
      reason: "Update approved",
    });

    return new Response(JSON.stringify({
      success: true,
      updateAvailable: true,
      currentVersion,
      latestVersion: release.version,
      channel: release.channel,
      releaseNotes: release.release_notes,
      mandatory: Boolean(release.mandatory),
      minSupportedVersion: release.min_supported_version,
      downloadUrl,
      chunkUrls,
      chunkCount,
      fileSize,
      fileName: release.file_name,
      sha256: release.sha256,
      publishedAt: release.published_at,
      message: "Update available",
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
