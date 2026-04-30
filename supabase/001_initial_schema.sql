-- AlsPOS initial Supabase schema
-- Run this in the Supabase SQL Editor or via `npx supabase db push`

-- Activation key inventory
CREATE TABLE IF NOT EXISTS public.activation_keys (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    key_code text NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'available'
        CHECK (status IN ('available', 'reserved', 'used', 'revoked')),
    notes text,
    assigned_at timestamptz,
    used_tenant_id bigint,
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activation_keys_status
    ON public.activation_keys (status);

-- Tenants
CREATE TABLE IF NOT EXISTS public.tenants (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id text NOT NULL UNIQUE,
    tenant_name text NOT NULL,
    tenant_location text NOT NULL,
    contact_name text NOT NULL,
    contact_phone text NOT NULL,
    contact_email text,
    contact_address text,
    master_pin_hash text NOT NULL,
    activation_key_id bigint REFERENCES public.activation_keys(id),
    activation_status text NOT NULL DEFAULT 'active'
        CHECK (activation_status IN ('active', 'suspended', 'revoked')),
    activated_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenants_tenant_id
    ON public.tenants (tenant_id);

-- Tenant users (master admin + employees)
CREATE TABLE IF NOT EXISTS public.tenant_users (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id bigint NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    user_type text NOT NULL DEFAULT 'employee'
        CHECK (user_type IN ('master_admin', 'employee')),
    full_name text NOT NULL,
    username text NOT NULL,
    password_hash text,
    pin_hash text,
    login_method_preference text DEFAULT 'both'
        CHECK (login_method_preference IN ('password', 'pin', 'both')),
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, username)
);

CREATE INDEX IF NOT EXISTS idx_tenant_users_tenant
    ON public.tenant_users (tenant_id);

-- Tenant devices (app installations)
CREATE TABLE IF NOT EXISTS public.tenant_devices (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id bigint NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    app_instance_id text NOT NULL,
    machine_fingerprint_hash text,
    platform text NOT NULL DEFAULT 'unknown',
    arch text NOT NULL DEFAULT 'unknown',
    app_version text NOT NULL DEFAULT 'unknown',
    status text NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive', 'blocked')),
    first_registered_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, app_instance_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_devices_tenant
    ON public.tenant_devices (tenant_id);

-- Tenant subscriptions
CREATE TABLE IF NOT EXISTS public.tenant_subscriptions (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id bigint NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,
    plan_name text,
    status text NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'trial', 'past_due', 'expired', 'cancelled')),
    starts_at timestamptz,
    expires_at timestamptz,
    grace_until timestamptz,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_tenant
    ON public.tenant_subscriptions (tenant_id);

-- App releases
CREATE TABLE IF NOT EXISTS public.app_releases (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    channel text NOT NULL DEFAULT 'stable',
    platform text NOT NULL DEFAULT 'win32',
    arch text NOT NULL DEFAULT 'x64',
    version text NOT NULL,
    storage_bucket text NOT NULL DEFAULT 'app-releases',
    storage_path text NOT NULL,
    file_name text NOT NULL,
    sha256 text,
    release_notes text,
    min_supported_version text,
    mandatory boolean NOT NULL DEFAULT false,
    rollout_percent integer NOT NULL DEFAULT 100
        CHECK (rollout_percent >= 0 AND rollout_percent <= 100),
    chunk_count integer NOT NULL DEFAULT 1,
    file_size bigint,
    active boolean NOT NULL DEFAULT true,
    published_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (channel, platform, arch, version)
);

CREATE INDEX IF NOT EXISTS idx_app_releases_lookup
    ON public.app_releases (channel, platform, arch, active);

-- Update audit log
CREATE TABLE IF NOT EXISTS public.update_audit_log (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id bigint REFERENCES public.tenants(id) ON DELETE SET NULL,
    app_instance_id text,
    action text NOT NULL
        CHECK (action IN ('allowed', 'denied', 'no_update', 'error')),
    current_version text,
    target_version text,
    reason text,
    platform text,
    arch text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_update_audit_log_tenant
    ON public.update_audit_log (tenant_id);
