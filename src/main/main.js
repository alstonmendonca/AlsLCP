const { app, BrowserWindow, Menu, ipcMain, dialog } = require("electron");
const path = require("path");
const url = require("url");
const crypto = require('crypto');
const Database = require('better-sqlite3');
const fs = require('fs');
const Store = require('electron-store');
const printService = require('./services/printService');
const UpdateService = require('./services/updateService');
const {
    compareSecret,
    hashSecret,
    normalizeLoginInput,
} = require('./auth');
let mainWindow;
let store; // Will be initialized after dynamic import
function getLocalDateString(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
const projectRoot = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, "..", "..");
const basePath = projectRoot;
const resourcesPath = app.isPackaged
    ? path.join(process.resourcesPath, "resources")
    : path.resolve(__dirname, "..", "resources");
console.log(`Base path: ${basePath}`);
console.log(`Resources path: ${resourcesPath}`);

const DEFAULT_SUPABASE_PROJECT_URL = 'https://cjkbjnazwewpnzypgber.supabase.co';
const VALID_THEME_PRESETS = new Set([
    'classicMono',
    'navySunburst',
    'forestCream',
    'mintRose',
]);

function normalizeThemePreset(themePreset, fallback = 'creamCharcoal') {
    return VALID_THEME_PRESETS.has(themePreset) ? themePreset : fallback;
}

// === React + Vite App Loading ===
function getMainWindowUrl() {
    const devServerUrl = process.env.ELECTRON_RENDERER_URL;
    if (devServerUrl) {
        return devServerUrl;
    }

    const distIndexPath = app.isPackaged
        ? path.join(process.resourcesPath, 'dist', 'index.html')
        : path.join(basePath, 'dist', 'index.html');

    if (fs.existsSync(distIndexPath)) {
        return url.pathToFileURL(distIndexPath).href;
    }

    console.error('dist/index.html not found. Run "npm run build" first.');
    return '';
}

// Prevent multiple app instances from competing for the same SQLite file.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
    app.quit();
}

// Function to get the file path from the single shared resources directory
function getFilePath(filename) {
    return path.join(resourcesPath, filename);
}

function getUserDataFilePath(filename) {
    return path.join(app.getPath('userData'), filename);
}

async function ensureDatabaseFileInUserData() {
    const userDataDbPath = getUserDataFilePath('LC.db');

    if (fs.existsSync(userDataDbPath)) {
        return userDataDbPath;
    }

    const userDataDir = path.dirname(userDataDbPath);
    if (!fs.existsSync(userDataDir)) {
        await fs.promises.mkdir(userDataDir, { recursive: true });
    }

    const bundledSeedDbPath = path.join(resourcesPath, 'LC.db');
    if (fs.existsSync(bundledSeedDbPath)) {
        await fs.promises.copyFile(bundledSeedDbPath, userDataDbPath);
        console.log(`📦 Seed database copied to userData: ${userDataDbPath}`);
        return userDataDbPath;
    }

    // Final-product path: create a brand-new local database file and let initializeSchema build all tables.
    const fileHandle = await fs.promises.open(userDataDbPath, 'w');
    await fileHandle.close();
    console.log(`🆕 No seed database found. Created empty local database at: ${userDataDbPath}`);

    return userDataDbPath;
}

let db;

async function initializeDatabaseConnection() {
    const maxAttempts = 5;
    const retryDelayMs = 500;
    const dbPath = await ensureDatabaseFileInUserData();

    console.log(`📊 Using database at: ${dbPath}`);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            db = new Database(dbPath, { readonly: false });
            db.pragma('busy_timeout = 5000');
            db.pragma('foreign_keys = ON');
            db.pragma('journal_mode = WAL');

            console.log("✅ Connected to the SQLite database.");
            await initializeSchema();
            return;
        } catch (err) {
            const isLastAttempt = attempt === maxAttempts;
            console.error(
                `❌ Database open attempt ${attempt}/${maxAttempts} failed:`,
                err.message
            );

            if (db) {
                try { db.close(); } catch (_) {}
                db = null;
            }

            if (isLastAttempt) {
                throw err;
            }

            await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        }
    }
}


async function initStore() {
    try {
        store = new Store({
            defaults: {
                appInstanceId: crypto.randomUUID(),
                printerConfig: {
                    vendorId: '0x0525',
                    productId: '0xA700'
                }
            }
        });
    } catch (err) {
        console.error('electron-store corrupted, resetting:', err.message);
        const StoreClass = require('electron-store');
        const storePath = new StoreClass({ cwd: app.getPath('userData') }).path;
        try { fs.unlinkSync(storePath); } catch (_) {}
        store = new StoreClass({
            defaults: {
                appInstanceId: crypto.randomUUID(),
                printerConfig: {
                    vendorId: '0x0525',
                    productId: '0xA700'
                }
            }
        });
    }
    return store;
}

function dbGetAsync(query, params = []) {
    return db.prepare(query).get(...params);
}

function dbRunAsync(query, params = []) {
    return db.prepare(query).run(...params);
}

function dbExecAsync(query) {
    db.exec(query);
}

function dbAllAsync(query, params = []) {
    return db.prepare(query).all(...params);
}

async function ensureUserTableSchema() {
    const cols = await dbAllAsync("PRAGMA table_info(User)");

    const hasIsAdmin = cols.some((col) => col.name === 'isadmin');
    const hasUsername = cols.some((col) => col.name === 'username');
    const hasEmail = cols.some((col) => col.name === 'email');
    const hasPasswordHash = cols.some((col) => col.name === 'password_hash');
    const hasPinHash = cols.some((col) => col.name === 'pin_hash');
    const hasAdminFlag = cols.some((col) => col.name === 'is_admin');
    const hasActive = cols.some((col) => col.name === 'active');

    // Add missing columns first so we can safely normalize data before canonical rebuild.
    if (!hasUsername) {
        await dbRunAsync('ALTER TABLE User ADD COLUMN username TEXT');
    }

    if (!hasEmail) {
        await dbRunAsync('ALTER TABLE User ADD COLUMN email TEXT');
    }

    if (!hasPasswordHash) {
        await dbRunAsync('ALTER TABLE User ADD COLUMN password_hash TEXT');
    }

    if (!hasPinHash) {
        await dbRunAsync('ALTER TABLE User ADD COLUMN pin_hash TEXT');
    }

    if (!hasAdminFlag) {
        await dbRunAsync('ALTER TABLE User ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');
    }

    if (!hasActive) {
        await dbRunAsync('ALTER TABLE User ADD COLUMN active INTEGER NOT NULL DEFAULT 1');
    }

    await dbRunAsync(`UPDATE User
        SET username = LOWER(COALESCE(
            NULLIF(TRIM(username), ''),
            COALESCE(NULLIF(TRIM(uname), ''), 'cashier')
        ))`);

    await dbRunAsync(`UPDATE User
        SET email = COALESCE(
            NULLIF(TRIM(email), ''),
            LOWER(REPLACE(COALESCE(NULLIF(TRIM(username), ''), 'cashier'), ' ', '')) || '@local.user'
        )`);

    if (hasIsAdmin) {
        await dbRunAsync(`UPDATE User
            SET is_admin = COALESCE(is_admin, isadmin, 0)`);
    }

    await dbRunAsync('UPDATE User SET is_admin = COALESCE(is_admin, 0)');
    await dbRunAsync('UPDATE User SET active = COALESCE(active, 1)');

    const duplicateRows = await dbAllAsync(`
        SELECT LOWER(username) AS normalized_username, GROUP_CONCAT(userid) AS ids
        FROM User
        GROUP BY LOWER(username)
        HAVING COUNT(*) > 1
    `);

    for (const row of duplicateRows) {
        const ids = String(row.ids || '').split(',').map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0);
        if (ids.length <= 1) {
            continue;
        }

        const baseUsername = String(row.normalized_username || 'cashier').trim() || 'cashier';
        for (let index = 1; index < ids.length; index += 1) {
            const userid = ids[index];
            await dbRunAsync(
                'UPDATE User SET username = ? WHERE userid = ?',
                [`${baseUsername}_${userid}`, userid]
            );
        }
    }

    // Canonicalize User table to remove legacy columns like isadmin.
    try {
        await dbRunAsync('PRAGMA foreign_keys = OFF');
        await dbRunAsync('BEGIN TRANSACTION');

        await dbRunAsync(`CREATE TABLE IF NOT EXISTS User_canonical (
            userid INTEGER PRIMARY KEY AUTOINCREMENT,
            uname TEXT NOT NULL,
            username TEXT NOT NULL,
            email TEXT NOT NULL,
            password_hash TEXT,
            pin_hash TEXT,
            is_admin INTEGER NOT NULL DEFAULT 0,
            active INTEGER NOT NULL DEFAULT 1
        )`);

        await dbRunAsync(`INSERT INTO User_canonical (userid, uname, username, email, password_hash, pin_hash, is_admin, active)
            SELECT
                userid,
                COALESCE(NULLIF(TRIM(uname), ''), 'cashier'),
                LOWER(COALESCE(NULLIF(TRIM(username), ''), COALESCE(NULLIF(TRIM(uname), ''), 'cashier'))),
                COALESCE(NULLIF(TRIM(email), ''), LOWER(REPLACE(COALESCE(NULLIF(TRIM(username), ''), COALESCE(NULLIF(TRIM(uname), ''), 'cashier')), ' ', '')) || '@local.user'),
                password_hash,
                pin_hash,
                COALESCE(is_admin, 0),
                COALESCE(active, 1)
            FROM User`);

        await dbRunAsync('DROP TABLE User');
        await dbRunAsync('ALTER TABLE User_canonical RENAME TO User');
        await dbRunAsync('CREATE UNIQUE INDEX IF NOT EXISTS idx_user_username_nocase ON User(username COLLATE NOCASE)');

        await dbRunAsync('COMMIT');
    } catch (error) {
        try {
            await dbRunAsync('ROLLBACK');
        } catch (_) {
            // Ignore rollback failures.
        }
        throw error;
    } finally {
        await dbRunAsync('PRAGMA foreign_keys = ON');
    }
}

async function runDatabaseSanityChecks() {
    const integrityRows = await dbAllAsync('PRAGMA integrity_check');
    const integrityHasIssue = integrityRows.some((row) => String(row?.integrity_check || '').toLowerCase() !== 'ok');
    if (integrityHasIssue) {
        throw new Error(`SQLite integrity_check failed: ${JSON.stringify(integrityRows)}`);
    }

    const foreignKeyRows = await dbAllAsync('PRAGMA foreign_key_check');
    if (foreignKeyRows.length > 0) {
        throw new Error(`SQLite foreign_key_check failed: ${JSON.stringify(foreignKeyRows)}`);
    }
}

async function ensureAppSetupSchema() {
    const cols = await dbAllAsync('PRAGMA table_info(AppSetup)');
    const hasRemoteProjectUrl = cols.some((col) => col.name === 'remote_project_url');
    const hasRemoteAnonKey = cols.some((col) => col.name === 'remote_anon_key');
    const hasAppInstanceId = cols.some((col) => col.name === 'app_instance_id');
    const hasAppVersion = cols.some((col) => col.name === 'app_version');
    const hasPlatform = cols.some((col) => col.name === 'platform');
    const hasArch = cols.some((col) => col.name === 'arch');

    if (!hasRemoteProjectUrl) {
        await dbRunAsync('ALTER TABLE AppSetup ADD COLUMN remote_project_url TEXT');
    }

    if (!hasRemoteAnonKey) {
        await dbRunAsync('ALTER TABLE AppSetup ADD COLUMN remote_anon_key TEXT');
    }

    if (!hasAppInstanceId) {
        await dbRunAsync('ALTER TABLE AppSetup ADD COLUMN app_instance_id TEXT');
    }

    if (!hasAppVersion) {
        await dbRunAsync('ALTER TABLE AppSetup ADD COLUMN app_version TEXT');
    }

    if (!hasPlatform) {
        await dbRunAsync('ALTER TABLE AppSetup ADD COLUMN platform TEXT');
    }

    if (!hasArch) {
        await dbRunAsync('ALTER TABLE AppSetup ADD COLUMN arch TEXT');
    }
}

async function ensureCategorySchema() {
    const cols = await dbAllAsync('PRAGMA table_info(Category)');
    const hasActive = cols.some((col) => col.name === 'active');

    if (!hasActive) {
        await dbRunAsync('ALTER TABLE Category ADD COLUMN active INTEGER NOT NULL DEFAULT 1');
    }

    await dbRunAsync('UPDATE Category SET active = 1 WHERE active IS NULL');
}

async function ensureBillingTableSchema() {
    await dbRunAsync(`CREATE TABLE IF NOT EXISTS DiningTable (
        table_id INTEGER PRIMARY KEY AUTOINCREMENT,
        table_name TEXT NOT NULL,
        table_number TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);

    const orderCols = await dbAllAsync('PRAGMA table_info(Orders)');
    const hasOrderTableId = orderCols.some((col) => col.name === 'table_id');
    const hasOrderTableLabel = orderCols.some((col) => col.name === 'table_label');

    if (!hasOrderTableId) {
        await dbRunAsync('ALTER TABLE Orders ADD COLUMN table_id INTEGER');
    }
    if (!hasOrderTableLabel) {
        await dbRunAsync('ALTER TABLE Orders ADD COLUMN table_label TEXT');
    }

    const heldCols = await dbAllAsync('PRAGMA table_info(HeldOrders)');
    const hasHeldTableId = heldCols.some((col) => col.name === 'table_id');
    const hasHeldTableLabel = heldCols.some((col) => col.name === 'table_label');
    const hasHeldDate = heldCols.some((col) => col.name === 'date');

    if (!hasHeldTableId) {
        await dbRunAsync('ALTER TABLE HeldOrders ADD COLUMN table_id INTEGER');
    }
    if (!hasHeldTableLabel) {
        await dbRunAsync('ALTER TABLE HeldOrders ADD COLUMN table_label TEXT');
    }
    if (!hasHeldDate) {
        await dbRunAsync("ALTER TABLE HeldOrders ADD COLUMN date TEXT NOT NULL DEFAULT (datetime('now'))");
    }

    const deletedCols = await dbAllAsync('PRAGMA table_info(DeletedOrders)');
    const hasDeletedTableId = deletedCols.some((col) => col.name === 'table_id');
    const hasDeletedTableLabel = deletedCols.some((col) => col.name === 'table_label');

    if (!hasDeletedTableId) {
        await dbRunAsync('ALTER TABLE DeletedOrders ADD COLUMN table_id INTEGER');
    }
    if (!hasDeletedTableLabel) {
        await dbRunAsync('ALTER TABLE DeletedOrders ADD COLUMN table_label TEXT');
    }

    const totalTablesRow = await dbGetAsync('SELECT COUNT(*) AS count FROM DiningTable');
    if (Number(totalTablesRow?.count || 0) === 0) {
        for (let index = 1; index <= 10; index += 1) {
            await dbRunAsync(
                `INSERT INTO DiningTable (table_name, table_number, updated_at)
                 VALUES (?, ?, datetime('now'))`,
                [`Table ${index}`, String(index)]
            );
        }
    }
}

async function assertTableHasColumns(tableName, requiredColumns) {
    const columns = await dbAllAsync(`PRAGMA table_info(${tableName})`);
    const missingColumns = requiredColumns.filter((columnName) => !columns.some((column) => column.name === columnName));

    if (missingColumns.length > 0) {
        throw new Error(`Missing required columns on ${tableName}: ${missingColumns.join(', ')}`);
    }
}

async function insertUserRecord({
    name,
    username,
    email,
    passwordHash = null,
    pinHash = null,
    isAdmin = 0,
    active = 1,
}) {
    await dbRunAsync(
        `INSERT INTO User (uname, username, email, password_hash, pin_hash, is_admin, active)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
            name,
            String(username || '').trim().toLowerCase(),
            email,
            passwordHash,
            pinHash,
            isAdmin ? 1 : 0,
            active ? 1 : 0,
        ]
    );
}

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
});

