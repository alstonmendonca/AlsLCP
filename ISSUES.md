# AlsPOS End-to-End Audit

Generated: 2026-04-30

---

## CRITICAL

### 1. Three IPC channels missing from preload allowlist
- **File:** `src/preload.js`
- **Channels:** `edit-employee`, `delete-employee`, `change-user-pin`
- **Impact:** These features are completely broken at runtime. The preload blocks them silently.
- **Status:** Fixed

### 2. CI build failed on only run (transient 502)
- **File:** `.github/workflows/release.yml`
- **Impact:** `electron-builder` couldn't download NSIS resources. No retry logic.
- **Status:** Acceptable — transient network issue, should succeed on re-run.

---

## HIGH — Security

### 3. `register-release` edge function has no auth beyond anon key
- **File:** `supabase/functions/register-release/index.ts`
- **Impact:** Anyone with the anon key can register fake releases.
- **Status:** Fixed

### 4. `subscription-status` edge function has no authentication
- **File:** `supabase/functions/subscription-status/index.ts`
- **Impact:** Any caller who knows a `tenantId` can query subscription details.
- **Status:** Fixed

### 5. CORS `Access-Control-Allow-Origin: *` on all edge functions
- **File:** `supabase/functions/_shared/cors.ts`
- **Impact:** Any website can call Supabase edge functions.
- **Status:** Fixed

### 6. Seed activation keys hardcoded and identical across installs
- **File:** `src/main/main.js` (initializeSchema)
- **Impact:** If valid server-side, any install can use them.
- **Status:** Not needed — seed keys are local-only, not validated server-side.

### 7. SQL string interpolation in encryption migration
- **Files:** `src/main/main.js:166`, `src/main/restore.js:62`
- **Impact:** Encryption key interpolated into `ATTACH DATABASE ... KEY '...'` SQL.
- **Status:** Fixed

---

## MEDIUM

### 8. Dead code: `isSupabaseAuthEnabled()` never called
- **File:** `src/main/auth.js`
- **Impact:** `SUPABASE_AUTH_ENABLED` env var has no effect. Auth mode decided by DB row.
- **Status:** No fix needed — works correctly via DB path.

### 9. Dead code: `ensureLocalUserFromRemote()` never called
- **File:** `src/main/main.js:638-672`
- **Status:** No fix needed — unused code.

### 10. No offline subscription caching
- **Impact:** Subscription check fails without network. No local expiry cache or grace period.
- **Status:** Not needed

### 11. `is_offline` column never populated
- **Files:** `src/main/main.js` (Orders, DeletedOrders tables)
- **Impact:** Column exists but no code sets it to `1`.
- **Status:** Incomplete feature — no fix needed now.

### 12. `email` field silently discarded in Supabase edge functions
- **Files:** `supabase/functions/admin-add-employee/index.ts`, `supabase/functions/initialize-tenant/index.ts`
- **Status:** Not needed — intentional design.

### 13. PIN login is a linear bcrypt scan
- **File:** `src/main/main.js:691-705`
- **Impact:** Slow with many employees. Leaks user count via timing.
- **Status:** Fixed

### 14. Missing Supabase migration files
- **Impact:** `001_initial_schema.sql` and `202604181045_auto_expire_subscriptions.sql` referenced but missing.
- **Status:** Fixed

---

## LOW

### 15. No `workflow_dispatch` trigger on release workflow
- **File:** `.github/workflows/release.yml`
- **Status:** Fixed

### 16. No electron-builder binary caching in CI
- **File:** `.github/workflows/release.yml`
- **Status:** Fixed

### 17. `head_commit.message` may be empty for tag pushes
- **File:** `.github/workflows/release.yml:105`
- **Status:** Fixed

### 18. `split`/`stat` commands fragile on Windows Git Bash
- **File:** `.github/workflows/release.yml:54-63`
- **Status:** Acceptable — `shell: bash` with `stat`/`wc` fallback handles portability.

### 19. No code signing configured
- **Impact:** Windows SmartScreen warnings for users.
- **Status:** Deferred — requires certificate purchase.

### 20. `electron-rebuild` devDependency redundant
- **File:** `package.json:66`
- **Status:** Fixed

### 21. OfflineBanner hardcoded Tailwind classes
- **File:** `src/renderer/components/OfflineBanner.jsx`
- **Impact:** Breaks theme consistency.
- **Status:** Fixed

### 22. No PR checks, lint workflow, dependabot, or test suite
- **File:** `.github/workflows/` — only release workflow exists.
