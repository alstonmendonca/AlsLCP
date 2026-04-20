# Supabase Schema Reference And Update Publishing Runbook

## 1. Current Database Scope

The current Supabase database for this project contains these public objects:

- Tables:
  - activation_keys
  - tenants
  - tenant_users
  - tenant_devices
  - tenant_subscriptions
  - app_releases
  - update_audit_log
- View:
  - activation_key_overview
- Helper function + triggers:
  - set_updated_at()
  - trg_activation_keys_updated_at
  - trg_tenants_updated_at
  - trg_tenant_users_updated_at
  - expire_due_tenant_subscriptions()
  - trg_tenant_subscriptions_apply_expiry

Notes:

- This schema supports tenant onboarding, user management, device registration, subscription-gated updates, and audit logging for update decisions.
- The update path is authorized through the check-update Edge Function and signed Storage URLs.

---

## 2. Table By Table Reference

## 2.1 activation_keys

Purpose:

- Stores activation keys used for first-time tenant provisioning.
- Tracks key lifecycle: available -> reserved -> used (or revoked).

Key columns:

- id (uuid, PK)
- key_code (text, unique)
- status (text, check: available/reserved/used/revoked)
- used_tenant_id (uuid, FK -> tenants.id, unique nullable)
- assigned_at (timestamptz)
- used_at (timestamptz)
- notes (text)
- created_at, updated_at (timestamptz)

Operational behavior:

- initialize-tenant reserves key first, then finalizes as used.
- Foreign key ties used_tenant_id to the created tenant record.

---

## 2.2 tenants

Purpose:

- Master tenant entity for each business using the app.
- Stores activation state and contact/business metadata.

Key columns:

- id (uuid, PK)
- tenant_id (text, unique business identifier used by app)
- tenant_name, tenant_location (text)
- contact_name, contact_phone, contact_email, contact_address
- master_pin_hash (text)
- activation_key_id (uuid, FK -> activation_keys.id)
- activation_status (text, check: pending/active/suspended/closed)
- activated_at (timestamptz)
- created_at, updated_at

Operational behavior:

- Created by initialize-tenant.
- activation_status is validated before allowing update checks.

---

## 2.3 tenant_users

Purpose:

- Auth/accounts per tenant (master admin + employees).

Key columns:

- id (uuid, PK)
- tenant_id (uuid, FK -> tenants.id)
- user_type (text, check: master_admin/employee)
- full_name, username
- password_hash, pin_hash
- login_method_preference (text, check: both/password/pin)
- active (bool)
- last_login_at (timestamptz)
- created_by_user_id (uuid, self-FK)
- created_at, updated_at

Constraints:

- Unique username per tenant: unique (tenant_id, username)

---

## 2.4 tenant_devices

Purpose:

- Tracks app installation identity per tenant.
- Enables update gating by installation/device.

Key columns:

- id (uuid, PK)
- tenant_id (uuid, FK -> tenants.id)
- app_instance_id (text, stable local installation ID)
- machine_fingerprint_hash (text, optional)
- platform (text, e.g., win32)
- arch (text, e.g., x64)
- app_version (text)
- status (text, check: active/revoked)
- first_registered_at, last_seen_at
- created_at, updated_at

Constraints:

- unique (tenant_id, app_instance_id)

Operational behavior:

- Seeded during initialize-tenant.
- check-update requires device status=active.
- last_seen_at and app_version are refreshed during update checks.

---

## 2.5 tenant_subscriptions

Purpose:

- Stores entitlement/subscription state per tenant.
- Main billing/expiry gate for updates.

Key columns:

- id (uuid, PK)
- tenant_id (uuid, unique FK -> tenants.id)
- plan_name (text)
- status (text, check: trial/active/past_due/suspended/expired/canceled)
- starts_at
- expires_at
- grace_until
- notes
- created_at, updated_at

Operational behavior:

- initialize-tenant creates a subscription only when setup sends `createSubscription=true`.
- check-update allows update based on status + expiry/grace logic.
- migration `202604181045_auto_expire_subscriptions.sql` auto-transitions due rows to `expired`.