async function getOrCreateCashierUser(preferredUsername) {
    const normalizedUsername = String(preferredUsername || 'cashier').trim().toLowerCase() || 'cashier';
    const safeName = normalizedUsername;
    const safeEmail = `${normalizedUsername.replace(/\s+/g, '')}@local.user`;

    let user = await dbGetAsync(
        "SELECT userid, uname, username, email FROM User WHERE username = ?",
        [normalizedUsername]
    );

    if (!user) {
        user = await dbGetAsync("SELECT userid, uname, username, email FROM User ORDER BY userid ASC LIMIT 1");
    }

    if (!user) {
        await insertUserRecord({
            name: safeName,
            username: normalizedUsername,
            email: safeEmail,
            isAdmin: 0,
            active: 1,
        });
        user = await dbGetAsync("SELECT userid, uname, username, email FROM User ORDER BY userid DESC LIMIT 1");
    }

    return {
        name: user.uname,
        username: user.username,
        userid: user.userid,
        email: user.email
    };
}

function isValidPin(pin) {
    return /^\d{4,8}$/.test(String(pin || ''));
}

function isValidActivationKeyFormat(keyCode) {
    return /^[A-Z0-9]{5}(?:-[A-Z0-9]{5}){4}$/.test(String(keyCode || '').trim().toUpperCase());
}

function toSessionUser(row) {
    return {
        userid: row.userid,
        name: row.uname,
        username: row.username,
        email: row.email,
        isAdmin: Number(row.is_admin || 0) === 1,
    };
}

async function getAppSetupRow() {
    return dbGetAsync('SELECT * FROM AppSetup WHERE id = 1');
}

async function isAppInitialized() {
    const row = await getAppSetupRow();
    return Number(row?.is_initialized || 0) === 1;
}

function getRemoteAuthConfig(setupRow) {
    const projectUrl = String(setupRow?.remote_project_url || DEFAULT_SUPABASE_PROJECT_URL || '').trim();
    const anonKey = String(setupRow?.remote_anon_key || '').trim();

    if (!projectUrl || !anonKey) {
        return null;
    }

    return {
        projectUrl,
        anonKey,
        functionsBaseUrl: `${projectUrl.replace(/\/+$/, '')}/functions/v1`,
    };
}

