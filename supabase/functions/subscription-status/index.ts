import { corsHeaders } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/supabase.ts";

function toIsoOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
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

    if (!tenantId) {
      return new Response(JSON.stringify({ success: false, message: "Tenant ID is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = getServiceClient();

    const { data: tenant, error: tenantErr } = await supabase
      .from("tenants")
      .select("id, tenant_id, tenant_name, activation_status")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (tenantErr || !tenant) {
      return new Response(JSON.stringify({ success: false, message: "Tenant not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: subscription, error: subscriptionErr } = await supabase
      .from("tenant_subscriptions")
      .select("plan_name, status, starts_at, expires_at, grace_until, notes")
      .eq("tenant_id", tenant.id)
      .maybeSingle();

    if (subscriptionErr) {
      return new Response(JSON.stringify({ success: false, message: subscriptionErr.message || "Failed to fetch subscription" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let device = null;
    if (appInstanceId) {
      const { data: deviceRow } = await supabase
        .from("tenant_devices")
        .select("status, app_version, platform, arch, last_seen_at")
        .eq("tenant_id", tenant.id)
        .eq("app_instance_id", appInstanceId)
        .maybeSingle();
      device = deviceRow || null;
    }

    if (!subscription) {
      return new Response(JSON.stringify({
        success: true,
        subscribed: false,
        tenant: {
          tenantId: tenant.tenant_id,
          tenantName: tenant.tenant_name,
          activationStatus: tenant.activation_status,
        },
        subscription: null,
        device: {
          registered: Boolean(device),
          active: device?.status === "active",
          status: device?.status || null,
          appVersion: device?.app_version || null,
          platform: device?.platform || null,
          arch: device?.arch || null,
          lastSeenAt: toIsoOrNull(device?.last_seen_at),
        },
        message: "No subscription record found",
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const nowMs = Date.now();
    const startsAtIso = toIsoOrNull(subscription.starts_at);
    const expiresAtIso = toIsoOrNull(subscription.expires_at);
    const graceUntilIso = toIsoOrNull(subscription.grace_until);

    const expiresAtMs = expiresAtIso ? new Date(expiresAtIso).getTime() : null;
    const graceUntilMs = graceUntilIso ? new Date(graceUntilIso).getTime() : null;

    const allowedByStatus =
      subscription.status === "active" ||
      subscription.status === "trial" ||
      (subscription.status === "past_due" && graceUntilMs !== null && graceUntilMs >= nowMs);
    const notExpired = expiresAtMs === null || expiresAtMs >= nowMs;

    const subscribed = allowedByStatus && notExpired;

    const remainingMs = expiresAtMs === null ? null : Math.max(0, expiresAtMs - nowMs);
    const remainingDays = remainingMs === null ? null : Math.ceil(remainingMs / (24 * 60 * 60 * 1000));

    return new Response(JSON.stringify({
      success: true,
      subscribed,
      tenant: {
        tenantId: tenant.tenant_id,
        tenantName: tenant.tenant_name,
        activationStatus: tenant.activation_status,
      },
      subscription: {
        planName: subscription.plan_name,
        status: subscription.status,
        startsAt: startsAtIso,
        expiresAt: expiresAtIso,
        graceUntil: graceUntilIso,
        remainingMs,
        remainingDays,
        hasExpiry: expiresAtIso !== null,
        notes: subscription.notes || null,
      },
      device: {
        registered: Boolean(device),
        active: device?.status === "active",
        status: device?.status || null,
        appVersion: device?.app_version || null,
        platform: device?.platform || null,
        arch: device?.arch || null,
        lastSeenAt: toIsoOrNull(device?.last_seen_at),
      },
      message: subscribed ? "Subscription is active" : "Subscription is inactive",
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
