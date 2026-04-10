# Codebase Structure

This repository uses a src-first layout with offline-only runtime rules.

## Folder Layout

- `src/main/`
  - Main process runtime (`main.js`, `backup.js`, `restore.js`).
- `src/renderer/modules/`
  - Renderer feature modules.
- `src/renderer/styles/`
  - Renderer styles.
- `main.js`, `backup.js`, `restore.js`
  - Thin root entry shims for Electron startup compatibility.
- `scripts/`
  - Repository guardrails and verification scripts.
- `docs/`
  - Architecture and maintenance documentation.

## Root File Policy

Root should only contain:

- Entrypoints and static assets required by packaging/runtime.
- Build/config files.

Root must not contain duplicated renderer modules or renderer CSS files.
Those belong in `src/renderer/modules` and `src/renderer/styles` only.

## Offline-Only Policy

The app is intentionally offline-first.

- Do not reintroduce online bridge files (`getOnline.js`, `startMongoExpress.js`, `startMongoExpress.exe`).
- Do not add cloud-sync dependencies (Mongo/WebSocket/Google API/update bridge stack).
- Keep backup/restore local-only unless the architecture is explicitly changed.

## Verification Commands

- `npm run verify:compat`
  - Checks root shim targets.
- `npm run verify:layout`
  - Checks folder policy, root cleanliness, HTML path usage, and offline dependency/resource policy.
- `npm run verify:structure`
  - Runs both compatibility and layout checks.
- `npm run verify:syntax`
  - Runs Node syntax checks on critical entry files.
- `npm run validate`
  - Runs structure and syntax verification in one command.

Use `npm run validate` before commits and release builds.