async function callRemoteAuthFunction(remoteConfig, slug, payload) {
    if (!remoteConfig?.functionsBaseUrl || !remoteConfig?.anonKey) {
        throw new Error('Remote auth configuration is missing.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    let response;
    try {
        response = await fetch(`${remoteConfig.functionsBaseUrl}/${slug}`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${remoteConfig.anonKey}`,
                apikey: remoteConfig.anonKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload || {}),
            signal: controller.signal,
        });
    } catch (fetchErr) {
        if (fetchErr.name === 'AbortError') {
            throw new Error(`Remote function ${slug} timed out after 15 seconds.`);
        }
        throw fetchErr;
    } finally {
        clearTimeout(timeout);
    }

    let data = null;
    try {
        data = await response.json();
    } catch (_) {
        data = null;
    }

    if (!response.ok || !data?.success) {
        const message = data?.message || `Remote function ${slug} failed.`;
        throw new Error(message);
    }

    return data;
}

async function ensureLocalUserFromRemote(remoteUser) {
    const username = String(remoteUser?.username || '').trim().toLowerCase();
    if (!username) {
        throw new Error('Remote user payload is invalid.');
    }

    let localUser = await dbGetAsync(
        `SELECT userid, uname, username, email, is_admin
         FROM User
         WHERE LOWER(username) = LOWER(?)
         LIMIT 1`,
        [username]
    );

    if (!localUser) {
        await insertUserRecord({
            name: String(remoteUser?.name || username),
            username,
            email: `${username}@local.user`,
            isAdmin: remoteUser?.isAdmin ? 1 : 0,
            active: 1,
        });

        localUser = await dbGetAsync(
            `SELECT userid, uname, username, email, is_admin
             FROM User
             WHERE LOWER(username) = LOWER(?)
             ORDER BY userid DESC
             LIMIT 1`,
            [username]
        );
    }

    return toSessionUser(localUser);
}

async function authenticateByPassword(username, password) {
    const normalized = String(username || '').trim().toLowerCase();
    const candidate = await dbGetAsync(
        `SELECT userid, uname, username, email, is_admin, active, password_hash
         FROM User
         WHERE LOWER(username) = LOWER(?) AND active = 1
         LIMIT 1`,
        [normalized]
    );

    if (!candidate || !compareSecret(password, candidate.password_hash)) {
        return null;
    }

    return toSessionUser(candidate);
}

async function authenticateByPin(pin) {
    const users = await dbAllAsync(
        `SELECT userid, uname, username, email, is_admin, active, pin_hash
         FROM User
         WHERE active = 1 AND pin_hash IS NOT NULL`
    );

    for (const candidate of users) {
        if (compareSecret(pin, candidate.pin_hash)) {
            return toSessionUser(candidate);
        }
    }

    return null;
}

async function authenticateLoginPayload(payload) {
    const initialized = await isAppInitialized();
    if (!initialized) {
        return null;
    }

    const method = String(payload?.method || 'password').toLowerCase();

    if (method === 'pin') {
        const pin = String(payload?.pin || '');
        if (!isValidPin(pin)) {
            return null;
        }
        return authenticateByPin(pin);
    }

    const { username, password } = normalizeLoginInput(payload?.username, payload?.password);
    if (!username || !password) {
        return null;
    }

    return authenticateByPassword(username, password);
}

async function ensureAdminSession() {
    const sessionUser = store.get('sessionUser');
    if (!sessionUser || !sessionUser.userid) {
        throw new Error('No active session found.');
    }

    if (!sessionUser.isAdmin) {
        throw new Error('Admin privileges required.');
    }

    return sessionUser;
}

// === Create main window ===
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
                icon: path.join(projectRoot, "assets/images", "favicon.ico"),
    show: false,
    fullscreen: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '..', 'preload.js'),
      devTools: !app.isPackaged,
    },
  });

  Menu.setApplicationMenu(null);

    const cspHeader = app.isPackaged
        ? "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self';"
        : "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' http://localhost:5173 ws://localhost:5173;";

    // Set CSP header (strict in packaged builds, relaxed for local dev tooling)
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
                'Content-Security-Policy': [cspHeader],
      },
    });
  });

  // Enable developer tools with F12 key (dev only)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (!app.isPackaged && input.key === 'F12' && input.type === 'keyDown') {
      mainWindow.webContents.toggleDevTools();
    }
  });

  // Add machine-specific debugging for blank screen issues
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('✅ Page loaded:', mainWindow.webContents.getURL());
    
    // Force a repaint to fix potential rendering issues
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.executeJavaScript('void 0').catch(() => {});
      }
    }, 100);
  });

  // Handle renderer crashes with crash-count limit to prevent infinite reload loop
  let rendererCrashCount = 0;
  let crashResetTimer = null;

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    rendererCrashCount += 1;
    console.error(`❌ Renderer process crashed (${rendererCrashCount}/3):`, details);

    // Reset crash counter after 30 seconds of stability
    if (crashResetTimer) clearTimeout(crashResetTimer);
    crashResetTimer = setTimeout(() => { rendererCrashCount = 0; }, 30000);

    if (rendererCrashCount >= 3) {
      console.error('❌ Too many renderer crashes, showing error dialog');
      dialog.showErrorBox(
        'Application Error',
        'The application has crashed multiple times. Please restart the application. If the problem persists, contact support.'
      );
      return;
    }

    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.reload();
      }
    }, 1000);
  });

  // Handle unresponsive renderer
  mainWindow.webContents.on('unresponsive', () => {
    console.warn('⚠️ Renderer became unresponsive');
  });

  mainWindow.webContents.on('responsive', () => {
    console.log('✅ Renderer became responsive again');
  });

    // Load React app from Vite dev server or production build
    mainWindow.loadURL(getMainWindowUrl()).catch(console.error);

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();

        if (process.env.OPEN_DEVTOOLS === "1") {
            mainWindow.webContents.openDevTools({ mode: "detach" });
        }
  });
}

// === Do startup tasks (Express, DB, etc.) ===
async function runStartupTasks() {
  await initStore();
}

// === Setup IPC handlers ===
function setupIPC() {
    printService.configure({ store, getFilePath });
        const updateService = new UpdateService({
            getSetupRow: getAppSetupRow,
            getRemoteAuthConfig,
            getAppIdentity: () => ({
                appInstanceId: String(store.get('appInstanceId') || '').trim(),
                appVersion: app.getVersion(),
                platform: process.platform,
                arch: process.arch,
            }),
        });

        updateService.on('status', (payload) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('update-status', payload);
            }
        });

        updateService.on('progress', (payload) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('update-progress', payload);
            }
        });

        updateService.on('error', (payload) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('update-error', payload);
            }
        });

    ipcMain.handle("login", async (event, payload) => {
    try {
                        const user = await authenticateLoginPayload(payload);
            if (!user) {
                return null;
            }

            console.log("Login successful:", user.username);
            store.set("sessionUser", user);
            return user;
    } catch (err) {
            console.error("Local login error:", err.message);
      return null;
    }
  });

  ipcMain.handle("get-session-user", () => {
    return store.get("sessionUser") || null;
  });

    ipcMain.handle('get-app-identity', () => {
            return {
                    appInstanceId: String(store.get('appInstanceId') || '').trim(),
                    appVersion: app.getVersion(),
                    platform: process.platform,
                    arch: process.arch,
            };
    });

    ipcMain.handle('get-app-setup-status', async () => {
        try {
            const setupRow = await getAppSetupRow();
            const isInitialized = Number(setupRow?.is_initialized || 0) === 1;

            return {
                isInitialized,
                setup: isInitialized
                    ? {
                            tenantId: setupRow.tenant_id,
                            tenantName: setupRow.tenant_name,
                            tenantLocation: setupRow.tenant_location,
                            contactName: setupRow.contact_name,
                            contactPhone: setupRow.contact_phone,
                            contactEmail: setupRow.contact_email,
                            contactAddress: setupRow.contact_address,
                            activatedAt: setupRow.activated_at,
                        }
                    : null,
            };
        } catch (error) {
            console.error('Failed to read setup status:', error);
            return { isInitialized: false, setup: null };
        }
    });

    ipcMain.handle('initialize-app-setup', async (event, payload) => {
        try {
            const alreadyInitialized = await isAppInitialized();
            if (alreadyInitialized) {
                return { success: false, message: 'App is already initialized.' };
            }

            // Setup-only credentials are accepted for one-time provisioning control.
            // They are intentionally not stored in local database or electron-store.
            const setupUsername = String(payload?.setupUsername || '').trim();
            const setupPassword = String(payload?.setupPassword || '');
            const supabaseProjectUrl = String(payload?.supabaseProjectUrl || DEFAULT_SUPABASE_PROJECT_URL).trim();
            const supabaseAnonKey = String(payload?.supabaseAnonKey || '').trim();
            const appInstanceId = String(payload?.appInstanceId || store.get('appInstanceId') || crypto.randomUUID()).trim();
            const appVersion = String(payload?.appVersion || app.getVersion()).trim();
            const platform = String(payload?.platform || process.platform).trim();
            const arch = String(payload?.arch || process.arch).trim();

            const activationKey = String(payload?.activationKey || '').trim().toUpperCase();
            const masterPin = String(payload?.masterPin || '').trim();
            const tenantId = String(payload?.tenantId || '').trim();
            const tenantName = String(payload?.tenantName || '').trim();
            const tenantLocation = String(payload?.tenantLocation || '').trim();
            const contactName = String(payload?.contactName || '').trim();
            const contactPhone = String(payload?.contactPhone || '').trim();
            const contactEmail = String(payload?.contactEmail || '').trim();
            const contactAddress = String(payload?.contactAddress || '').trim();
            const adminName = String(payload?.adminName || '').trim();
            const adminUsername = String(payload?.adminUsername || '').trim().toLowerCase();
            const adminPassword = String(payload?.adminPassword || '');

            if (!setupUsername || !setupPassword) {
                return { success: false, message: 'Setup username and password are required for one-time provisioning.' };
            }

            if (!supabaseProjectUrl || !supabaseAnonKey) {
                return { success: false, message: 'Supabase project URL and anon key are required.' };
            }

            if (!isValidActivationKeyFormat(activationKey)) {
                return { success: false, message: 'Invalid activation key format.' };
            }

            if (!tenantId || !tenantName || !tenantLocation || !contactName || !contactPhone) {
                return { success: false, message: 'Tenant and contact details are required.' };
            }

            if (!adminName || !adminUsername || adminPassword.length < 6) {
                return { success: false, message: 'Admin name, username, and password (min 6 chars) are required.' };
            }

            if (!isValidPin(masterPin)) {
                return { success: false, message: 'Master PIN must be 4 to 8 digits.' };
            }

            const remoteConfig = {
                projectUrl: supabaseProjectUrl,
                anonKey: supabaseAnonKey,
                functionsBaseUrl: `${supabaseProjectUrl.replace(/\/+$/, '')}/functions/v1`,
            };

            await callRemoteAuthFunction(remoteConfig, 'initialize-tenant', {
                activationKey,
                tenantId,
                tenantName,
                tenantLocation,
                contactName,
                contactPhone,
                contactEmail,
                contactAddress,
                masterPin,
                createSubscription: Boolean(payload?.createSubscription),
                adminName,
                adminUsername,
                adminPassword,
                appInstanceId,
                appVersion,
                platform,
                arch,
            });

            await dbRunAsync('BEGIN TRANSACTION');

            const keyRow = await dbGetAsync(
                'SELECT id, key_code, status FROM ActivationKey WHERE key_code = ? LIMIT 1',
                [activationKey]
            );

            if (!keyRow) {
                await dbRunAsync(
                    `INSERT INTO ActivationKey (key_code, status, used_by_tenant_id, used_at)
                     VALUES (?, 'used', ?, datetime('now'))`,
                    [activationKey, tenantId]
                );
            }

            await dbRunAsync(
                `INSERT INTO AppSetup (
                    id, is_initialized, activation_key, tenant_id, tenant_name, tenant_location,
                    contact_name, contact_phone, contact_email, contact_address, master_pin_hash,
                    app_instance_id, app_version, platform, arch,
                    remote_project_url, remote_anon_key, activated_at, updated_at
                ) VALUES (1, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
                [
                    activationKey,
                    tenantId,
                    tenantName,
                    tenantLocation,
                    contactName,
                    contactPhone,
                    contactEmail || null,
                    contactAddress || null,
                    hashSecret(masterPin),
                    appInstanceId,
                    appVersion,
                    platform,
                    arch,
                    supabaseProjectUrl,
                    supabaseAnonKey,
                ]
            );

            store.set('appInstanceId', appInstanceId);

            await insertUserRecord({
                name: adminName,
                username: adminUsername,
                email: contactEmail || `${adminUsername}@local.user`,
                passwordHash: hashSecret(adminPassword),
                pinHash: hashSecret(masterPin),
                isAdmin: 1,
                active: 1,
            });

            const createdUser = await dbGetAsync(
                `SELECT userid, uname, username, email, is_admin
                 FROM User
                 WHERE LOWER(username) = LOWER(?)
                 ORDER BY userid DESC
                 LIMIT 1`,
                [adminUsername]
            );

            if (keyRow) {
                await dbRunAsync(
                    `UPDATE ActivationKey
                     SET status = 'used', used_by_tenant_id = ?, used_at = datetime('now')
                     WHERE id = ?`,
                    [tenantId, keyRow.id]
                );
            }

            await dbRunAsync('COMMIT');

            // Save business info from setup data
            try {
                const businessInfo = {
                    businessName: tenantName,
                    address: tenantLocation,
                    ownerName: contactName,
                    phone: contactPhone,
                    email: contactEmail || '',
                    tagline: '',
                    hours: '',
                };
                const businessInfoPath = getFilePath('businessInfo.json');
                await fs.promises.writeFile(businessInfoPath, JSON.stringify(businessInfo, null, 4), 'utf-8');
            } catch (bizErr) {
                console.error('Failed to save initial business info:', bizErr);
            }

            const sessionUser = toSessionUser(createdUser);
            store.set('sessionUser', sessionUser);
            return { success: true, user: sessionUser };
        } catch (error) {
            try {
                await dbRunAsync('ROLLBACK');
            } catch (_) {
                // Ignore rollback failures.
            }
            console.error('Failed to initialize app setup:', error);
            return { success: false, message: error.message || 'Failed to complete setup.' };
        }
    });


    ipcMain.handle('get-update-status', async () => {
        return updateService.getStatus();
    });

    ipcMain.handle('get-subscription-status', async () => {
        try {
            const setupRow = await getAppSetupRow();
            if (!setupRow || Number(setupRow?.is_initialized || 0) !== 1) {
                return { success: false, message: 'App setup is incomplete.' };
            }

            const remoteConfig = getRemoteAuthConfig(setupRow);
            if (!remoteConfig) {
                return { success: false, message: 'Supabase configuration is missing.' };
            }

            const appInstanceId = String(store.get('appInstanceId') || '').trim();
            return await callRemoteAuthFunction(remoteConfig, 'subscription-status', {
                tenantId: String(setupRow.tenant_id || '').trim(),
                appInstanceId,
                appVersion: app.getVersion(),
                platform: process.platform,
                arch: process.arch,
            });
        } catch (error) {
            return { success: false, message: error.message || 'Failed to fetch subscription status.' };
        }
    });

    ipcMain.handle('check-for-updates', async () => {
        return updateService.checkForUpdates();
    });

    ipcMain.handle('download-update', async () => {
        return updateService.downloadLatestUpdate();
    });

    ipcMain.handle('install-update', async () => {
        return updateService.installDownloadedUpdate();
    });
  ipcMain.handle("logout", async () => {
    try {
      console.log("🔄 Starting logout process...");
      
      // Clear session data
      store.delete("sessionUser");
      
      if (mainWindow && !mainWindow.isDestroyed()) {
        // Step 1: Stop all current operations
        mainWindow.webContents.stop();
        
        // Step 2: Clear all possible caches
        await mainWindow.webContents.session.clearStorageData();
        await mainWindow.webContents.session.clearCache();
        
        // Step 3: Force garbage collection if available
        if (global.gc) {
          global.gc();
        }
        
        // Step 4: Wait for cleanup
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Step 5: Reload app entry (React dev/prod or legacy fallback)
        await mainWindow.loadURL(getMainWindowUrl());
        
        // Step 6: Ensure window focus
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.focus();
          }
        }, 200);
        
        console.log("✅ Logout completed successfully");
      }
      
      return true;
    } catch (error) {
      console.error("❌ Error during logout:", error);
      
      // Simple fallback: just clear session and reload login
      if (mainWindow && !mainWindow.isDestroyed()) {
        try {
                    console.log("Using simple logout fallback...");
                    await mainWindow.loadURL(getMainWindowUrl());
        } catch (fallbackError) {
          console.error("❌ Fallback also failed:", fallbackError);
        }
      }
      
      return false;
    }
  });

  // IPC handler for editing user profile
    ipcMain.handle("edit-user-profile", async (event, payload) => {
        try {
            const sessionUser = store.get('sessionUser');
            if (!sessionUser?.userid) {
                return { success: false, message: 'No active session found.' };
            }

            const userid = Number(payload?.userid);
            const name = String(payload?.name || '').trim();
            const username = String(payload?.username || '').trim().toLowerCase();
            const email = String(payload?.email || '').trim();

            if (!userid || !name || !username) {
                return { success: false, message: 'Name and username are required.' };
            }

            if (Number(sessionUser.userid) !== userid && !sessionUser.isAdmin) {
                return { success: false, message: 'Not allowed to edit this profile.' };
            }

            const existing = await dbGetAsync(
                'SELECT userid FROM User WHERE LOWER(username) = LOWER(?) AND userid != ? LIMIT 1',
                [username, userid]
            );
            if (existing) {
                return { success: false, message: 'Username already in use.' };
            }

            await dbRunAsync(
                'UPDATE User SET uname = ?, username = ?, email = ? WHERE userid = ?',
                [name, username, email || `${username}@local.user`, userid]
            );

            if (Number(sessionUser.userid) === userid) {
                const updated = { ...sessionUser, name, username, email: email || `${username}@local.user` };
                store.set('sessionUser', updated);
            }

            return { success: true, message: 'Profile updated successfully.' };
        } catch (error) {
            console.error('Edit user profile error:', error);
            return { success: false, message: 'Failed to update profile.' };
        }
  });

  // IPC handler for changing password
    ipcMain.handle("change-user-password", async (event, payload) => {
        try {
            const sessionUser = store.get('sessionUser');
            if (!sessionUser?.userid) {
                return { success: false, message: 'No active session found.' };
            }

            const userid = Number(payload?.userid);
            const currentPassword = String(payload?.currentPassword || '');
            const newPassword = String(payload?.newPassword || '');

            if (Number(sessionUser.userid) !== userid) {
                return { success: false, message: 'Not allowed to change this password.' };
            }

            if (newPassword.length < 6) {
                return { success: false, message: 'New password must be at least 6 characters.' };
            }

            const user = await dbGetAsync('SELECT password_hash FROM User WHERE userid = ? LIMIT 1', [userid]);
            if (!user || !compareSecret(currentPassword, user.password_hash)) {
                return { success: false, message: 'Current password is incorrect.' };
            }

            await dbRunAsync('UPDATE User SET password_hash = ? WHERE userid = ?', [hashSecret(newPassword), userid]);
            return { success: true, message: 'Password changed successfully.' };
        } catch (error) {
            console.error('Change password error:', error);
            return { success: false, message: 'Failed to change password.' };
        }
  });

  // IPC handler for adding new user
    ipcMain.handle("add-new-user", async (event, payload) => {
        try {
            const sessionUser = await ensureAdminSession();
            const setupRow = await getAppSetupRow();
            const remoteConfig = getRemoteAuthConfig(setupRow);

            const name = String(payload?.name || '').trim();
            const username = String(payload?.username || '').trim().toLowerCase();
            const email = String(payload?.email || '').trim();
            const password = String(payload?.password || '');
            const pin = String(payload?.pin || '').trim();
            const adminPassword = String(payload?.adminPassword || '');

            if (!name || !username || password.length < 6 || !isValidPin(pin)) {
                return { success: false, message: 'Name, username, password (min 6), and PIN (4-8 digits) are required.' };
            }

            if (remoteConfig && !adminPassword) {
                return { success: false, message: 'Admin password is required to sync employee to server.' };
            }

            const existing = await dbGetAsync('SELECT userid FROM User WHERE LOWER(username) = LOWER(?) LIMIT 1', [username]);
            if (existing) {
                return { success: false, message: 'Username already exists.' };
            }

            if (remoteConfig) {
                await callRemoteAuthFunction(remoteConfig, 'admin-add-employee', {
                    tenantId: setupRow.tenant_id,
                    adminUsername: sessionUser.username,
                    adminPassword,
                    name,
                    username,
                    email,
                    password,
                    pin,
                });
            }

            await insertUserRecord({
                name,
                username,
                email: email || `${username}@local.user`,
                passwordHash: hashSecret(password),
                pinHash: hashSecret(pin),
                isAdmin: 0,
                active: 1,
            });

            return { success: true, message: 'Employee account created.' };
        } catch (error) {
            console.error('Add employee user error:', error);
            return { success: false, message: error.message || 'Failed to add employee.' };
        }
    });

    ipcMain.handle('get-tenant-users', async () => {
        try {
            await ensureAdminSession();
            const rows = await dbAllAsync(
                `SELECT userid, uname, username, email, is_admin, active
                 FROM User
                 ORDER BY is_admin DESC, uname ASC`
            );

            return {
                success: true,
                users: rows.map((row) => ({
                    userid: row.userid,
                    name: row.uname,
                    username: row.username,
                    email: row.email,
                    isAdmin: Number(row.is_admin || 0) === 1,
                    active: Number(row.active || 0) === 1,
                })),
            };
        } catch (error) {
            console.error('Get tenant users error:', error);
            return { success: false, message: error.message || 'Failed to fetch users.', users: [] };
        }
    });

    ipcMain.handle('reset-user-pin', async (event, payload) => {
        try {
            const sessionUser = await ensureAdminSession();
            const setupRow = await getAppSetupRow();
            const remoteConfig = getRemoteAuthConfig(setupRow);

            const userid = Number(payload?.userid);
            const newPin = String(payload?.newPin || '').trim();
            const adminPassword = String(payload?.adminPassword || '');

            if (!userid || !isValidPin(newPin)) {
                return { success: false, message: 'Valid user and new PIN are required.' };
            }

            const targetUser = await dbGetAsync(
                'SELECT username FROM User WHERE userid = ? LIMIT 1',
                [userid]
            );
            if (!targetUser) {
                return { success: false, message: 'Target user not found.' };
            }

            if (remoteConfig) {
                if (!adminPassword) {
                    return { success: false, message: 'Admin password is required to sync PIN reset to server.' };
                }

                await callRemoteAuthFunction(remoteConfig, 'admin-reset-pin', {
                    tenantId: setupRow.tenant_id,
                    adminUsername: sessionUser.username,
                    adminPassword,
                    targetUsername: targetUser.username,
                    newPin,
                });
            }

            await dbRunAsync('UPDATE User SET pin_hash = ? WHERE userid = ?', [hashSecret(newPin), userid]);
            return { success: true, message: 'PIN reset successfully.' };
        } catch (error) {
            console.error('Reset user pin error:', error);
            return { success: false, message: error.message || 'Failed to reset PIN.' };
        }
  });

  ipcMain.handle("get-printer-config", () => {
        const config = printService.getStoredConfig();
        if (!config) {
            return {
                vendorId: '0x0525',
                productId: '0xA700',
                vendorIdDec: 0x0525,
                productIdDec: 0xA700,
            };
        }
        return config;
  });

    ipcMain.handle("save-printer-config", async (event, config) => {
    try {
            const normalized = printService.normalizeConfig(config);
            if (!normalized) {
                throw new Error('Both Vendor ID and Product ID are required in hex or decimal format');
      }

            store.set('printerConfig', {
                vendorId: normalized.vendorId,
                productId: normalized.productId,
            });

            const initResult = await printService.init(normalized);
            return {
                success: true,
                config: normalized,
                ready: initResult.success,
                warning: initResult.success ? '' : initResult.error,
            };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

    ipcMain.handle('printer:list', async () => {
        return printService.listPrinters();
    });

    ipcMain.handle('printer:status', () => {
        return printService.getStatus();
    });

    ipcMain.handle('printer:test', async (_event, payload) => {
        const config = payload?.vendorId && payload?.productId
            ? { vendorId: payload.vendorId, productId: payload.productId }
            : null;
        return printService.testPrint(config);
    });

    ipcMain.handle('printer:print-bill', async (_event, payload) => {
        const retries = Number(payload?.retries ?? 2);
        return printService.safePrint('bill', payload, retries);
    });

    ipcMain.handle('printer:print-kot', async (_event, payload) => {
        const retries = Number(payload?.retries ?? 2);
        return printService.safePrint('kot', payload, retries);
    });

    ipcMain.handle('printer:reprint-last', async (_event, payload) => {
        const retries = Number(payload?.retries ?? 1);
        return printService.reprintLast(retries);
    });
}

// === App lifecycle ===
app.whenReady().then(async () => {
    if (!gotSingleInstanceLock) {
        return;
    }

  try {
    await runStartupTasks();
        await initializeDatabaseConnection();
    createMainWindow();
    setupIPC();
  } catch (err) {
    console.error("Startup error:", err);
  }
});

app.on('second-instance', () => {
        if (mainWindow) {
                if (mainWindow.isMinimized()) {
                        mainWindow.restore();
                }
                mainWindow.focus();
        }
});

app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        closeDatabase();
        app.quit();
    }
});

function closeDatabase() {
    if (db) {
        try {
            db.close();
            console.log("Database connection closed");
        } catch (err) {
            console.error("Error closing database", err);
        }
    }
}

app.on('will-quit', () => {
  console.log("App is quitting. Cleaning up...");
});


