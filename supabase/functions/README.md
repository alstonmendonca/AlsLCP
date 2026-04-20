# Supabase Edge Functions

This folder contains Edge Functions for the setup/login flow.

## Functions

- `initialize-tenant`
  - Validates activation key and reserves it
  - Creates tenant
  - Creates master admin user
  - Marks activation key as used
- `login`
  - Tenant-aware login by username/password or PIN
- `admin-add-employee`
  - Authenticated admin action to add employee with password+PIN
- `admin-reset-pin`
  - Authenticated admin action to reset an employee PIN
- `check-update`
  - Validates tenant, subscription, and registered installation
  - Returns signed download URL for the latest approved installer
- `subscription-status`
  - Returns tenant subscription status and expiry/remaining details
  - Used by Settings > Updates to show current subscription state

## Shared helpers

- `_shared/supabase.ts` -> service-role client
- `_shared/security.ts` -> PBKDF2 hashing + verification for password/PIN
- `_shared/cors.ts` -> CORS headers

## Deploy

Run these from the repo root after logging into Supabase CLI:

```bash
npx supabase functions deploy initialize-tenant
npx supabase functions deploy login
npx supabase functions deploy admin-add-employee
npx supabase functions deploy admin-reset-pin
npx supabase functions deploy check-update
npx supabase functions deploy subscription-status
```

## Local serve (optional)

```bash
npx supabase functions serve --env-file supabase/.env.local
```

## Required environment variables

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SB_PROJECT_URL` and `SB_SERVICE_ROLE_KEY` are also supported by the shared client helper.

Set them in Supabase project function secrets or local `.env` for testing.

## Required schema additions

Run the SQL in `supabase/001_initial_schema.sql` to create:

- `tenant_devices` for installation fingerprints
- `tenant_subscriptions` for expiry / entitlement checks
- `app_releases` for platform-specific release metadata
- `update_audit_log` for update decision history

Then apply migrations (recommended):

- `npx supabase db push`

This includes `202604181045_auto_expire_subscriptions.sql`, which adds automatic expiry normalization for `tenant_subscriptions`.