---

## 2.6 app_releases

Purpose:

- Release registry used by check-update to decide what version to serve.

Key columns:

- id (uuid, PK)
- channel (text, check: stable/beta)
- platform (text)
- arch (text)
- version (text)
- storage_bucket (text, default updates)
- storage_path (text, full object path in bucket)
- file_name (text)
- sha256 (text, optional)
- release_notes (text, optional)
- min_supported_version (text, optional)
- mandatory (bool)
- rollout_percent (int 0..100)
- active (bool)
- published_at
- created_at, updated_at

Operational behavior:

- check-update selects latest active row for channel+platform+arch.
- rollout_percent and mandatory influence eligibility.

---

## 2.7 update_audit_log

Purpose:

- Audit trail for update authorization decisions.

Key columns:

- id (uuid, PK)
- tenant_id (uuid nullable FK -> tenants.id)
- app_instance_id (text)
- current_version, latest_version
- channel
- platform, arch
- result (text, check: allowed/denied/no_update/error)
- reason (text)
- created_at

Operational behavior:

- check-update writes an entry for each decision path.
- Useful for support/debugging and subscription enforcement analysis.

---

## 3. View Reference

## activation_key_overview

Purpose:

- Operator-friendly join between activation_keys and tenant identity fields.

Contains:

- Key status/timestamps + selected tenant metadata when key has been used.

---

## 4. Relationship Map

- activation_keys.used_tenant_id -> tenants.id
- tenants.activation_key_id -> activation_keys.id
- tenant_users.tenant_id -> tenants.id
- tenant_users.created_by_user_id -> tenant_users.id
- tenant_devices.tenant_id -> tenants.id
- tenant_subscriptions.tenant_id -> tenants.id
- update_audit_log.tenant_id -> tenants.id

---

## 5. RLS / Security Notes

- RLS is enabled for core onboarding tables in bootstrap.
- Edge Functions use service-role client, so they bypass RLS policies as trusted backend operations.
- Keep the updates Storage bucket private.
- Never expose service role key to renderer/client.
- `activation_key_overview` is explicitly restricted to backend role usage only (`service_role` has `SELECT` only; `anon` and `authenticated` have no grants).

---

## 6. Activation Key Setup (What To Add Manually)

If you want to provision a new customer/site, you only need to add a new row in `public.activation_keys` with status `available`.

Table used:

- `public.activation_keys`

Required field:

- `key_code` (must be unique)

Recommended format:

- Uppercase alphanumeric 5-block format only, e.g. `ABCDE-ABCDE-ABCDE-ABCDE-ABCDE`.

### 6.1 Add one new activation key

```sql
insert into public.activation_keys (key_code, status, notes)
values ('ALSP0-AB12C-34DEF-56GHI-78JKL', 'available', 'Manual provisioning key');
```

### 6.2 Add multiple activation keys in one go

```sql
insert into public.activation_keys (key_code, status)
values
  ('ALSP0-JK78L-90MNO-12PQR-45STU', 'available'),
  ('ALSP0-ST34U-56VWX-78YZA-90BCD', 'available'),
  ('ALSP0-BC90D-12EFG-34HIJ-56KLM', 'available')
on conflict (key_code) do nothing;
```

### 6.3 Verify available keys

```sql
select key_code, status, assigned_at, used_at
from public.activation_keys
order by created_at desc;
```

### 6.4 Revoke a key (if leaked)

```sql
update public.activation_keys
set status = 'revoked'
where key_code = 'ALSP0-AB12C-34DEF-56GHI-78JKL';
```

### 6.5 What happens automatically after key creation

Once a key exists in `activation_keys` with status `available`, the rest is handled by the existing setup flow:

1. `initialize-tenant` reserves the key (`available -> reserved`).
2. Tenant and master admin are created.
3. Device row is seeded, and subscription row is created only if `createSubscription=true`.
4. Key is finalized as `used` and linked to the tenant.

No additional manual row creation is required for activation flow beyond adding the key itself.

---