//----------------------------------------------ANALYTICS STARTS HERE--------------------------------------------------------------
// Fetch Today's Items for Item Summary
// Item Summary
ipcMain.on("get-item-summary", (event, { startDate, endDate }) => {
    const query = `
        SELECT 
            FoodItem.fname AS item, 
            SUM(OrderDetails.quantity) AS quantity, 
            SUM(OrderDetails.quantity * FoodItem.cost) AS revenue,
            FoodItem.category,
            Category.catname AS categoryName
        FROM Orders
        JOIN OrderDetails ON Orders.billno = OrderDetails.orderid
        JOIN FoodItem ON OrderDetails.foodid = FoodItem.fid
        JOIN Category ON FoodItem.category = Category.catid
        WHERE date(Orders.date) BETWEEN date(?) AND date(?)
        GROUP BY FoodItem.fid
        ORDER BY Category.catname, FoodItem.fname
    `;

    try {
        const rows = dbAllAsync(query, [startDate, endDate]);
        event.reply("item-summary-response", { success: true, items: rows });
    } catch (err) {
        console.error("Error fetching item summary:", err);
        event.reply("item-summary-response", { success: false, items: [] });
    }
});
// IPC handler to get today's revenue
ipcMain.handle('get-todays-revenue', () => {
    const today = getLocalDateString();
    const row = dbGetAsync(`SELECT SUM(price) AS totalRevenue FROM Orders WHERE date LIKE ?`, [`${today}%`]);
    return row?.totalRevenue || 0;
});

ipcMain.handle('get-todays-sales', () => {
    const today = getLocalDateString();
    const row = dbGetAsync(`SELECT COUNT(*) AS totalSales FROM Orders WHERE date LIKE ?`, [`${today}%`]);
    return row?.totalSales || 0;
});

ipcMain.handle('get-todays-tax', () => {
    const today = getLocalDateString();
    const row = dbGetAsync(`SELECT SUM(tax) AS totalTax FROM Orders WHERE date LIKE ?`, [`${today}%`]);
    return row?.totalTax || 0;
});

ipcMain.handle('get-todays-discounted-orders', () => {
    const today = getLocalDateString();
    const row = dbGetAsync(`SELECT COUNT(*) AS discountedCount FROM DiscountedOrders WHERE billno IN (SELECT billno FROM Orders WHERE date LIKE ?)`, [`${today}%`]);
    return row?.discountedCount || 0;
});

ipcMain.handle('get-todays-deleted-orders', () => {
    const today = getLocalDateString();
    const row = dbGetAsync(`SELECT COUNT(*) AS deletedCount FROM DeletedOrders WHERE date LIKE ?`, [`${today}%`]);
    return row?.deletedCount || 0;
});

ipcMain.handle('get-yesterdays-revenue', () => {
    const today = getLocalDateString();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayDate = getLocalDateString(yesterday);
    const row = dbGetAsync(`SELECT SUM(price) AS totalRevenue FROM Orders WHERE date LIKE ?`, [`${yesterdayDate}%`]);
    return row?.totalRevenue || 0;
});

// IPC handler to get today's most sold items
ipcMain.handle('get-most-sold-items', () => {
    const today = getLocalDateString();
    const rows = dbAllAsync(`
        SELECT f.fname, SUM(od.quantity) AS totalQuantity
        FROM OrderDetails od
        JOIN Orders o ON od.orderid = o.billno
        JOIN FoodItem f ON od.foodid = f.fid
        WHERE o.date LIKE ?
        GROUP BY f.fid
        ORDER BY totalQuantity DESC
        LIMIT 2
    `, [`${today}%`]);
    return rows.map(row => row.fname);
});

ipcMain.handle('get-most-sold-categories', () => {
    const today = getLocalDateString();
    const rows = dbAllAsync(`
        SELECT c.catname, SUM(od.quantity) AS totalQuantity
        FROM OrderDetails od
        JOIN Orders o ON od.orderid = o.billno
        JOIN FoodItem f ON od.foodid = f.fid
        JOIN Category c ON f.category = c.catid
        WHERE o.date LIKE ?
        GROUP BY c.catid
        ORDER BY totalQuantity DESC
        LIMIT 2
    `, [`${today}%`]);
    return rows.map(row => row.catname);
});

ipcMain.handle('get-highest-revenue-items', () => {
    const today = getLocalDateString();
    const rows = dbAllAsync(`
        SELECT f.fname, SUM(od.quantity * f.cost) AS totalRevenue
        FROM OrderDetails od
        JOIN Orders o ON od.orderid = o.billno
        JOIN FoodItem f ON od.foodid = f.fid
        WHERE o.date LIKE ?
        GROUP BY f.fid
        ORDER BY totalRevenue DESC
        LIMIT 2
    `, [`${today}%`]);
    return rows.map(row => row.fname);
});

ipcMain.handle('get-highest-revenue-category', () => {
    const today = getLocalDateString();
    const rows = dbAllAsync(`
        SELECT c.catname, SUM(od.quantity * f.cost) AS totalRevenue
        FROM OrderDetails od
        JOIN Orders o ON od.orderid = o.billno
        JOIN FoodItem f ON od.foodid = f.fid
        JOIN Category c ON f.category = c.catid
        WHERE o.date LIKE ?
        GROUP BY c.catid
        ORDER BY totalRevenue DESC
    `, [`${today}%`]);
    const highestRevenue = rows.length > 0 ? rows[0].totalRevenue : 0;
    return rows.filter(row => row.totalRevenue === highestRevenue).map(row => row.catname);
});

ipcMain.handle('get-category-wise-sales-data', (event, startDate, endDate) => {
    return dbAllAsync(`
        SELECT 
            Category.catid,
            Category.catname,
            SUM(OrderDetails.quantity) AS totalSales,
            SUM(OrderDetails.quantity * FoodItem.cost) AS totalRevenue
        FROM Orders
        INNER JOIN OrderDetails ON Orders.billno = OrderDetails.orderid
        INNER JOIN FoodItem ON OrderDetails.foodid = FoodItem.fid
        INNER JOIN Category ON FoodItem.category = Category.catid
        WHERE Orders.date BETWEEN ? AND ?
        GROUP BY Category.catid
    `, [startDate, endDate]);
});

ipcMain.handle('get-sales-overview-data', (event, startDate, endDate) => {
    return dbAllAsync(`
        SELECT 
            date,
            COUNT(billno) AS totalSales,
            SUM(price) AS totalRevenue
        FROM Orders
        WHERE date BETWEEN ? AND ?
        GROUP BY date
        ORDER BY date ASC
    `, [startDate, endDate]);
});

// Fetch top selling categories for a specific date range
ipcMain.on("get-top-selling-categories", (event, { startDate, endDate }) => {
    try {
        const rows = dbAllAsync(`
            SELECT 
                Orders.date,
                Category.catname AS category_name,
                SUM(OrderDetails.quantity) AS total_quantity
            FROM Orders
            JOIN OrderDetails ON Orders.billno = OrderDetails.orderid
            JOIN FoodItem ON OrderDetails.foodid = FoodItem.fid
            JOIN Category ON FoodItem.category = Category.catid
            WHERE date(Orders.date) BETWEEN date(?) AND date(?)
            GROUP BY Orders.date, Category.catid
            ORDER BY Orders.date, total_quantity DESC
        `, [startDate, endDate]);

        const topSellingCategories = {};
        rows.forEach(row => {
            if (!topSellingCategories[row.date] || row.total_quantity > topSellingCategories[row.date].total_quantity) {
                topSellingCategories[row.date] = {
                    category_name: row.category_name,
                    total_quantity: row.total_quantity,
                };
            }
        });

        const categoriesArray = Object.keys(topSellingCategories).map(date => ({
            date,
            category_name: topSellingCategories[date].category_name,
            total_quantity: topSellingCategories[date].total_quantity,
        }));

        event.reply("top-selling-categories-response", { success: true, categories: categoriesArray });
    } catch (err) {
        console.error("Error fetching top selling categories:", err);
        event.reply("top-selling-categories-response", { success: false, categories: [] });
    }
});

ipcMain.on('get-employee-analysis', (event, { startDate, endDate }) => {
    try {
        const rows = dbAllAsync(`
            SELECT 
                u.userid,
                u.uname as name,
                COUNT(DISTINCT o.billno) as order_count,
                COALESCE(SUM(od.quantity), 0) as total_units,
                COALESCE(SUM(od.quantity * fi.cost), 0) as total_revenue
            FROM User u
            LEFT JOIN Orders o ON u.userid = o.cashier 
                AND date(o.date) BETWEEN date(?) AND date(?)
            LEFT JOIN OrderDetails od ON o.billno = od.orderid
            LEFT JOIN FoodItem fi ON od.foodid = fi.fid
            GROUP BY u.userid
            ORDER BY total_revenue DESC
        `, [startDate, endDate]);

        event.reply('employee-analysis-response', { success: true, employees: rows || [] });
    } catch (err) {
        console.error('Query error:', err);
        event.reply('employee-analysis-response', { success: false, error: err.message });
    }
});

ipcMain.on('get-best-in-category', (event, { startDate, endDate }) => {
    try {
        const rows = dbAllAsync(`
            WITH RankedItems AS (
                SELECT 
                    c.catid,
                    c.catname,
                    f.fname,
                    SUM(od.quantity) AS total_quantity,
                    RANK() OVER (PARTITION BY c.catid ORDER BY SUM(od.quantity) DESC) AS rank
                FROM Orders o
                JOIN OrderDetails od ON o.billno = od.orderid
                JOIN FoodItem f ON od.foodid = f.fid
                JOIN Category c ON f.category = c.catid
                WHERE o.date BETWEEN ? AND ?
                GROUP BY c.catid, f.fid
            )
            SELECT 
                catid,
                catname,
                GROUP_CONCAT(fname, ', ') AS top_items
            FROM RankedItems
            WHERE rank = 1
            GROUP BY catid
            ORDER BY catname;
        `, [startDate, endDate]);

        const processedRows = rows.map(row => ({
            ...row,
            top_items: row.top_items ? row.top_items.split(', ') : []
        }));

        event.reply('best-in-category-response', { success: true, categories: processedRows });
    } catch (err) {
        console.error('Error fetching best in category data:', err);
        event.reply('best-in-category-response', { success: false, error: err.message });
    }
});

ipcMain.on('get-tax-on-items', (event, { startDate, endDate }) => {
    try {
        const rows = dbAllAsync(`
            SELECT 
                f.fname,
                SUM(od.quantity) as total_quantity,
                SUM(od.quantity) * f.sgst as total_sgst,
                SUM(od.quantity) * f.cgst as total_cgst,
                SUM(od.quantity) * f.tax as total_tax
            FROM Orders o
            JOIN OrderDetails od ON o.billno = od.orderid
            JOIN FoodItem f ON od.foodid = f.fid
            WHERE o.date BETWEEN ? AND ?
            GROUP BY f.fid
            ORDER BY f.fname;
        `, [startDate, endDate]);

        event.reply('tax-on-items-response', { success: true, items: rows });
    } catch (err) {
        console.error('Error fetching tax data:', err);
        event.reply('tax-on-items-response', { success: false, error: err.message });
    }
});
//----------------------------------------------ANALYTICS ENDS HERE--------------------------------------------------------------

ipcMain.on("print-kot-only", (event, { billItems, totalAmount, kot, orderId }) => {
    printService.safePrint('kot', { billItems, totalAmount, kot, orderId }, 2)
        .then((result) => {
            if (result?.success) {
                event.sender.send('print-kot-success', { kot, orderId });
            } else {
                event.sender.send('print-error', result?.error || 'Print failed');
            }
        })
        .catch((error) => {
            event.sender.send('print-error', `System error: ${error.message}`);
        });
});

// Function to generate only KOT (no customer receipt)
function generateKOTOnly(items, totalAmount, kot, orderId) {
    const template = loadReceiptTemplate({
        title: 'ALSPOS',
        subtitle: 'SJEC, VAMANJOOR',
        footer: 'Thank you for visiting!',
        itemHeader: 'ITEM',
        qtyHeader: 'QTY',
        priceHeader: 'PRICE',
        totalText: 'TOTAL: Rs.',
        kotItemHeader: 'ITEM',
        kotQtyHeader: 'QTY'
    });

    const itemWidth = 35;  // More space for food names
    const kotQtyWidth = 5;
    
    const kotItems = items.map(item => 
        `${item.name.substring(0, itemWidth).padEnd(itemWidth)}` +
        `${item.quantity.toString().padStart(kotQtyWidth)}`
    ).join('\n');
    
    // KOT receipt only (larger KOT #)
    const kotReceipt = `\x1B\x61\x01\x1D\x21\x11\x1B\x45\x01\x1B\x2D\x00${kot}
\x1B\x33\x03
\x1D\x21\x00\x1B\x45\x00\x1B\x2D\x00
Time: ${new Date().toLocaleTimeString()}\x1B\x61\x00\x1B\x45\x01\x1B\x2D\x00               Rs ${totalAmount.toFixed(2)}
------------------------------------------
ITEM                                   QTY
------------------------------------------
\x1B\x45\x00\x1B\x2D\x00
${kotItems}
\x1D\x56\x41\x00`;  // Partial cut

    return kotReceipt;
}

