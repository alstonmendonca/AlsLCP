import { corsHeaders } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/supabase.ts";
import { hashSecret, isValidActivationKey, isValidPin } from "../_shared/security.ts";

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

    const activationKey = String(body.activationKey || "").trim().toUpperCase();
    const tenantId = String(body.tenantId || "").trim();
    const tenantName = String(body.tenantName || "").trim();
    const tenantLocation = String(body.tenantLocation || "").trim();
    const contactName = String(body.contactName || "").trim();
    const contactPhone = String(body.contactPhone || "").trim();
    const contactEmail = String(body.contactEmail || "").trim();
    const contactAddress = String(body.contactAddress || "").trim();
    const appInstanceId = String(body.appInstanceId || "").trim();
    const appVersion = String(body.appVersion || "").trim() || "unknown";
    const platform = String(body.platform || "").trim() || "unknown";
    const arch = String(body.arch || "").trim() || "unknown";
    const masterPin = String(body.masterPin || "").trim();
    const createSubscription = Boolean(body.createSubscription);
    const adminName = String(body.adminName || "").trim();
    const adminUsername = String(body.adminUsername || "").trim().toLowerCase();
    const adminPassword = String(body.adminPassword || "");

    if (!isValidActivationKey(activationKey)) {
      return new Response(JSON.stringify({ success: false, message: "Invalid activation key format" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!tenantId || !tenantName || !tenantLocation || !contactName || !contactPhone) {
      return new Response(JSON.stringify({ success: false, message: "Tenant and contact details are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!adminName || !adminUsername || adminPassword.length < 6) {
      return new Response(JSON.stringify({ success: false, message: "Admin details are invalid" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!appInstanceId) {
      return new Response(JSON.stringify({ success: false, message: "App installation identity is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!isValidPin(masterPin)) {
      return new Response(JSON.stringify({ success: false, message: "Master PIN must be 4-8 digits" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = getServiceClient();

    const { data: keyReservation, error: reserveErr } = await supabase
      .from("activation_keys")
      .update({ status: "reserved", assigned_at: new Date().toISOString() })
      .eq("key_code", activationKey)
      .eq("status", "available")
      .select("id,key_code")
      .maybeSingle();

    if (reserveErr || !keyReservation) {
      return new Response(JSON.stringify({ success: false, message: "Activation key is invalid or already used" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const masterPinHash = await hashSecret(masterPin);
    const adminPasswordHash = await hashSecret(adminPassword);
    const adminPinHash = await hashSecret(masterPin);

    const { data: tenant, error: tenantErr } = await supabase
      .from("tenants")
      .insert({
        tenant_id: tenantId,
        tenant_name: tenantName,
        tenant_location: tenantLocation,
        contact_name: contactName,
        contact_phone: contactPhone,
        contact_email: contactEmail || null,
        contact_address: contactAddress || null,
        master_pin_hash: masterPinHash,
        activation_key_id: keyReservation.id,
        activation_status: "active",
        activated_at: new Date().toISOString(),
      })
      .select("id,tenant_id,tenant_name,tenant_location")
      .single();

    if (tenantErr || !tenant) {
      await supabase
        .from("activation_keys")
        .update({ status: "available", assigned_at: null })
        .eq("id", keyReservation.id);

      return new Response(JSON.stringify({ success: false, message: tenantErr?.message || "Failed to create tenant" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: adminUser, error: adminErr } = await supabase
      .from("tenant_users")
      .insert({
        tenant_id: tenant.id,
        user_type: "master_admin",
        full_name: adminName,
        username: adminUsername,
        password_hash: adminPasswordHash,
        pin_hash: adminPinHash,
        login_method_preference: "both",
        active: true,
      })
      .select("id,full_name,username,user_type")
      .single();

    if (adminErr || !adminUser) {
      await supabase.from("tenants").delete().eq("id", tenant.id);
      await supabase
        .from("activation_keys")
        .update({ status: "available", assigned_at: null })
        .eq("id", keyReservation.id);

      return new Response(JSON.stringify({ success: false, message: adminErr?.message || "Failed to create admin account" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date();
    const nowIso = now.toISOString();

    const { error: deviceErr } = await supabase
      .from("tenant_devices")
      .upsert({
        tenant_id: tenant.id,
        app_instance_id: appInstanceId,
        machine_fingerprint_hash: null,
        platform,
        arch,
        app_version: appVersion,
        status: "active",
        first_registered_at: nowIso,
        last_seen_at: nowIso,
      }, { onConflict: "tenant_id,app_instance_id" });

    if (deviceErr) {
      await supabase.from("tenant_users").delete().eq("tenant_id", tenant.id);
      await supabase.from("tenants").delete().eq("id", tenant.id);
      await supabase
        .from("activation_keys")
        .update({ status: "available", assigned_at: null })
        .eq("id", keyReservation.id);

      return new Response(JSON.stringify({ success: false, message: deviceErr.message || "Failed to register app installation" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (createSubscription) {
      const expiresAt = new Date(now);
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);

      const { error: subscriptionErr } = await supabase
        .from("tenant_subscriptions")
        .upsert({
          tenant_id: tenant.id,
          plan_name: "annual-addon",
          status: "active",
          starts_at: nowIso,
          expires_at: expiresAt.toISOString(),
          grace_until: null,
          notes: "Optional subscription add-on selected during initial setup",
        }, { onConflict: "tenant_id" });

      if (subscriptionErr) {
        await supabase.from("tenant_devices").delete().eq("tenant_id", tenant.id);
        await supabase.from("tenant_users").delete().eq("tenant_id", tenant.id);
        await supabase.from("tenants").delete().eq("id", tenant.id);
        await supabase
          .from("activation_keys")
          .update({ status: "available", assigned_at: null })
          .eq("id", keyReservation.id);

        return new Response(JSON.stringify({ success: false, message: subscriptionErr.message || "Failed to create subscription record" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const { error: consumeErr } = await supabase
      .from("activation_keys")
      .update({
        status: "used",
        used_tenant_id: tenant.id,
        used_at: new Date().toISOString(),
      })
      .eq("id", keyReservation.id);

    if (consumeErr) {
      return new Response(JSON.stringify({ success: false, message: consumeErr.message || "Failed to finalize activation" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      tenant,
      adminUser,
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