## 7. Update Publishing Steps (Manual Prompt Flow)

This section is the exact release process for the current app implementation.

## 7.1 Pre-flight

1. Bump app version in package.json.
2. Build/package installer artifact from app repo.
3. Ensure Supabase schema and functions are deployed:
   - initialize-tenant
   - check-update
  - subscription-status
4. Confirm private Storage bucket exists (recommended name: updates).

CLI commands:

- `npx supabase db push`
- `npx supabase functions deploy initialize-tenant`
- `npx supabase functions deploy check-update`
- `npx supabase functions deploy subscription-status`

## 7.2 Build Installer

Run from repo root:

- npm run build
- npm run make

Output should include your Windows installer executable produced by electron-builder.

## 7.3 Upload Artifact To Private Bucket

1. Open Supabase Dashboard.
2. Go to Storage -> updates bucket.
3. Upload installer artifact to a deterministic path, for example:
  - windows/stable/1.0.5/alspos Setup.exe
4. Keep bucket private.

## 7.4 Create app_releases Row

Insert one row describing the uploaded artifact.

Required fields to set carefully:

- channel: stable or beta
- platform: win32
- arch: x64 (or your target arch)
- version: app version string (example 1.0.5)
- storage_bucket: updates
- storage_path: exact uploaded object path
- file_name: installer file name
- active: true
- published_at: now()

Optional but recommended:

- release_notes
- sha256
- rollout_percent (start with 10/25 for staged rollout if desired)
- mandatory
- min_supported_version

Example SQL:

```sql
insert into public.app_releases (
  channel,
  platform,
  arch,
  version,
  storage_bucket,
  storage_path,
  file_name,
  release_notes,
  mandatory,
  rollout_percent,
  active,
  published_at
)
values (
  'stable',
  'win32',
  'x64',
  '1.0.5',
  'updates',
  'windows/stable/1.0.5/alspos Setup.exe',
  'alspos Setup.exe',
  'Improved updater stability and subscription-gated checks.',
  false,
  100,
  true,
  now()
);
```

## 7.5 Ensure Tenant Is Eligible

For any tenant expected to receive update:

1. tenants.activation_status must be active.
2. tenant_subscriptions must be active/trial (or past_due in grace period).
3. tenant_devices must contain active app_instance_id row.

## 7.6 In-App Update Test (Settings)

1. Open app -> Settings -> Updates.
2. Click Check for Updates.
3. If eligible, app gets release metadata + signed URL.
4. Click Download Update.
5. Click Install Update (manual installer launch).

## 7.7 Verify Audit Trail

Run:

```sql
select created_at, tenant_id, app_instance_id, current_version, latest_version, result, reason
from public.update_audit_log
order by created_at desc
limit 50;
```

Expected outcomes:

- allowed when update is granted
- no_update when client already latest
- denied when rollout/subscription/device blocks
- error when release URL generation fails

---

## 8. Operational Tips

- Use only one active release per channel/platform/arch for predictable behavior.
- When superseding a release, set previous row active=false.
- Keep release version immutable after publish.
- Use rollout_percent < 100 for staged rollouts.
- Revoke compromised devices via tenant_devices.status='revoked'.
- Keep `expires_at` set for paid plans so auto-expiry can transition stale subscriptions to `expired`.

### 8.1 Subscription Auto-Expiry Behavior

- `expire_due_tenant_subscriptions()` marks due rows as `expired`.
- `trg_tenant_subscriptions_apply_expiry` enforces expiry on insert/update.
- `check-update` and `subscription-status` call the expiry function before evaluating status.
- Optional `pg_cron` schedule runs every minute to expire due rows in the background.

---

## 9. Quick Troubleshooting

- No update found:
  - Check app_releases active row for channel/platform/arch and version higher than client.
- Update denied:
  - Check tenant_subscriptions status/expiry and tenant_devices.status.
- Signed URL error:
  - Confirm bucket/path exists and service-role key is configured in function env.
- App never reaches update handler:
  - Confirm Electron main startup succeeded and IPC handlers were registered.