function loadReceiptTemplate(defaults) {
  try {
    const receiptFormatPath = getFilePath('receiptFormat.json');
    if (fs.existsSync(receiptFormatPath)) {
      const raw = fs.readFileSync(receiptFormatPath, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error("Failed to read receipt format:", err);
  }
  return defaults; // fall back to defaults
}

function saveReceiptTemplate(template) {
  try {
    const receiptFormatPath = getFilePath('receiptFormat.json');
    fs.writeFileSync(receiptFormatPath, JSON.stringify(template, null, 2));
    return true;
  } catch (err) {
    console.error("Failed to save receipt format:", err);
    return false;
  }
}

ipcMain.on("print-bill-only", (event, { billItems, totalAmount, kot, orderId, dateTime }) => {
    printService.safePrint('bill', { billItems, totalAmount, kot, orderId, dateTime }, 2)
        .then((result) => {
            if (result?.success) {
                event.sender.send('print-success');
            } else {
                event.sender.send('print-error', result?.error || 'Print failed');
            }
        })
        .catch((error) => {
            event.sender.send('print-error', `System error: ${error.message}`);
        });
});

// Function to generate only customer receipt (no KOT)
function generateBillOnly(items, totalAmount, kot, orderId, dateTime) {
    const template = loadReceiptTemplate({
        title: 'ALSPOS',
        subtitle: 'SJEC, VAMANJOOR',
        footer: 'Thank you for visiting!',
        itemHeader: 'ITEM',
        qtyHeader: 'QTY',
        priceHeader: 'PRICE',
        totalText: 'TOTAL: Rs.',
        kotItemHeader: 'ITEM',
        kotQtyHeader: 'QTY'
    });

    // Adjusted for 80mm paper (~42-48 chars per line)
    const customerItemWidth = 27;
    const itemWidth = 35;  // More space for food names
    const qtyWidth = 8;    // Right-aligned
    const priceWidth = 5;  // Right-aligned (for decimals)
    
    // Format items with better spacing
    const formattedItems = items.map(item => 
        `${item.name.substring(0, itemWidth).padEnd(customerItemWidth)}` +
        `${item.quantity.toString().padEnd(qtyWidth)}` +
        `${item.price.toFixed(2).padStart(priceWidth)}`
    ).join('\n');
    
    // Customer receipt only (optimized for 80mm)
    const customerReceipt = `\x1B\x40\x1B\x61\x01\x1D\x21\x11${template.title}
\x1D\x21\x00\x1B\x61\x01${template.subtitle}
\x1B\x61\x01\x1D\x21\x11\x1B\x45\x01
TOKEN: ${kot}
\x1D\x21\x00\x1B\x45\x00\x1B\x61\x00
Date:${dateTime || new Date().toLocaleString()}
Bill #: ${orderId}
${'-'.repeat(42)}
\x1B\x45\x01ITEM                      QTY      PRICE 
\x1B\x45\x00${formattedItems}
${'-'.repeat(42)}
\x1B\x45\x01                        TOTAL: Rs.${totalAmount.toFixed(2).padStart(2)}
\x1B\x45\x00\x1B\x61\x01${template.footer}
\x1D\x56\x41\x00`;  // Partial cut

    return customerReceipt;
}

// Saving the billing template after using edits in receipt editor section
ipcMain.on('get-receipt-template', (event, defaults) => {
  const template = loadReceiptTemplate(defaults);
  event.returnValue = template;
});

ipcMain.on('update-receipt-template', (event, updates) => {
  try {
    const current = loadReceiptTemplate({});
    const newTemplate = { ...current, ...updates, lastUpdated: new Date().toISOString() };
    saveReceiptTemplate(newTemplate);
    event.reply('receipt-template-updated', { success: true });
  } catch (err) {
    event.reply('receipt-template-updated', { success: false, error: err.message });
  }
});

ipcMain.on('get-order-for-printing', (event, billno) => {
    try {
        const order = dbGetAsync(`SELECT * FROM Orders WHERE billno = ?`, [billno]);
        if (!order) {
            event.reply('order-for-printing-response', { error: 'Order not found' });
            return;
        }

        const items = dbAllAsync(`
            SELECT f.fname, f.cost as item_price, od.quantity
            FROM OrderDetails od
            JOIN FoodItem f ON od.foodid = f.fid
            WHERE od.orderid = ?
        `, [billno]);

        const processedItems = items.map(item => ({
            fname: item.fname,
            quantity: item.quantity,
            price: item.item_price
        }));

        event.reply('order-for-printing-response', { order, items: processedItems });
    } catch (err) {
        console.error('Error fetching order for printing:', err);
        event.reply('order-for-printing-response', { error: err.message });
    }
});

ipcMain.handle('test-printer', async (_event, { vendorId, productId } = {}) => {
    const config = vendorId && productId ? { vendorId, productId } : null;
    return printService.testPrint(config);
});

function generateTestReceipt(testData) {
    const template = store.get('receiptTemplate', {
        title: 'ALSPOS',
        subtitle: 'SJEC, VAMANJOOR',
        footer: 'Thank you for visiting!',
        kotTitle: 'KITCHEN ORDER',
        itemHeader: 'ITEM',
        qtyHeader: 'QTY',
        priceHeader: 'PRICE',
        totalText: 'TOTAL: Rs.',
        kotItemHeader: 'ITEM',
        kotQtyHeader: 'QTY'
    });

    // Format test items
    const formattedItems = testData.items.map(item => 
        `${item.name.substring(0, 14).padEnd(14)}${item.quantity.toString().padStart(3)}${item.price.toFixed(2).padStart(8)}`
    ).join('\n');
    
    const kotItems = testData.items.map(item => 
        `${item.name.substring(0, 14).padEnd(14)}${item.quantity.toString().padStart(3)}`
    ).join('\n');
    
    // Test customer receipt
    const customerReceipt = `
\x1B\x40\x1B\x61\x01\x1D\x21\x11
TEST PRINT
\x1D\x21\x00
${template.title}
\x1B\x45\x01
Token No: ${testData.kot}
\x1B\x45\x00\x1B\x61\x00
Date: ${new Date().toLocaleString()}
BILL NUMBER: ${testData.orderId}
${'-'.repeat(32)}
\x1B\x45\x01
${template.itemHeader.padEnd(14)}${template.qtyHeader.padStart(3)}${template.priceHeader.padStart(8)}
\x1B\x45\x00
${formattedItems}
${'-'.repeat(32)}
\x1B\x45\x01
${template.totalText} ${testData.totalAmount.toFixed(2)}
\x1B\x45\x00\x1B\x61\x01
This is a test print
${template.footer}
\x1D\x56\x41\x10`;

    // Test KOT receipt
    const kotReceipt = `
\x1B\x61\x01\x1D\x21\x11
TEST KOT PRINT
\x1D\x21\x00
KOT #: ${testData.kot}
Time: ${new Date().toLocaleTimeString()}
${'-'.repeat(32)}
\x1B\x61\x00\x1B\x45\x01
${template.kotItemHeader.padEnd(14)}${template.kotQtyHeader.padStart(3)}
\x1B\x45\x00
${kotItems}
${'-'.repeat(32)}
\x1D\x56\x41\x10`;

    return customerReceipt + kotReceipt;
}


//------------------------------------------------Bill Printing Ends Here--------------------------------------------------
//-----------------HELD ORDERS-----------------
//DISPLAY HELD ORDERS
ipcMain.on('get-held-orders', (event) => {
    try {
        const heldOrders = dbAllAsync(`
            SELECT 
                HeldOrders.heldid, 
                User.uname AS cashier_name, 
                HeldOrders.price, 
                HeldOrders.sgst, 
                HeldOrders.cgst, 
                HeldOrders.tax, 
                HeldOrders.date,
                GROUP_CONCAT(FoodItem.fname || ' (x' || HeldOrderDetails.quantity || ')', ', ') AS food_items
            FROM HeldOrders
            JOIN User ON HeldOrders.cashier = User.userid
            JOIN HeldOrderDetails ON HeldOrders.heldid = HeldOrderDetails.heldid
            JOIN FoodItem ON HeldOrderDetails.foodid = FoodItem.fid
            GROUP BY HeldOrders.heldid
            ORDER BY HeldOrders.heldid DESC
        `);
        event.reply('held-orders-data', heldOrders);
    } catch (err) {
        console.error("Error fetching held orders:", err);
        event.reply('held-orders-data', []);
    }
});

ipcMain.on('get-held-order-details', (event, heldId) => {
    try {
        const orderDetails = dbGetAsync(`
            SELECT 
                GROUP_CONCAT(
                    FoodItem.fname || ' (x' || HeldOrderDetails.quantity || ')', ', '
                ) AS food_items,
                json_group_array(
                    json_object(
                        'foodid', FoodItem.fid,
                        'fname', FoodItem.fname,
                        'price', FoodItem.cost,
                        'quantity', HeldOrderDetails.quantity,
                        'category', FoodItem.category
                    )
                ) AS food_details
            FROM HeldOrderDetails
            JOIN FoodItem ON HeldOrderDetails.foodid = FoodItem.fid
            WHERE HeldOrderDetails.heldid = ?
        `, [heldId]);

        let foodDetails = orderDetails?.food_details ? JSON.parse(orderDetails.food_details) : [];
        event.reply('held-order-details-data', foodDetails, heldId);
    } catch (err) {
        console.error("Error fetching held order details:", err);
        event.reply('held-order-details-data', [], heldId);
    }
});


// Delete a held order
ipcMain.on('delete-held-order', async (event, heldId) => {
    try {
        await dbRunAsync('BEGIN TRANSACTION');
        await dbRunAsync('DELETE FROM HeldOrderDetails WHERE heldid = ?', [heldId]);
        await dbRunAsync('DELETE FROM HeldOrders WHERE heldid = ?', [heldId]);
        await dbRunAsync('COMMIT');
        event.reply('held-order-deleted', heldId);
    } catch (err) {
        try { await dbRunAsync('ROLLBACK'); } catch (_) {}
        console.error("Error deleting held order:", err);
        event.reply('held-order-deleted', null);
    }
});



// save bill
ipcMain.on("save-bill", async (event, orderData) => {
    const { cashier, date, orderItems, totalAmount, tableId, tableLabel } = orderData;

    try {
        let totalSGST = 0, totalCGST = 0, totalTax = 0, calculatedTotalAmount = 0;

        // Fetch tax details and calculate actual total
        for (const { foodId, quantity } of orderItems) {
            const row = await dbGetAsync(
                `SELECT cost, sgst, cgst, tax FROM FoodItem WHERE fid = ?`,
                [foodId]
            );

            if (!row) {
                throw new Error(`Food item with ID ${foodId} not found.`);
            }

            let itemTotal = row.cost * quantity;
            calculatedTotalAmount += itemTotal;

            totalSGST += (itemTotal * row.sgst) / 100;
            totalCGST += (itemTotal * row.cgst) / 100;
            totalTax += (itemTotal * row.tax) / 100;
        }

        const finalTotalAmount = totalAmount > 0 ? totalAmount : calculatedTotalAmount;
        const normalizedTableId = Number.isInteger(Number(tableId)) ? Number(tableId) : null;
        const normalizedTableLabel = String(tableLabel || '').trim() || null;

        // Begin transaction to make KOT + order insert atomic
        await dbRunAsync('BEGIN IMMEDIATE TRANSACTION');

        // Get the latest KOT number for the current date (serialized by transaction)
        const kotRow = await dbGetAsync(
            `SELECT kot FROM Orders WHERE date = ? ORDER BY kot DESC LIMIT 1`,
            [date]
        );

        let kot = kotRow ? kotRow.kot + 1 : 1;

        // Insert the new order
        const result = await dbRunAsync(
            `INSERT INTO Orders (kot, price, sgst, cgst, tax, cashier, date, table_id, table_label) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                kot,
                finalTotalAmount.toFixed(2),
                totalSGST.toFixed(2),
                totalCGST.toFixed(2),
                totalTax.toFixed(2),
                cashier,
                date,
                normalizedTableId,
                normalizedTableLabel,
            ]
        );
        const orderId = result.lastInsertRowid;

        // Insert items into OrderDetails
        const insertDetail = db.prepare(
            `INSERT INTO OrderDetails (orderid, foodid, quantity) VALUES (?, ?, ?)`
        );
        for (const { foodId, quantity } of orderItems) {
            insertDetail.run(orderId, foodId, quantity);
        }

        // Check if a discount was applied and insert into DiscountedOrders
        if (calculatedTotalAmount > finalTotalAmount) {
            const discountAmount = (calculatedTotalAmount - finalTotalAmount).toFixed(2);
            const discountPercentage = ((discountAmount / calculatedTotalAmount) * 100).toFixed(2);

            await dbRunAsync(
                `INSERT INTO DiscountedOrders (billno, Initial_price, discount_percentage, discount_amount) VALUES (?, ?, ?, ?)`,
                [orderId, calculatedTotalAmount.toFixed(2), discountPercentage, discountAmount]
            );
        }

        await dbRunAsync('COMMIT');

        console.log(`Order ${orderId} saved successfully with KOT ${kot}.`);
        event.sender.send("bill-saved", { kot, orderId });

    } catch (error) {
        try { await dbRunAsync('ROLLBACK'); } catch (_) {}
        console.error("Error processing order:", error.message);
        event.sender.send("bill-error", { error: error.message });
    }
});


ipcMain.on("hold-bill", async (event, orderData) => {
    const { cashier, date, orderItems, tableId, tableLabel } = orderData;

    try {
        let totalPrice = 0, totalSGST = 0, totalCGST = 0, totalTax = 0;
        const normalizedTableId = Number.isInteger(Number(tableId)) ? Number(tableId) : null;
        const normalizedTableLabel = String(tableLabel || '').trim() || null;

        for (const { foodId, quantity } of orderItems) {
            const row = await dbGetAsync(`SELECT cost, sgst, cgst, tax FROM FoodItem WHERE fid = ?`, [foodId]);
            if (!row) throw new Error(`Food item with ID ${foodId} not found.`);
            const itemTotal = row.cost * quantity;
            totalPrice += itemTotal;
            totalSGST += (itemTotal * row.sgst) / 100;
            totalCGST += (itemTotal * row.cgst) / 100;
            totalTax += (itemTotal * row.tax) / 100;
        }

        await dbRunAsync('BEGIN TRANSACTION');

        const result = await dbRunAsync(
            `INSERT INTO HeldOrders (price, sgst, cgst, tax, cashier, table_id, table_label, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                totalPrice.toFixed(2),
                totalSGST.toFixed(2),
                totalCGST.toFixed(2),
                totalTax.toFixed(2),
                cashier,
                normalizedTableId,
                normalizedTableLabel,
                date,
            ]
        );
        const orderId = result.lastInsertRowid;

        const insertDetail = db.prepare(`INSERT INTO HeldOrderDetails (heldid, foodid, quantity) VALUES (?, ?, ?)`);
        for (const { foodId, quantity } of orderItems) {
            insertDetail.run(orderId, foodId, quantity);
        }

        await dbRunAsync('COMMIT');

        console.log(`Order Held Successfully`);
        event.sender.send("bill-held");

    } catch (error) {
        try { await dbRunAsync('ROLLBACK'); } catch (_) {}
        console.error("Error processing order:", error.message);
        event.sender.send("bill-error", { error: error.message });
    }
});
// Fetch top selling items for a specific date range
ipcMain.on("get-top-selling-items", (event, { startDate, endDate }) => {
    try {
        const rows = dbAllAsync(`
            SELECT 
                Orders.date, 
                FoodItem.fname AS most_sold_item,
                SUM(OrderDetails.quantity) AS total_quantity
            FROM Orders
            JOIN OrderDetails ON Orders.billno = OrderDetails.orderid
            JOIN FoodItem ON OrderDetails.foodid = FoodItem.fid
            WHERE date(Orders.date) BETWEEN date(?) AND date(?)
            GROUP BY Orders.date, OrderDetails.foodid
            ORDER BY Orders.date, total_quantity DESC
        `, [startDate, endDate]);

        const topSellingItems = {};
        rows.forEach(row => {
            if (!topSellingItems[row.date]) {
                topSellingItems[row.date] = { most_sold_items: [row.most_sold_item], total_quantity: row.total_quantity };
            } else if (row.total_quantity === topSellingItems[row.date].total_quantity) {
                topSellingItems[row.date].most_sold_items.push(row.most_sold_item);
            } else if (row.total_quantity > topSellingItems[row.date].total_quantity) {
                topSellingItems[row.date] = { most_sold_items: [row.most_sold_item], total_quantity: row.total_quantity };
            }
        });

        const itemsArray = Object.keys(topSellingItems).map(date => ({
            date,
            most_sold_item: topSellingItems[date].most_sold_items.join(", ")
        }));

        event.reply("top-selling-items-response", { success: true, items: itemsArray });
    } catch (err) {
        console.error("Error fetching top selling items:", err);
        event.reply("top-selling-items-response", { success: false, items: [] });
    }
});

//------------------------------BILLING ENDS HERE--------------------------------
//---------------------------------HISTORY TAB-------------------------------------
// Fetch Today's Orders
ipcMain.on("get-todays-orders", (event) => {
    try {
        const rows = dbAllAsync(`
            SELECT 
                Orders.*, 
                COALESCE(Orders.table_label, DiningTable.table_number || ' - ' || DiningTable.table_name) AS table_label,
                User.uname AS cashier_name, 
                GROUP_CONCAT(FoodItem.fname || ' (x' || OrderDetails.quantity || ')', ', ') AS food_items
            FROM Orders
            LEFT JOIN User ON Orders.cashier = User.userid
            LEFT JOIN DiningTable ON Orders.table_id = DiningTable.table_id
            LEFT JOIN OrderDetails ON Orders.billno = OrderDetails.orderid
            LEFT JOIN FoodItem ON OrderDetails.foodid = FoodItem.fid
            WHERE date(Orders.date) = date('now', 'localtime')
            GROUP BY Orders.billno
            ORDER BY Orders.billno DESC
        `);
        event.reply("todays-orders-response", { success: true, orders: rows });
    } catch (err) {
        console.error("Error fetching today's orders:", err);
        event.reply("todays-orders-response", { success: false, orders: [] });
    }
});

ipcMain.on("get-order-history", (event, data) => {
    if (!data) {
        console.error("No data provided for get-order-history");
        event.reply("order-history-response", { success: false, orders: [], message: "No data provided" });
        return;
    }

    const { startDate, endDate, tableId } = data;

    if (!startDate || !endDate) {
        console.error("Missing startDate or endDate for get-order-history");
        event.reply("order-history-response", { success: false, orders: [], message: "Missing date parameters" });
        return;
    }

    try {
        let query = `
            SELECT 
                Orders.*, 
                COALESCE(Orders.table_label, DiningTable.table_number || ' - ' || DiningTable.table_name) AS table_label,
                User.uname AS cashier_name, 
                GROUP_CONCAT(FoodItem.fname || ' (x' || OrderDetails.quantity || ')', ', ') AS food_items
            FROM Orders
            LEFT JOIN User ON Orders.cashier = User.userid
            LEFT JOIN DiningTable ON Orders.table_id = DiningTable.table_id
            LEFT JOIN OrderDetails ON Orders.billno = OrderDetails.orderid
            LEFT JOIN FoodItem ON OrderDetails.foodid = FoodItem.fid
            WHERE date(Orders.date) BETWEEN date(?) AND date(?)
        `;

        const params = [startDate, endDate];
        const normalizedTableId = Number(tableId);
        if (Number.isInteger(normalizedTableId) && normalizedTableId > 0) {
            query += ' AND Orders.table_id = ?';
            params.push(normalizedTableId);
        }

        query += ` GROUP BY Orders.billno ORDER BY Orders.date DESC`;

        const rows = dbAllAsync(query, params);
        event.reply("order-history-response", { success: true, orders: rows });
    } catch (err) {
        console.error("Error fetching order history:", err);
        event.reply("order-history-response", { success: false, orders: [], message: err.message });
    }
});

ipcMain.on("update-order", async (event, { billno, orderItems }) => {
    try {
        if (!billno || !Array.isArray(orderItems) || orderItems.length === 0) {
            event.reply("update-order-response", { success: false, message: "Invalid order data." });
            return;
        }

        const existingOrder = await dbGetAsync("SELECT * FROM Orders WHERE billno = ?", [billno]);
        if (!existingOrder) {
            event.reply("update-order-response", { success: false, message: "Order not found." });
            return;
        }

        await dbRunAsync('BEGIN TRANSACTION');

        // Calculate new totals from FoodItem costs
        let totalPrice = 0, totalSGST = 0, totalCGST = 0, totalTax = 0;
        for (const { foodId, quantity } of orderItems) {
            const item = await dbGetAsync("SELECT cost, sgst, cgst, tax FROM FoodItem WHERE fid = ?", [foodId]);
            if (!item) {
                throw new Error(`Food item ${foodId} not found.`);
            }
            const itemTotal = item.cost * quantity;
            totalPrice += itemTotal;
            totalSGST += (itemTotal * item.sgst) / 100;
            totalCGST += (itemTotal * item.cgst) / 100;
            totalTax += (itemTotal * item.tax) / 100;
        }

        // Update OrderDetails: delete all then re-insert
        await dbRunAsync("DELETE FROM OrderDetails WHERE orderid = ?", [billno]);
        const insertDetail = db.prepare("INSERT INTO OrderDetails (orderid, foodid, quantity) VALUES (?, ?, ?)");
        for (const { foodId, quantity } of orderItems) {
            insertDetail.run(billno, foodId, quantity);
        }

        // Update order totals
        await dbRunAsync(
            "UPDATE Orders SET price = ?, sgst = ?, cgst = ?, tax = ? WHERE billno = ?",
            [totalPrice.toFixed(2), totalSGST.toFixed(2), totalCGST.toFixed(2), totalTax.toFixed(2), billno]
        );

        // Update or remove discount
        const discount = await dbGetAsync("SELECT * FROM DiscountedOrders WHERE billno = ?", [billno]);
        if (discount) {
            if (totalPrice >= existingOrder.price) {
                // No more discount needed
                await dbRunAsync("DELETE FROM DiscountedOrders WHERE billno = ?", [billno]);
            } else {
                const discountAmount = (existingOrder.price - totalPrice).toFixed(2);
                const discountPercentage = ((discountAmount / existingOrder.price) * 100).toFixed(2);
                await dbRunAsync(
                    "UPDATE DiscountedOrders SET Initial_price = ?, discount_percentage = ?, discount_amount = ? WHERE billno = ?",
                    [existingOrder.price, discountPercentage, discountAmount, billno]
                );
            }
        }

        await dbRunAsync('COMMIT');
        event.reply("update-order-response", { success: true, message: `Order #${billno} updated.` });

    } catch (error) {
        try { await dbRunAsync('ROLLBACK'); } catch (_) {}
        console.error("Error updating order:", error);
        event.reply("update-order-response", { success: false, message: "Failed to update order." });
    }
});

ipcMain.on("confirm-delete-order", async (event, { billNo, reason, source }) => {
    try {
        const order = await dbGetAsync("SELECT * FROM Orders WHERE billno = ?", [billNo]);
        const orderDetails = await dbAllAsync("SELECT * FROM OrderDetails WHERE orderid = ?", [billNo]);

        if (!order) {
            event.reply("delete-order-response", { success: false, message: "Order not found!" });
            return;
        }

        await dbRunAsync('BEGIN TRANSACTION');

        await dbRunAsync(
            "INSERT INTO DeletedOrders (billno, date, cashier, kot, price, sgst, cgst, tax, reason, table_id, table_label) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                order.billno,
                order.date,
                order.cashier,
                order.kot,
                order.price,
                order.sgst,
                order.cgst,
                order.tax,
                reason,
                order.table_id ?? null,
                order.table_label ?? null,
            ]
        );

        for (const detail of orderDetails) {
            await dbRunAsync(
                "INSERT INTO DeletedOrderDetails (orderid, foodid, quantity) VALUES (?, ?, ?)",
                [detail.orderid, detail.foodid, detail.quantity]
            );
        }

        await dbRunAsync("DELETE FROM Orders WHERE billno = ?", [billNo]);
        await dbRunAsync("DELETE FROM OrderDetails WHERE orderid = ?", [billNo]);

        await dbRunAsync('COMMIT');

        event.reply("delete-order-response", { success: true, message: "Order deleted successfully!" });

        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("order-deleted", { source });
            mainWindow.webContents.send("refresh-order-history");
        }

    } catch (error) {
        try { await dbRunAsync('ROLLBACK'); } catch (_) {}
        console.error("Error deleting order:", error);
        event.reply("delete-order-response", { success: false, message: "Failed to delete order." });
    }
});

