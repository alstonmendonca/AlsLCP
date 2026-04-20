# Supabase Setup

This project now has a Supabase-first bootstrap schema in [supabase/001_initial_schema.sql](../supabase/001_initial_schema.sql).

## What the schema provides

- `activation_keys`
  - Stores the activation key inventory.
  - Tracks whether a key is available, reserved, used, or revoked.
  - Records which tenant used the key.
- `tenants`
  - Stores tenant onboarding data.
  - Includes tenant ID, tenant name, location, contact details, activation status, and the hashed master PIN.
- `tenant_users`
  - Stores the master admin user and employee users.
  - Supports login by password or PIN.
  - Stores only hashed secrets.
- `tenant_devices`
  - Stores registered app installations per tenant (`app_instance_id`).
  - Supports device-aware policy checks.
- `tenant_subscriptions`
  - Stores subscription/entitlement status per tenant.
  - Supports expiry and grace-period checks.
- `app_releases`
  - Stores release metadata by channel/platform/arch.
  - Used to decide which update artifact should be served.
- `update_audit_log`
  - Stores update decision logs (allowed, denied, no_update, error).

## Important security note

Do not store plaintext PINs or passwords in Supabase.
Only store hashes from the application or backend.

## How to apply the schema

Preferred (CLI):

1. Run `npx supabase db push` from the repo root.
2. Confirm migrations are applied with `npx supabase migration list`.

Fallback (SQL Editor):

1. Open the Supabase SQL Editor.
2. Paste the contents of [supabase/001_initial_schema.sql](../supabase/001_initial_schema.sql).
3. Run the script.
4. Confirm activation keys and required tables were created.

Note: subscription auto-expiry is provided by migration [supabase/migrations/202604181045_auto_expire_subscriptions.sql](../supabase/migrations/202604181045_auto_expire_subscriptions.sql).

## How to add a new activation key

When you need a new onboarding key, add it in `public.activation_keys` with `status='available'`.

```sql
insert into public.activation_keys (key_code, status, notes)
values ('ALSP0-AB12C-34DEF-56GHI-78JKL', 'available', 'Manual key provisioning');
```

Then verify:

```sql
select key_code, status, assigned_at, used_at
from public.activation_keys
order by created_at desc;
```

After that, setup handles the rest automatically through `initialize-tenant` (reserve key, create tenant/admin/device, optionally create subscription, mark key used).

Activation key format is strictly 5 blocks of 5 uppercase alphanumeric characters:

- `XXXXX-XXXXX-XXXXX-XXXXX-XXXXX`

## Recommended onboarding flow

1. Customer enters an activation key.
2. Backend marks the key as used and links it to the tenant.
3. Create the tenant record with:
   - tenant ID
   - tenant name
   - tenant location
   - contact details
   - hashed master PIN
4. Create the first `tenant_users` row for the master admin.
5. Allow the master admin to create employee accounts and employee PINs.
6. Register app installation identity for the tenant device record.
7. Optionally create an initial subscription during setup (one-year active plan) when `createSubscription` is enabled.

## What the schema does not do by itself

- It does not create app login APIs.
- It does not define application-side auth routes.
- It does not publish app release rows automatically.
- It does not upload installer artifacts automatically.

These are handled by main-process logic and Supabase Edge Functions.

## Next implementation step

Deploy backend or Supabase Edge Functions for:

- activation key validation
- tenant onboarding
- master PIN reset/change
- employee account creation
- login by username/password or PIN
- update authorization and signed artifact URL generation

For production update/subscription behavior, also deploy:

- `check-update`
- `subscription-status`

## Credential reminder

If you pasted any Supabase database password or connection string into chat, rotate it in Supabase and move it into environment variables before using it in code.
