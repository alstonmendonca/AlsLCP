import { corsHeaders } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/supabase.ts";
import { hashSecret, isValidPin, verifySecret } from "../_shared/security.ts";

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
    const adminUsername = String(body.adminUsername || "").trim().toLowerCase();
    const adminPassword = String(body.adminPassword || "");
    const adminPin = String(body.adminPin || "").trim();

    const fullName = String(body.name || "").trim();
    const username = String(body.username || "").trim().toLowerCase();
    const password = String(body.password || "");
    const pin = String(body.pin || "").trim();

    if (!tenantId || !adminUsername || (!adminPassword && !adminPin)) {
      return new Response(JSON.stringify({ success: false, message: "Admin authentication details are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!fullName || !username || password.length < 6 || !isValidPin(pin)) {
      return new Response(JSON.stringify({ success: false, message: "Employee name, username, password and valid PIN are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = getServiceClient();

    const { data: tenant, error: tenantErr } = await supabase
      .from("tenants")
      .select("id,tenant_id")
      .eq("tenant_id", tenantId)
      .single();

    if (tenantErr || !tenant) {
      return new Response(JSON.stringify({ success: false, message: "Tenant not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: admin, error: adminErr } = await supabase
      .from("tenant_users")
      .select("id,username,password_hash,pin_hash,user_type,active")
      .eq("tenant_id", tenant.id)
      .eq("username", adminUsername)
      .eq("user_type", "master_admin")
      .eq("active", true)
      .maybeSingle();

    if (adminErr || !admin) {
      return new Response(JSON.stringify({ success: false, message: "Admin authentication failed" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let adminVerified = false;
    if (adminPassword) {
      adminVerified = await verifySecret(adminPassword, String(admin.password_hash || ""));
    } else if (adminPin) {
      adminVerified = await verifySecret(adminPin, String(admin.pin_hash || ""));
    }

    if (!adminVerified) {
      return new Response(JSON.stringify({ success: false, message: "Admin authentication failed" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const passwordHash = await hashSecret(password);
    const pinHash = await hashSecret(pin);

    const { data: created, error: createErr } = await supabase
      .from("tenant_users")
      .insert({
        tenant_id: tenant.id,
        user_type: "employee",
        full_name: fullName,
        username,
        password_hash: passwordHash,
        pin_hash: pinHash,
        login_method_preference: "both",
        active: true,
        created_by_user_id: admin.id,
      })
      .select("id,full_name,username,user_type,active")
      .single();

    if (createErr || !created) {
      return new Response(JSON.stringify({ success: false, message: createErr?.message || "Failed to create employee" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, user: created }), {
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