ipcMain.on("get-categories-event", (event) => {
    try {
        const rows = dbAllAsync(`SELECT catid, catname FROM Category WHERE active = 1`);
        event.reply("categories-response", { success: true, categories: rows });
    } catch (err) {
        console.error("Error fetching categories:", err);
        event.reply("categories-response", { success: false, categories: [] });
    }
});

ipcMain.on("get-deleted-orders", (event, { startDate, endDate }) => {
    try {
        const rows = dbAllAsync(`
            SELECT 
                DeletedOrders.*, 
                COALESCE(DeletedOrders.table_label, DiningTable.table_number || ' - ' || DiningTable.table_name) AS table_label,
                User.uname AS cashier_name, 
                GROUP_CONCAT(FoodItem.fname || ' (x' || DeletedOrderDetails.quantity || ')', ', ') AS food_items
            FROM DeletedOrders
            JOIN User ON DeletedOrders.cashier = User.userid
            LEFT JOIN DiningTable ON DeletedOrders.table_id = DiningTable.table_id
            JOIN DeletedOrderDetails ON DeletedOrders.billno = DeletedOrderDetails.orderid
            JOIN FoodItem ON DeletedOrderDetails.foodid = FoodItem.fid
            WHERE date(DeletedOrders.date) BETWEEN date(?) AND date(?)
            GROUP BY DeletedOrders.billno
            ORDER BY DeletedOrders.date DESC
        `, [startDate, endDate]);
        event.reply("deleted-orders-response", { success: true, orders: rows });
    } catch (err) {
        console.error("Error fetching deleted orders:", err);
        event.reply("deleted-orders-response", { success: false, orders: [], message: err.message });
    }
});

ipcMain.on("clear-deleted-orders", (event) => {
    try {
        db.prepare(`DELETE FROM DeletedOrderDetails`).run();
        db.prepare(`DELETE FROM DeletedOrders`).run();
        event.reply("clear-deleted-orders-response", { success: true });
    } catch (err) {
        console.error("Error clearing DeletedOrders:", err);
        event.reply("clear-deleted-orders-response", { success: false });
    }
});

ipcMain.on("get-discounted-orders", (event, { startDate, endDate }) => {
    try {
        const rows = dbAllAsync(`
            SELECT 
                d.billno, 
                o.kot, 
                o.date,
                COALESCE(o.table_label, DiningTable.table_number || ' - ' || DiningTable.table_name) AS table_label,
                d.Initial_price, 
                d.discount_percentage, 
                d.discount_amount, 
                o.price AS Final_Price,
                GROUP_CONCAT(f.fname, ', ') AS food_items
            FROM DiscountedOrders d
            JOIN Orders o ON d.billno = o.billno
            LEFT JOIN DiningTable ON o.table_id = DiningTable.table_id
            LEFT JOIN OrderDetails od ON d.billno = od.orderid
            LEFT JOIN FoodItem f ON od.foodid = f.fid
            WHERE date(o.date) BETWEEN date(?) AND date(?)
            GROUP BY d.billno, o.kot, o.date, d.Initial_price, d.discount_percentage, d.discount_amount
        `, [startDate, endDate]);
        event.reply("discounted-orders-response", { success: true, orders: rows });
    } catch (err) {
        console.error("Error fetching discounted orders:", err);
        event.reply("discounted-orders-response", { success: false, orders: [] });
    }
});

ipcMain.on("clear-discounted-orders", (event) => {
    try {
        db.prepare(`DELETE FROM DiscountedOrders`).run();
        event.reply("clear-discounted-orders-response", { success: true });
    } catch (err) {
        console.error("Error clearing DiscountedOrders:", err);
        event.reply("clear-discounted-orders-response", { success: false });
    }
});

ipcMain.on("get-customers", (event) => {
    try {
        const rows = dbAllAsync(`SELECT * FROM Customer ORDER BY cid ASC`);
        event.reply("customers-response", { success: true, customers: rows });
    } catch (err) {
        console.error("Error fetching customers:", err);
        event.reply("customers-response", { success: false, customers: [] });
    }
});

ipcMain.on("add-customer", (event, customerData) => {
    try {
        const { cname, phone, address } = customerData;
        db.prepare(`INSERT INTO Customer (cname, phone, address) VALUES (?, ?, ?)`).run(cname, phone, address);
        event.reply("customer-added-response", { success: true });
    } catch (err) {
        console.error("Error adding customer:", err);
        event.reply("customer-added-response", { success: false });
    }
});

ipcMain.on("delete-customer", (event, { customerId }) => {
    try {
        db.prepare("DELETE FROM Customer WHERE cid = ?").run(customerId);
        event.reply("customer-delete-response", { success: true });
    } catch (err) {
        console.error("Error deleting customer:", err);
        event.reply("customer-delete-response", { success: false });
    }
});

ipcMain.on("update-customer", (event, updatedCustomer) => {
    try {
        const { cid, cname, phone, address } = updatedCustomer;
        db.prepare("UPDATE Customer SET cname = ?, phone = ?, address = ? WHERE cid = ?").run(cname, phone, address, cid);
        event.reply("update-customer-response", { success: true });
    } catch (err) {
        console.error("Error updating customer:", err);
        event.reply("update-customer-response", { success: false, error: err.message });
    }
});

ipcMain.on("get-order-details", (event, billno) => {
    try {
        const rows = dbAllAsync(`
            SELECT 
                OrderDetails.foodid AS foodId,
                FoodItem.fname AS foodName,
                FoodItem.cost AS price,
                OrderDetails.quantity AS quantity
            FROM OrderDetails
            JOIN FoodItem ON OrderDetails.foodid = FoodItem.fid
            WHERE OrderDetails.orderid = ?
        `, [billno]);
        event.reply("order-details-response", { food_items: rows });
    } catch (err) {
        console.error("Error fetching order details:", err);
        event.reply("order-details-response", { food_items: [] });
    }
});

//----------------------------------------------SETTINGS TAB ENDS HERE--------------------------------------------

// Store for category order
let categoryOrderStore = new Store({ name: 'category-order' });

// Modified get-categories handler to respect custom order
ipcMain.handle("get-categories", async () => {
    const rows = dbAllAsync("SELECT catid, catname FROM Category WHERE active = 1");
    const customOrder = categoryOrderStore.get('order', []);

    if (customOrder.length > 0) {
        const orderedCategories = [];
        const unorderedCategories = [];
        rows.forEach(category => {
            const index = customOrder.indexOf(category.catname);
            if (index !== -1) {
                orderedCategories[index] = category;
            } else {
                unorderedCategories.push(category);
            }
        });
        const filteredOrdered = orderedCategories.filter(cat => cat !== undefined);
        return [...filteredOrdered, ...unorderedCategories];
    }
    return rows;
});
//----------------------------------------------MENU TAB STARTS HERE ----------------------------------------------------------
// Update the IPC handler in main.js with better error handling
ipcMain.handle("get-menu-items", async () => {
    try {
        if (!db) {
            throw new Error("Database not connected");
        }

        const foodItems = dbAllAsync(`
            SELECT 
                f.fid, f.fname, f.category, f.cost, 
                f.sgst, f.cgst, f.veg, f.is_on, f.active,
                c.catname AS category_name
            FROM FoodItem f
            JOIN Category c ON f.category = c.catid
        `);

        console.log("✅ Successfully fetched food items:", foodItems.length);
        return foodItems;
    } catch (err) {
        console.error("❌ Error in get-menu-items handler:", err);
        throw new Error(`Failed to fetch menu items: ${err.message || err}`);
    }
});

ipcMain.handle("toggle-menu-item", async (event, fid) => {
    try {
        db.prepare(`
            UPDATE FoodItem 
            SET is_on = CASE WHEN is_on = 1 THEN 0 ELSE 1 END
            WHERE fid = ?
        `).run(fid);

        const updatedItem = db.prepare("SELECT is_on FROM FoodItem WHERE fid = ?").get(fid);
        return updatedItem ? updatedItem.is_on : null;
    } catch (err) {
        console.error("Error toggling menu item:", err);
        return null;
    }
});

ipcMain.handle("toggle-menu-item-active", async (event, fid) => {
    try {
        db.prepare(`
            UPDATE FoodItem 
            SET active = CASE WHEN active = 1 THEN 0 ELSE 1 END
            WHERE fid = ?
        `).run(fid);

        const updatedItem = db.prepare("SELECT active FROM FoodItem WHERE fid = ?").get(fid);
        return updatedItem ? updatedItem.active : null;
    } catch (err) {
        console.error("Error toggling active state:", err);
        return null;
    }
});

ipcMain.handle("delete-menu-item", async (event, fid) => {
    try {
        db.prepare("DELETE FROM FoodItem WHERE fid = ?").run(fid);
        return true;
    } catch (err) {
        console.error("Error deleting menu item:", err);
        return false;
    }
});
//Edit Menu ITems
ipcMain.handle("update-food-item", async (event, { fid, fname, category, cost, sgst, cgst, tax, veg, active }) => {
    try {
        const query = `
            UPDATE FoodItem 
            SET fname = ?, cost = ?, category = ?, sgst = ?, cgst = ?, tax = ?, veg = ?, active = ?
            WHERE fid = ?
        `;
        await dbRunAsync(query, [fname, cost, category, sgst, cgst, tax ?? 0, veg, active ?? 1, fid]);
        return { success: true };
    } catch (error) {
        console.error("Error updating food item:", error);
        return { success: false, error: error.message };
    }
});

// Handle fetching categories for dropdowns
ipcMain.handle("get-categories-for-additem", async () => {
    if (!db) throw new Error("Database not connected");
    return dbAllAsync("SELECT catid, catname, active FROM Category ORDER BY catname");
});

ipcMain.handle('create-category', async (event, payload = {}) => {
    try {
        const catname = String(payload?.catname || '').trim();
        if (!catname) {
            return { success: false, message: 'Category name is required.' };
        }

        const existing = await dbGetAsync(
            `SELECT catid FROM Category WHERE LOWER(catname) = LOWER(?) LIMIT 1`,
            [catname]
        );
        if (existing) {
            return { success: false, message: 'A category with that name already exists.' };
        }

        await dbRunAsync(
            `INSERT INTO Category (catname, active) VALUES (?, 1)`,
            [catname]
        );

        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('categories-updated');
        }

        return { success: true };
    } catch (error) {
        console.error('Failed to create category:', error);
        return { success: false, message: error.message || 'Failed to create category.' };
    }
});

ipcMain.handle('update-category', async (event, payload = {}) => {
    try {
        const catid = Number(payload?.catid);
        const catname = String(payload?.catname || '').trim();
        const active = payload?.active === false ? 0 : 1;

        if (!catid) {
            return { success: false, message: 'Valid category id is required.' };
        }

        if (!catname) {
            return { success: false, message: 'Category name is required.' };
        }

        const duplicate = await dbGetAsync(
            `SELECT catid FROM Category WHERE LOWER(catname) = LOWER(?) AND catid != ? LIMIT 1`,
            [catname, catid]
        );
        if (duplicate) {
            return { success: false, message: 'Another category already uses that name.' };
        }

        const result = await dbRunAsync(
            `UPDATE Category SET catname = ?, active = ? WHERE catid = ?`,
            [catname, active, catid]
        );

        if (!result.changes) {
            return { success: false, message: 'Category not found.' };
        }

        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('categories-updated');
        }

        return { success: true };
    } catch (error) {
        console.error('Failed to update category:', error);
        return { success: false, message: error.message || 'Failed to update category.' };
    }
});

ipcMain.handle('toggle-category-active', async (event, payload = {}) => {
    try {
        const catid = Number(payload?.catid);
        const active = payload?.active ? 1 : 0;

        if (!catid) {
            return { success: false, message: 'Valid category id is required.' };
        }

        const result = await dbRunAsync(
            `UPDATE Category SET active = ? WHERE catid = ?`,
            [active, catid]
        );

        if (!result.changes) {
            return { success: false, message: 'Category not found.' };
        }

        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('categories-updated');
        }

        return { success: true };
    } catch (error) {
        console.error('Failed to toggle category active state:', error);
        return { success: false, message: error.message || 'Failed to update category.' };
    }
});
// Add new food item
ipcMain.handle("add-food-item", async (event, item) => {
    const result = db.prepare(
        `INSERT INTO FoodItem (fname, category, cost, sgst, cgst, tax, active, is_on, veg)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
        item.fname,
        item.category,
        item.cost,
        item.sgst,
        item.cgst,
        item.tax,
        item.active,
        item.is_on,
        item.veg
    );
    return { success: true, fid: result.lastInsertRowid };
});

// Bulk update food items
ipcMain.handle('bulk-update-food-items', async (event, updates) => {
    try {
        const updateStmt = db.prepare(`
            UPDATE FoodItem 
            SET fname = ?, category = ?, cost = ?, sgst = ?, cgst = ?, tax = ?, veg = ?, active = ?
            WHERE fid = ?
        `);

        const runAll = db.transaction((items) => {
            for (const update of items) {
                updateStmt.run(
                    update.fname,
                    update.category,
                    update.cost,
                    update.sgst,
                    update.cgst,
                    update.tax ?? 0,
                    update.veg,
                    update.active,
                    update.fid
                );
            }
        });

        runAll(updates);
        return { success: true, updatedCount: updates.length };
    } catch (err) {
        console.error('Bulk update failed:', err);
        return { success: false, error: err.message };
    }
});

//----------------------------------------------MENU TAB ENDS HERE ------------------------------------------------------------

//----------------------------------------------HOME TAB STARTS HERE ----------------------------------------------------------
ipcMain.handle("get-all-food-items", async () => {
    return dbAllAsync(`
        SELECT f.fid, f.fname, f.cost, f.veg, f.category 
        FROM FoodItem f 
        JOIN Category c ON f.category = c.catid
        WHERE f.active = 1 AND f.is_on = 1 AND c.active = 1
    `);
});

//-0--------------------HOME TAB ENDS HERE--------------------------------------------------------------------------------

// Store for item order (you'll need to initialize this at the top)
const itemOrderStore = new Store({ name: 'item-order' });

// Get food items with custom order
ipcMain.handle("get-food-items-with-order", async (event, categoryName) => {
    const rows = dbAllAsync(`
        SELECT f.fid, f.fname, f.cost, f.veg, f.category 
        FROM FoodItem f 
        JOIN Category c ON f.category = c.catid 
        WHERE c.catname = ? AND f.active = 1 AND f.is_on = 1
    `, [categoryName]);

    const customOrder = itemOrderStore.get(categoryName, []);
    if (customOrder.length > 0) {
        const orderedItems = [];
        const unorderedItems = [];
        rows.forEach(item => {
            const index = customOrder.indexOf(item.fid);
            if (index !== -1) {
                orderedItems[index] = item;
            } else {
                unorderedItems.push(item);
            }
        });
        const filteredOrdered = orderedItems.filter(item => item !== undefined);
        return [...filteredOrdered, ...unorderedItems];
    }
    return rows;
});

ipcMain.handle("save-item-order", async (event, categoryName, itemOrder) => {
    itemOrderStore.set(categoryName, itemOrder);
    return { success: true };
});

ipcMain.handle("reset-item-order", async (event, categoryName) => {
    itemOrderStore.delete(categoryName);
    return { success: true };
});

ipcMain.handle("get-food-items", async (event, categoryName) => {
    const rows = dbAllAsync(`
        SELECT f.fid, f.fname, f.cost, f.veg, f.category 
        FROM FoodItem f 
        JOIN Category c ON f.category = c.catid 
        WHERE c.catname = ? AND f.active = 1 AND f.is_on = 1
    `, [categoryName]);

    const customOrder = itemOrderStore.get(categoryName, []);
    if (customOrder.length > 0) {
        const orderedItems = [];
        const unorderedItems = [];
        rows.forEach(item => {
            const index = customOrder.indexOf(item.fid);
            if (index !== -1) {
                orderedItems[index] = item;
            } else {
                unorderedItems.push(item);
            }
        });
        const filteredOrdered = orderedItems.filter(item => item !== undefined);
        return [...filteredOrdered, ...unorderedItems];
    }
    return rows;
});

// ADD FOOD ITEM IN MENU APP
// Fetch categories for dropdown
//refresh menu
// In main.js

// Add the listener for 'refresh-menu'
ipcMain.on('refresh-menu', (event) => {
    // You can trigger the 'displayMenu' function in the main window
    // Here you will call a function in your main window or refresh its content.
    mainWindow.webContents.send('refresh-menu'); // This sends a message to the renderer to trigger menu refresh
});
//EXIT THE APP
// Event listener to handle exit request
// Event listener to handle exit request
ipcMain.on("exit-app", (event) => {
      closeDatabase();
      store.delete("sessionUser");
       app.quit();
  });

// --------------------------------- BUSINESS INFO SECTION -----------------------------

ipcMain.on('save-business-info', (event, businessData) => {
    const savePath = getFilePath('businessInfo.json');
    fs.writeFile(savePath, JSON.stringify(businessData, null, 4), 'utf-8', (err) => {
        if (err) {
            console.error('Error saving business info:', err);
            event.reply('save-business-info-response', { success: false, message: err.message });
        } else {
            console.log('Business info saved to:', savePath);
            event.reply('save-business-info-response', { success: true });
        }
    });
});

ipcMain.handle('load-business-info', async () => {
    try {
        const dataPath = getFilePath('businessInfo.json');
        const fileData = await fs.promises.readFile(dataPath, 'utf-8');
        return JSON.parse(fileData);
    } catch (err) {
        console.error('Failed to load business info:', err);
        return null; // or return default data if file is missing
    }
});

// ------------------------------- UI SETTINGS SECTION STARTS HERE ------------------------
ipcMain.handle('load-ui-settings', async () => {
    try {
        const dataPath = getFilePath('uiSettings.json');
        const fileData = await fs.promises.readFile(dataPath, 'utf-8');
        const parsed = JSON.parse(fileData);
        const resolvedTheme = normalizeThemePreset(parsed?.themePreset, 'creamCharcoal');
        return {
            showHoldBill: parsed?.showHoldBill !== false,
            themePreset: resolvedTheme,
            usePrinter: parsed?.usePrinter !== false,
            autoPrintBillOnSave: parsed?.autoPrintBillOnSave === true,
            autoPrintKotOnSave: parsed?.autoPrintKotOnSave === true,
            enableTableSelection: parsed?.enableTableSelection === true,
        };
    } catch (err) {
        return {
            showHoldBill: true,
            themePreset: 'creamCharcoal',
            usePrinter: true,
            autoPrintBillOnSave: false,
            autoPrintKotOnSave: false,
            enableTableSelection: false,
        };
    }
});

ipcMain.handle('save-ui-settings', async (event, settings) => {
    try {
        const dataPath = getFilePath('uiSettings.json');
        let existingSettings = {};

        try {
            const current = await fs.promises.readFile(dataPath, 'utf-8');
            existingSettings = JSON.parse(current);
        } catch (_) {
            existingSettings = {};
        }

        const nextSettings = {
            showHoldBill: settings?.showHoldBill !== undefined
                ? settings.showHoldBill !== false
                : existingSettings?.showHoldBill !== false,
            themePreset: normalizeThemePreset(
                settings?.themePreset,
                normalizeThemePreset(existingSettings?.themePreset, 'creamCharcoal')
            ),
            usePrinter: settings?.usePrinter !== undefined
                ? settings.usePrinter !== false
                : existingSettings?.usePrinter !== false,
            autoPrintBillOnSave: settings?.autoPrintBillOnSave !== undefined
                ? settings.autoPrintBillOnSave === true
                : existingSettings?.autoPrintBillOnSave === true,
            autoPrintKotOnSave: settings?.autoPrintKotOnSave !== undefined
                ? settings.autoPrintKotOnSave === true
                : existingSettings?.autoPrintKotOnSave === true,
            enableTableSelection: settings?.enableTableSelection !== undefined
                ? settings.enableTableSelection === true
                : existingSettings?.enableTableSelection === true,
        };
        await fs.promises.writeFile(dataPath, JSON.stringify(nextSettings, null, 2), 'utf-8');
        return { success: true };
    } catch (err) {
        console.error('Failed to save UI settings:', err);
        return { success: false, message: err.message };
    }
});

ipcMain.handle('get-billing-tables', async () => {
    try {
        const rows = await dbAllAsync(
            `SELECT table_id AS tableId, table_name AS tableName, table_number AS tableNumber
             FROM DiningTable
             ORDER BY CAST(table_number AS INTEGER), table_number, table_name`
        );
        return { success: true, tables: rows };
    } catch (error) {
        console.error('Failed to fetch billing tables:', error);
        return { success: false, message: error.message || 'Failed to fetch tables.', tables: [] };
    }
});

ipcMain.handle('create-billing-table', async (event, payload) => {
    try {
        const tableName = String(payload?.tableName || '').trim();
        const tableNumber = String(payload?.tableNumber || '').trim();

        if (!tableName || !tableNumber) {
            return { success: false, message: 'Table name and number are required.' };
        }

        const duplicate = await dbGetAsync(
            `SELECT table_id FROM DiningTable WHERE LOWER(table_number) = LOWER(?) LIMIT 1`,
            [tableNumber]
        );
        if (duplicate) {
            return { success: false, message: 'Table number already exists.' };
        }

        await dbRunAsync(
            `INSERT INTO DiningTable (table_name, table_number, updated_at)
             VALUES (?, ?, datetime('now'))`,
            [tableName, tableNumber]
        );

        return { success: true };
    } catch (error) {
        console.error('Failed to create billing table:', error);
        return { success: false, message: error.message || 'Failed to create table.' };
    }
});

ipcMain.handle('update-billing-table', async (event, payload) => {
    try {
        const tableId = Number(payload?.tableId);
        const tableName = String(payload?.tableName || '').trim();
        const tableNumber = String(payload?.tableNumber || '').trim();

        if (!tableId || !tableName || !tableNumber) {
            return { success: false, message: 'Valid table id, name, and number are required.' };
        }

        const duplicate = await dbGetAsync(
            `SELECT table_id FROM DiningTable
             WHERE LOWER(table_number) = LOWER(?) AND table_id != ?
             LIMIT 1`,
            [tableNumber, tableId]
        );
        if (duplicate) {
            return { success: false, message: 'Table number already exists.' };
        }

        await dbRunAsync(
            `UPDATE DiningTable
             SET table_name = ?, table_number = ?, updated_at = datetime('now')
             WHERE table_id = ?`,
            [tableName, tableNumber, tableId]
        );

        return { success: true };
    } catch (error) {
        console.error('Failed to update billing table:', error);
        return { success: false, message: error.message || 'Failed to update table.' };
    }
});

ipcMain.handle('delete-billing-table', async (event, payload) => {
    try {
        const tableId = Number(payload?.tableId);
        if (!tableId) {
            return { success: false, message: 'Valid table id is required.' };
        }

        const inOrders = await dbGetAsync(
            `SELECT billno FROM Orders WHERE table_id = ? LIMIT 1`,
            [tableId]
        );
        const inHeldOrders = await dbGetAsync(
            `SELECT heldid FROM HeldOrders WHERE table_id = ? LIMIT 1`,
            [tableId]
        );

        if (inOrders || inHeldOrders) {
            return { success: false, message: 'Table is already used in orders and cannot be deleted.' };
        }

        await dbRunAsync('DELETE FROM DiningTable WHERE table_id = ?', [tableId]);
        return { success: true };
    } catch (error) {
        console.error('Failed to delete billing table:', error);
        return { success: false, message: error.message || 'Failed to delete table.' };
    }
});
// ------------------------------- UI SETTINGS SECTION ENDS HERE ------------------------

// ------------------------------- BUSINESS INFO SECTION ENDS HERE ------------------------
//----------------------------------- BACKUP AND RESTORE SECTION STARTS HERE -------------------
// Local database backup handler
ipcMain.on('backup-database-local', async (event) => {
    const { backupLCdbLocal } = require('./backup');
    
    try {
        // Show save dialog to let user choose backup location
        const { dialog } = require('electron');
        const result = await dialog.showSaveDialog(mainWindow, {
            title: 'Save Database Backup',
            defaultPath: `LC_backup_${getLocalDateString()}.db`,
            filters: [
                { name: 'Database Files', extensions: ['db'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        });

        if (result.canceled) {
            event.reply('backup-local-completed', false, null);
            return;
        }

        const success = await backupLCdbLocal(result.filePath);
        event.reply('backup-local-completed', success, success ? result.filePath : null);
    } catch (error) {
        console.error('Local backup failed:', error);
        event.reply('backup-local-completed', false, null);
    }
});

// Local database restore handler
ipcMain.on('restore-database-local', async (event) => {
    const { restoreLCdbLocal } = require('./restore');
    
    try {
        // Show open dialog to let user select backup file
        const { dialog } = require('electron');
        const result = await dialog.showOpenDialog(mainWindow, {
            title: 'Select Database Backup to Restore',
            filters: [
                { name: 'Database Files', extensions: ['db'] },
                { name: 'All Files', extensions: ['*'] }
            ],
            properties: ['openFile']
        });

        if (result.canceled || result.filePaths.length === 0) {
            event.reply('restore-local-completed', false, null);
            return;
        }

        const success = await restoreLCdbLocal(result.filePaths[0]);
        event.reply('restore-local-completed', success, success ? result.filePaths[0] : null);
    } catch (error) {
        console.error('Local restore failed:', error);
        event.reply('restore-local-completed', false, null);
    }
});


// ---------------------------------- BACKUP AND RESTORE SECTION ENDS HERE -------------------
//----------------------------------- Packaging Code --------------------------------------
function initializeSchema() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS Category (
            catid INTEGER PRIMARY KEY AUTOINCREMENT,
            catname TEXT NOT NULL,
            active INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS Customer (
            cid INTEGER PRIMARY KEY AUTOINCREMENT,
            cname TEXT NOT NULL,
            phone TEXT NOT NULL,
            address TEXT
        );

        CREATE TABLE IF NOT EXISTS User (
            userid INTEGER PRIMARY KEY AUTOINCREMENT,
            uname TEXT NOT NULL,
            username TEXT NOT NULL,
            email TEXT NOT NULL,
            password_hash TEXT,
            pin_hash TEXT,
            is_admin INTEGER NOT NULL DEFAULT 0,
            active INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS AppSetup (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            is_initialized INTEGER NOT NULL DEFAULT 0,
            activation_key TEXT,
            tenant_id TEXT,
            tenant_name TEXT,
            tenant_location TEXT,
            contact_name TEXT,
            contact_phone TEXT,
            contact_email TEXT,
            contact_address TEXT,
            master_pin_hash TEXT,
            app_instance_id TEXT,
            app_version TEXT,
            platform TEXT,
            arch TEXT,
            remote_project_url TEXT,
            remote_anon_key TEXT,
            activated_at TEXT,
            updated_at TEXT
        );

        CREATE TABLE IF NOT EXISTS ActivationKey (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key_code TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL DEFAULT 'available',
            used_by_tenant_id TEXT,
            used_at TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            CHECK (status IN ('available', 'reserved', 'used', 'revoked'))
        );

        INSERT OR IGNORE INTO ActivationKey (key_code, status) VALUES
            ('LCP7F-3K9QW-2M8DX-5R4TN-00001', 'available'),
            ('LCP4J-8V2NP-6Q5XT-9H3RA-00002', 'available'),
            ('LCP9M-1C7LK-4Z8YD-2F6WS-00003', 'available'),
            ('LCP5X-6R3HJ-9B1QT-7N4PD-00004', 'available'),
            ('LCP8A-2W5VF-3N9CM-6K7ZX-00005', 'available');

        CREATE TABLE IF NOT EXISTS FoodItem (
            fid INTEGER PRIMARY KEY AUTOINCREMENT,
            fname TEXT NOT NULL,
            category INTEGER NOT NULL,
            cost NUMERIC NOT NULL,
            sgst NUMERIC NOT NULL DEFAULT 0,
            cgst NUMERIC NOT NULL DEFAULT 0,
            tax NUMERIC NOT NULL DEFAULT 0,
            active INTEGER NOT NULL DEFAULT 1,
            is_on INTEGER NOT NULL DEFAULT 1,
            veg INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (category) REFERENCES Category(catid)
        );

        CREATE TABLE IF NOT EXISTS Orders (
            billno INTEGER PRIMARY KEY AUTOINCREMENT,
            kot INTEGER NOT NULL,
            price NUMERIC NOT NULL,
            sgst NUMERIC NOT NULL,
            cgst NUMERIC NOT NULL,
            tax NUMERIC NOT NULL,
            cashier INTEGER NOT NULL,
            date TEXT NOT NULL,
            is_offline INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (cashier) REFERENCES User(userid)
        );

        CREATE TABLE IF NOT EXISTS OrderDetails (
            orderid INTEGER NOT NULL,
            foodid INTEGER NOT NULL,
            quantity INTEGER NOT NULL,
            PRIMARY KEY(orderid, foodid),
            FOREIGN KEY (orderid) REFERENCES Orders(billno),
            FOREIGN KEY (foodid) REFERENCES FoodItem(fid)
        );

        CREATE TABLE IF NOT EXISTS DiscountedOrders (
            billno INTEGER PRIMARY KEY,
            Initial_price NUMERIC NOT NULL,
            discount_percentage NUMERIC NOT NULL,
            discount_amount NUMERIC NOT NULL,
            FOREIGN KEY (billno) REFERENCES Orders(billno) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS HeldOrders (
            heldid INTEGER PRIMARY KEY AUTOINCREMENT,
            price NUMERIC NOT NULL,
            sgst NUMERIC NOT NULL,
            cgst NUMERIC NOT NULL,
            tax NUMERIC NOT NULL,
            cashier INTEGER NOT NULL,
            date TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (cashier) REFERENCES User(userid)
        );

        CREATE TABLE IF NOT EXISTS HeldOrderDetails (
            heldid INTEGER NOT NULL,
            foodid INTEGER NOT NULL,
            quantity INTEGER NOT NULL,
            PRIMARY KEY(heldid, foodid),
            FOREIGN KEY (heldid) REFERENCES HeldOrders(heldid),
            FOREIGN KEY (foodid) REFERENCES FoodItem(fid)
        );

        CREATE TABLE IF NOT EXISTS DeletedOrders (
            billno INTEGER PRIMARY KEY,
            kot INTEGER NOT NULL,
            price NUMERIC NOT NULL,
            sgst NUMERIC NOT NULL,
            cgst NUMERIC NOT NULL,
            tax NUMERIC NOT NULL,
            cashier INTEGER NOT NULL,
            date TEXT NOT NULL,
            reason TEXT NOT NULL,
            table_id INTEGER,
            table_label TEXT,
            is_offline INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (cashier) REFERENCES User(userid)
        );

        CREATE TABLE IF NOT EXISTS DeletedOrderDetails (
            orderid INTEGER NOT NULL,
            foodid INTEGER NOT NULL,
            quantity INTEGER NOT NULL,
            PRIMARY KEY(orderid, foodid),
            FOREIGN KEY (orderid) REFERENCES DeletedOrders(billno),
            FOREIGN KEY (foodid) REFERENCES FoodItem(fid)
        );

        DROP TABLE IF EXISTS OnlineOrderItems;
        DROP TABLE IF EXISTS OnlineOrders;
        DROP TABLE IF EXISTS Inventory;
        DROP TABLE IF EXISTS Miscellaneous;

        CREATE INDEX IF NOT EXISTS idx_orders_date ON Orders(date);
        CREATE INDEX IF NOT EXISTS idx_orders_cashier ON Orders(cashier);
        CREATE INDEX IF NOT EXISTS idx_orders_table_id ON Orders(table_id);
        CREATE INDEX IF NOT EXISTS idx_orderdetails_orderid ON OrderDetails(orderid);
        CREATE INDEX IF NOT EXISTS idx_orderdetails_foodid ON OrderDetails(foodid);
        CREATE INDEX IF NOT EXISTS idx_fooditem_category ON FoodItem(category);
        CREATE INDEX IF NOT EXISTS idx_fooditem_active_is_on ON FoodItem(active, is_on);
        CREATE INDEX IF NOT EXISTS idx_deletedorders_date ON DeletedOrders(date);
    `);

    // Run async schema migrations
    return (async () => {
        await ensureUserTableSchema();
        await ensureAppSetupSchema();
        await ensureCategorySchema();
        await ensureBillingTableSchema();
        await assertTableHasColumns('Category', ['catid', 'catname', 'active']);
        await assertTableHasColumns('Orders', ['table_id', 'table_label']);
        await assertTableHasColumns('HeldOrders', ['table_id', 'table_label']);
        await assertTableHasColumns('DeletedOrders', ['table_id', 'table_label']);
        await runDatabaseSanityChecks();

        // FoodItem legacy column migration
        const columns = db.prepare(`PRAGMA table_info(FoodItem)`).all();
        const hasLegacyDependInv = Array.isArray(columns) && columns.some((column) => column.name === 'depend_inv');
        if (hasLegacyDependInv) {
            db.exec(`
                PRAGMA foreign_keys = OFF;

                CREATE TABLE IF NOT EXISTS FoodItem_new (
                    fid INTEGER PRIMARY KEY AUTOINCREMENT,
                    fname TEXT NOT NULL,
                    category INTEGER NOT NULL,
                    cost NUMERIC NOT NULL,
                    sgst NUMERIC NOT NULL DEFAULT 0,
                    cgst NUMERIC NOT NULL DEFAULT 0,
                    tax NUMERIC NOT NULL DEFAULT 0,
                    active INTEGER NOT NULL DEFAULT 1,
                    is_on INTEGER NOT NULL DEFAULT 1,
                    veg INTEGER NOT NULL DEFAULT 0,
                    FOREIGN KEY (category) REFERENCES Category(catid)
                );

                INSERT INTO FoodItem_new (fid, fname, category, cost, sgst, cgst, tax, active, is_on, veg)
                SELECT fid, fname, category, cost, sgst, cgst, tax, active, is_on, veg
                FROM FoodItem;

                DROP TABLE FoodItem;
                ALTER TABLE FoodItem_new RENAME TO FoodItem;

                PRAGMA foreign_keys = ON;
            `);
        }

        console.log('✅ Database sanity check passed.');
        console.log("📦 Database schema ensured (tables created if missing).");
    })();
}



//-------------------------------- Search Order (in History Section) Starts Here-------------------------------------
ipcMain.on("search-orders", (event, filters) => {
    let query = `
        SELECT 
            o.billno,
            o.kot,
            o.price,
            o.sgst,
            o.cgst,
            o.tax,
            o.date,
            COALESCE(o.table_label, DiningTable.table_number || ' - ' || DiningTable.table_name) AS table_label,
            u.uname AS cashier_name,
            GROUP_CONCAT(fi.fname || ' (x' || od.quantity || ')', ', ') AS food_items
        FROM Orders o
        JOIN User u ON o.cashier = u.userid
        LEFT JOIN DiningTable ON o.table_id = DiningTable.table_id
        JOIN OrderDetails od ON o.billno = od.orderid
        JOIN FoodItem fi ON od.foodid = fi.fid
    `;

    const conditions = [];
    const params = [];

    if (filters.billNoFrom) {
        conditions.push("o.billno >= ?");
        params.push(parseInt(filters.billNoFrom));
    }
    if (filters.billNoTo) {
        conditions.push("o.billno <= ?");
        params.push(parseInt(filters.billNoTo));
    }
    if (filters.kotFrom) {
        conditions.push("o.kot >= ?");
        params.push(parseInt(filters.kotFrom));
    }
    if (filters.kotTo) {
        conditions.push("o.kot <= ?");
        params.push(parseInt(filters.kotTo));
    }
    if (filters.startDate && filters.endDate) {
        conditions.push("o.date BETWEEN ? AND ?");
        params.push(filters.startDate, filters.endDate);
    }
    if (filters.cashier) {
        conditions.push("o.cashier = ?");
        params.push(parseInt(filters.cashier));
    }
    if (filters.tableId) {
        conditions.push("o.table_id = ?");
        params.push(parseInt(filters.tableId));
    }
    if (filters.minPrice) {
        conditions.push("o.price >= ?");
        params.push(parseFloat(filters.minPrice));
    }
    if (filters.maxPrice) {
        conditions.push("o.price <= ?");
        params.push(parseFloat(filters.maxPrice));
    }

    if (conditions.length > 0) {
        query += " WHERE " + conditions.join(" AND ");
    }

    query += " GROUP BY o.billno ORDER BY o.billno DESC";

    try {
        const rows = dbAllAsync(query, params);
        event.sender.send("search-orders-response", { orders: rows });
    } catch (err) {
        console.error(err);
        event.sender.send("search-orders-response", { orders: [] });
    }
});

ipcMain.on("get-all-cashiers", (event) => {
    try {
        const rows = dbAllAsync("SELECT userid, uname FROM User");
        event.sender.send("all-cashiers-response", rows);
    } catch (err) {
        console.error(err);
        event.sender.send("all-cashiers-response", []);
    }
});

//-------------------------------- Search Order (in History Section) Ends Here-------------------------------------

