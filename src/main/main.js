const { app, BrowserWindow, Menu, ipcMain, dialog } = require("electron");
const path = require("path");
const sqlite3 = require('sqlite3').verbose();
const escpos = require("escpos");
const fs = require('fs');
escpos.USB = require("escpos-usb");
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
        return `file://${distIndexPath}`;
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
    } else {
        console.warn(`⚠️ Seed database not found at ${bundledSeedDbPath}. A new database will be created at ${userDataDbPath}.`);
    }

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
            await new Promise((resolve, reject) => {
                const handle = new sqlite3.Database(
                    dbPath,
                    sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
                    (err) => {
                        if (err) {
                            try {
                                handle.close(() => {});
                            } catch (_) {
                                // Ignore close errors on failed open.
                            }
                            reject(err);
                            return;
                        }

                        db = handle;
                        db.configure('busyTimeout', 5000);
                        db.serialize(() => {
                            db.run('PRAGMA busy_timeout = 5000');
                            db.run('PRAGMA foreign_keys = ON');
                        });

                        resolve();
                    }
                );
            });

            console.log("✅ Connected to the SQLite database.");
            initializeSchema();
            return;
        } catch (err) {
            const isLastAttempt = attempt === maxAttempts;
            console.error(
                `❌ Database open attempt ${attempt}/${maxAttempts} failed:`,
                err.message
            );

            if (isLastAttempt) {
                throw err;
            }

            await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        }
    }
}


async function initStore() {
    let Store;
    try {
    Store = require('electron-store'); // CommonJS
    } catch (err) {
    console.error("Failed to require electron-store:", err);
    }
    store = new Store({
        defaults: {
            printerConfig: {
                vendorId: '0x0525',
                productId: '0xA700'
            },
            lastOpenedDate: null
        }
    });
    return store;
}

async function checkAndResetFoodItems() {
    await initStore(); // Ensure store is initialized
    const lastOpenedDate = store.get("lastOpenedDate");
    const currentDate = getLocalDateString();

    if (lastOpenedDate !== currentDate) {
        console.log("New day detected, resetting is_on column...");
        db.run("UPDATE FoodItem SET is_on = 1", (err) => {
            if (err) {
                console.error("Failed to reset is_on:", err.message);
            } else {
                console.log("Successfully reset is_on for new day.");
                store.set("lastOpenedDate", currentDate);
            }
        });
    }
}

function dbGetAsync(query, params = []) {
    return new Promise((resolve, reject) => {
        db.get(query, params, (err, row) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(row);
        });
    });
}

function dbRunAsync(query, params = []) {
    return new Promise((resolve, reject) => {
        db.run(query, params, function runCallback(err) {
            if (err) {
                reject(err);
                return;
            }
            resolve(this);
        });
    });
}

function dbAllAsync(query, params = []) {
    return new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(rows || []);
        });
    });
}

async function ensureUserTableSchema() {
    const cols = await dbAllAsync("PRAGMA table_info(User)");

    const hasIsAdmin = cols.some((col) => col.name === 'isadmin');
    const hasUsername = cols.some((col) => col.name === 'username');
    const hasEmail = cols.some((col) => col.name === 'email');

    // Avoid DROP/RENAME migrations because Orders and other tables reference User(userid).
    if (!hasUsername) {
        await dbRunAsync('ALTER TABLE User ADD COLUMN username TEXT');
    }

    if (!hasEmail) {
        await dbRunAsync('ALTER TABLE User ADD COLUMN email TEXT');
    }

    if (hasIsAdmin || !hasUsername || !hasEmail) {
        await dbRunAsync(`UPDATE User
            SET username = COALESCE(
                NULLIF(TRIM(username), ''),
                COALESCE(NULLIF(TRIM(uname), ''), 'cashier')
            )`);

        await dbRunAsync(`UPDATE User
            SET email = COALESCE(
                NULLIF(TRIM(email), ''),
                LOWER(REPLACE(
                    COALESCE(NULLIF(TRIM(username), ''), COALESCE(NULLIF(TRIM(uname), ''), 'cashier')),
                    ' ',
                    ''
                )) || '@local.user'
            )`);
    }
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
        await dbRunAsync(
            "INSERT INTO User (uname, username, email) VALUES (?, ?, ?)",
            [safeName, normalizedUsername, safeEmail]
        );
        user = await dbGetAsync("SELECT userid, uname, username, email FROM User ORDER BY userid DESC LIMIT 1");
    }

    return {
        name: user.uname,
        username: user.username,
        userid: user.userid,
        email: user.email
    };
}

// === Create main window ===
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
        icon: path.join(projectRoot, "assets/images", "lassicorner.ico"),
    show: false,
    fullscreen: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '..', 'preload.js'),
      devTools: true,
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

  // Enable developer tools with F12 key
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') {
      mainWindow.webContents.toggleDevTools();
    }
  });

  // Add machine-specific debugging for blank screen issues
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('✅ Page loaded:', mainWindow.webContents.getURL());
    
    // Force a repaint to fix potential rendering issues
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.invalidate();
      }
    }, 100);
  });

  // Handle renderer crashes (machine-specific issue)
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('❌ Renderer process crashed:', details);
    // Restart the window
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
  ipcMain.handle("login", async (event, { username, password }) => {
    try {
                        if (!username || !password) {
        return null;
      }

                        const user = await getOrCreateCashierUser(username);
            if (!user) {
                return null;
            }

            console.log("Login successful:", user.username);
            await checkAndResetFoodItems();
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
  ipcMain.handle("edit-user-profile", async () => {
    return { success: false, message: "User profile management is disabled for now." };
  });

  // IPC handler for changing password
  ipcMain.handle("change-user-password", async () => {
    return { success: false, message: "Password management is disabled for now." };
  });

  // IPC handler for adding new user
  ipcMain.handle("add-new-user", async () => {
    return { success: false, message: "Adding users is disabled for now." };
  });

  ipcMain.handle("get-printer-config", () => {
    const config = store.get("printerConfig", {
      vendorId: "0x0525",
      productId: "0xA700",
    });

    return {
      vendorId: config.vendorId,
      productId: config.productId,
      vendorIdDec: parseInt(config.vendorId, 16),
      productIdDec: parseInt(config.productId, 16),
    };
  });

  ipcMain.handle("save-printer-config", (event, config) => {
    try {
      if (!config || !config.vendorId || !config.productId) {
        throw new Error("Both Vendor ID and Product ID are required");
      }

      const hexRegex = /^0x[0-9a-fA-F]{4}$/;
      if (!hexRegex.test(config.vendorId) || !hexRegex.test(config.productId)) {
        throw new Error("Invalid hexadecimal format");
      }

      const vendorId = parseInt(config.vendorId, 16);
      const productId = parseInt(config.productId, 16);
      if (isNaN(vendorId) || isNaN(productId)) {
        throw new Error("Invalid hexadecimal values");
      }

      store.set("printerConfig", config);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
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
        createWindow();
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
        db.close((err) => {
            if (err) console.error("Error closing database", err);
            else console.log("Database connection closed");
        });
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

    db.all(query, [startDate, endDate], (err, rows) => {
        if (err) {
            console.error("Error fetching item summary:", err);
            event.reply("item-summary-response", { success: false, items: [] });
            return;
        }
        event.reply("item-summary-response", { success: true, items: rows });
    });
});
// IPC handler to get today's revenue
ipcMain.handle('get-todays-revenue', (event) => {
    return new Promise((resolve, reject) => {
        const today = getLocalDateString();
        const query = `SELECT SUM(price) AS totalRevenue FROM Orders WHERE date LIKE ?`;
        
        db.get(query, [`${today}%`], (err, row) => {
            if (err) {
                console.error("Error fetching today's revenue:", err);
                reject(err);
            } else {
                resolve(row.totalRevenue || 0); // Return total revenue or 0 if null
            }
        });
    });
});

// IPC handler to get today's sales count
ipcMain.handle('get-todays-sales', (event) => {
    return new Promise((resolve, reject) => {
        const today = getLocalDateString();
        const query = `SELECT COUNT(*) AS totalSales FROM Orders WHERE date LIKE ?`;
        
        db.get(query, [`${today}%`], (err, row) => {
            if (err) {
                console.error("Error fetching today's sales count:", err);
                reject(err);
            } else {
                resolve(row.totalSales || 0); // Return total sales count or 0 if null
            }
        });
    });
});

// IPC handler to get today's tax amount
ipcMain.handle('get-todays-tax', (event) => {
    return new Promise((resolve, reject) => {
        const today = getLocalDateString();
        const query = `SELECT SUM(tax) AS totalTax FROM Orders WHERE date LIKE ?`;
        
        db.get(query, [`${today}%`], (err, row) => {
            if (err) {
                console.error("Error fetching today's tax amount:", err);
                reject(err);
            } else {
                resolve(row.totalTax || 0); // Return total tax amount or 0 if null
            }
        });
    });
});

// IPC handler to get today's discounted orders count
ipcMain.handle('get-todays-discounted-orders', (event) => {
    return new Promise((resolve, reject) => {
        const today = getLocalDateString();
        const query = `SELECT COUNT(*) AS discountedCount FROM DiscountedOrders WHERE billno IN (SELECT billno FROM Orders WHERE date LIKE ?)`;
        
        db.get(query, [`${today}%`], (err, row) => {
            if (err) {
                console.error("Error fetching today's discounted orders count:", err);
                reject(err);
            } else {
                resolve(row.discountedCount || 0); // Return discounted orders count or 0 if null
            }
        });
    });
});

// IPC handler to get today's deleted orders count
ipcMain.handle('get-todays-deleted-orders', (event) => {
    return new Promise((resolve, reject) => {
        const today = getLocalDateString();
        const query = `SELECT COUNT(*) AS deletedCount FROM DeletedOrders WHERE date LIKE ?`;
        
        db.get(query, [`${today}%`], (err, row) => {
            if (err) {
                console.error("Error fetching today's deleted orders count:", err);
                reject(err);
            } else {
                resolve(row.deletedCount || 0); // Return deleted orders count or 0 if null
            }
        });
    });
});

// IPC handler to get yesterday's revenue
ipcMain.handle('get-yesterdays-revenue', (event) => {
    return new Promise((resolve, reject) => {
        const today = getLocalDateString();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayDate = getLocalDateString(yesterday);
        const query = `SELECT SUM(price) AS totalRevenue FROM Orders WHERE date LIKE ?`;
        
        db.get(query, [`${yesterdayDate}%`], (err, row) => {
            if (err) {
                console.error("Error fetching yesterday's revenue:", err);
                reject(err);
            } else {
                resolve(row.totalRevenue || 0); // Return total revenue or 0 if null
            }
        });
    });
});

// IPC handler to get today's most sold items
ipcMain.handle('get-most-sold-items', (event) => {
    return new Promise((resolve, reject) => {
        const today = getLocalDateString();
        const query = `
            SELECT f.fname, SUM(od.quantity) AS totalQuantity
            FROM OrderDetails od
            JOIN Orders o ON od.orderid = o.billno
            JOIN FoodItem f ON od.foodid = f.fid
            WHERE o.date LIKE ?
            GROUP BY f.fid
            ORDER BY totalQuantity DESC
            LIMIT 2
        `;
        
        db.all(query, [`${today}%`], (err, rows) => {
            if (err) {
                console.error("Error fetching today's most sold items:", err);
                reject(err);
            } else {
                const items = rows.map(row => row.fname); // Extract food names
                resolve(items); // Return the list of most sold items
            }
        });
    });
});

// IPC handler to get today's most sold categories
ipcMain.handle('get-most-sold-categories', (event) => {
    return new Promise((resolve, reject) => {
        const today = getLocalDateString();
        const query = `
            SELECT c.catname, SUM(od.quantity) AS totalQuantity
            FROM OrderDetails od
            JOIN Orders o ON od.orderid = o.billno
            JOIN FoodItem f ON od.foodid = f.fid
            JOIN Category c ON f.category = c.catid
            WHERE o.date LIKE ?
            GROUP BY c.catid
            ORDER BY totalQuantity DESC
            LIMIT 2
        `;
        
        db.all(query, [`${today}%`], (err, rows) => {
            if (err) {
                console.error("Error fetching today's most sold categories:", err);
                reject(err);
            } else {
                const categories = rows.map(row => row.catname); // Extract category names
                resolve(categories); // Return the list of most sold categories
            }
        });
    });
});

// IPC handler to get today's highest revenue items
ipcMain.handle('get-highest-revenue-items', (event) => {
    return new Promise((resolve, reject) => {
        const today = getLocalDateString();
        const query = `
            SELECT f.fname, SUM(od.quantity * f.cost) AS totalRevenue
            FROM OrderDetails od
            JOIN Orders o ON od.orderid = o.billno
            JOIN FoodItem f ON od.foodid = f.fid
            WHERE o.date LIKE ?
            GROUP BY f.fid
            ORDER BY totalRevenue DESC
            LIMIT 2
        `;
        
        db.all(query, [`${today}%`], (err, rows) => {
            if (err) {
                console.error("Error fetching today's highest revenue items:", err);
                reject(err);
            } else {
                const items = rows.map(row => row.fname); // Extract food names
                resolve(items); // Return the list of highest revenue items
            }
        });
    });
});

// IPC handler to get today's highest revenue category
ipcMain.handle('get-highest-revenue-category', (event) => {
    return new Promise((resolve, reject) => {
        const today = getLocalDateString();
        const query = `
            SELECT c.catname, SUM(od.quantity * f.cost) AS totalRevenue
            FROM OrderDetails od
            JOIN Orders o ON od.orderid = o.billno
            JOIN FoodItem f ON od.foodid = f.fid
            JOIN Category c ON f.category = c.catid
            WHERE o.date LIKE ?
            GROUP BY c.catid
            ORDER BY totalRevenue DESC
        `;
        
        db.all(query, [`${today}%`], (err, rows) => {
            if (err) {
                console.error("Error fetching today's highest revenue category:", err);
                reject(err);
            } else {
                const highestRevenue = rows.length > 0 ? rows[0].totalRevenue : 0; // Get the highest revenue
                const categories = rows.filter(row => row.totalRevenue === highestRevenue).map(row => row.catname); // Get all categories with the highest revenue
                resolve(categories); // Return the list of highest revenue categories
            }
        });
    });
});

// Function to fetch category-wise sales and revenue
ipcMain.handle('get-category-wise-sales-data', (event, startDate, endDate) => {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT 
                Category.catid,
                Category.catname,
                SUM(OrderDetails.quantity) AS totalSales,
                SUM(OrderDetails.quantity * FoodItem.cost) AS totalRevenue
            FROM 
                Orders
            INNER JOIN 
                OrderDetails ON Orders.billno = OrderDetails.orderid
            INNER JOIN 
                FoodItem ON OrderDetails.foodid = FoodItem.fid
            INNER JOIN 
                Category ON FoodItem.category = Category.catid
            WHERE 
                Orders.date BETWEEN ? AND ?
            GROUP BY 
                Category.catid
        `;

        db.all(query, [startDate, endDate], (err, rows) => {
            if (err) {
                console.error("Error fetching category-wise sales data:", err);
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
});

// Function to fetch sales overview data
ipcMain.handle('get-sales-overview-data', (event, startDate, endDate) => {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT 
                date,
                COUNT(billno) AS totalSales,
                SUM(price) AS totalRevenue
            FROM 
                Orders
            WHERE 
                date BETWEEN ? AND ?
            GROUP BY 
                date
            ORDER BY 
                date ASC
        `;

        db.all(query, [startDate, endDate], (err, rows) => {
            if (err) {
                console.error("Error fetching sales overview data:", err);
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
});

// Fetch top selling categories for a specific date range
ipcMain.on("get-top-selling-categories", async (event, { startDate, endDate }) => {
    const query = `
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
    `;

    db.all(query, [startDate, endDate], (err, rows) => {
        if (err) {
            console.error("Error fetching top selling categories:", err);
            event.reply("top-selling-categories-response", { success: false, categories: [] });
            return;
        }

        // Process the results to get the top-selling category for each date
        const topSellingCategories = {};
        rows.forEach(row => {
            if (!topSellingCategories[row.date]) {
                topSellingCategories[row.date] = {
                    category_name: row.category_name,
                    total_quantity: row.total_quantity,
                };
            } else if (row.total_quantity > topSellingCategories[row.date].total_quantity) {
                topSellingCategories[row.date] = {
                    category_name: row.category_name,
                    total_quantity: row.total_quantity,
                };
            }
        });

        // Convert the object to an array for easier processing
        const categoriesArray = Object.keys(topSellingCategories).map(date => ({
            date,
            category_name: topSellingCategories[date].category_name,
            total_quantity: topSellingCategories[date].total_quantity,
        }));

        // Send the top selling categories to the renderer process
        event.reply("top-selling-categories-response", { success: true, categories: categoriesArray });
    });
});

ipcMain.on('get-employee-analysis', (event, { startDate, endDate }) => {

    const query = `
        SELECT 
            u.userid,
            u.uname as name,
            COUNT(DISTINCT o.billno) as order_count,
            COALESCE(SUM(od.quantity), 0) as total_units,
            COALESCE(SUM(od.quantity * fi.cost), 0) as total_revenue
        FROM 
            User u
        LEFT JOIN Orders o ON u.userid = o.cashier 
            AND date(o.date) BETWEEN date(?) AND date(?)
        LEFT JOIN OrderDetails od ON o.billno = od.orderid
        LEFT JOIN FoodItem fi ON od.foodid = fi.fid
        GROUP BY u.userid
        ORDER BY total_revenue DESC
    `;

    db.all(query, [startDate, endDate], (err, rows) => {
        if (err) {
            console.error('Query error:', err);
            event.reply('employee-analysis-response', {
                success: false,
                error: err.message
            });
        } else {
            event.reply('employee-analysis-response', {
                success: true,
                employees: rows || []
            });
        }
    });
});

ipcMain.on('get-food-pairings', (event) => {
    const query = `
        SELECT 
            a.fname as item1, 
            b.fname as item2,
            COUNT(*) as times_ordered_together
        FROM OrderDetails od1
        JOIN OrderDetails od2 ON od1.orderid = od2.orderid AND od1.foodid < od2.foodid
        JOIN FoodItem a ON od1.foodid = a.fid
        JOIN FoodItem b ON od2.foodid = b.fid
        GROUP BY od1.foodid, od2.foodid
        ORDER BY times_ordered_together DESC
        LIMIT 50
    `;

    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('Error fetching food pairings:', err);
            event.reply('food-pairings-response', { 
                success: false, 
                error: err.message 
            });
        } else {
            event.reply('food-pairings-response', {
                success: true,
                pairings: rows
            });
        }
    });
});

ipcMain.on('get-menu-profitability', (event, { startDate, endDate }) => {
    const query = `
        WITH OrderTotals AS (
            SELECT 
                o.billno,
                SUM(od.quantity) as total_quantity,
                o.price as order_total
            FROM Orders o
            JOIN OrderDetails od ON o.billno = od.orderid
            WHERE o.date BETWEEN ? AND ?
            GROUP BY o.billno
        )
        SELECT 
            f.fname,
            c.catname,
            SUM(od.quantity) as total_units_sold,
            SUM(od.quantity * f.cost) as total_cost,
            SUM(od.quantity * (ot.order_total / ot.total_quantity)) as total_revenue,
            SUM(od.quantity * ((ot.order_total / ot.total_quantity) - f.cost)) as total_profit,
            ROUND(
                SUM(od.quantity * ((ot.order_total / ot.total_quantity) - f.cost)) * 100.0 / 
                SUM(od.quantity * (ot.order_total / ot.total_quantity)), 
                2
            ) as profit_margin
        FROM Orders o
        JOIN OrderDetails od ON o.billno = od.orderid
        JOIN FoodItem f ON od.foodid = f.fid
        JOIN Category c ON f.category = c.catid
        JOIN OrderTotals ot ON o.billno = ot.billno
        WHERE o.date BETWEEN ? AND ?
        GROUP BY od.foodid
        ORDER BY total_profit DESC
    `;

    db.all(query, [startDate, endDate, startDate, endDate], (err, rows) => {
        if (err) {
            console.error('Error fetching menu profitability data:', err);
            event.reply('menu-profitability-response', { 
                success: false, 
                error: err.message 
            });
        } else {
            event.reply('menu-profitability-response', {
                success: true,
                items: rows
            });
        }
    });
});

ipcMain.on('get-seven-day-sales', (event) => {
    // Calculate date range (past 7 days including today)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 6); // 7 days total
    
    // Format dates as YYYY-MM-DD
    const formatDate = (date) => getLocalDateString(date);
    const startDateStr = formatDate(startDate);
    const endDateStr = formatDate(endDate);
    
    // First get all dates in the range to ensure we have entries for all days
    const dateQuery = `
        WITH RECURSIVE dates(date) AS (
            VALUES(?)
            UNION ALL
            SELECT date(date, '+1 day')
            FROM dates
            WHERE date < ?
        )
        SELECT date FROM dates;
    `;
    
    db.all(dateQuery, [startDateStr, endDateStr], (err, dateRows) => {
        if (err) {
            console.error('Error getting date range:', err);
            event.reply('seven-day-sales-response', { 
                success: false, 
                error: err.message 
            });
            return;
        }
        
        // Now get sales counts and revenue for each date
        const salesQuery = `
            SELECT 
                date,
                COUNT(billno) as salesCount,
                COALESCE(SUM(price), 0) as totalRevenue
            FROM Orders
            WHERE date BETWEEN ? AND ?
            GROUP BY date
            ORDER BY date;
        `;
        
        // Get units sold separately since it requires joining with OrderDetails
        const unitsQuery = `
            SELECT 
                o.date,
                COALESCE(SUM(od.quantity), 0) as unitsSold
            FROM Orders o
            LEFT JOIN OrderDetails od ON o.billno = od.orderid
            WHERE o.date BETWEEN ? AND ?
            GROUP BY o.date
            ORDER BY o.date;
        `;
        
        // Execute both queries in parallel
        Promise.all([
            new Promise((resolve, reject) => {
                db.all(salesQuery, [startDateStr, endDateStr], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            }),
            new Promise((resolve, reject) => {
                db.all(unitsQuery, [startDateStr, endDateStr], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            })
        ]).then(([salesRows, unitsRows]) => {
            // Create maps for each metric
            const salesMap = {};
            const revenueMap = {};
            const unitsMap = {};
            
            // Process sales and revenue data
            salesRows.forEach(row => {
                salesMap[row.date] = row.salesCount;
                revenueMap[row.date] = row.totalRevenue;
            });
            
            // Process units sold data
            unitsRows.forEach(row => {
                unitsMap[row.date] = row.unitsSold;
            });
            
            // Prepare response with all dates in order
            const response = {
                success: true,
                dates: dateRows.map(row => row.date),
                salesCounts: dateRows.map(row => salesMap[row.date] || 0),
                totalRevenues: dateRows.map(row => revenueMap[row.date] || 0),
                unitsSold: dateRows.map(row => unitsMap[row.date] || 0)
            };
            
            event.reply('seven-day-sales-response', response);
        }).catch(err => {
            console.error('Error getting sales data:', err);
            event.reply('seven-day-sales-response', { 
                success: false, 
                error: err.message 
            });
        });
    });
});

// In your main.js file, add this to the IPC handlers section:
// In your main.js file, add/update this IPC handler:
ipcMain.on('get-best-in-category', (event, { startDate, endDate }) => {
    const query = `
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
    `;

    db.all(query, [startDate, endDate], (err, rows) => {
        if (err) {
            console.error('Error fetching best in category data:', err);
            event.reply('best-in-category-response', { 
                success: false, 
                error: err.message 
            });
        } else {
            const processedRows = rows.map(row => ({
                ...row,
                top_items: row.top_items ? row.top_items.split(', ') : []
            }));
            
            event.reply('best-in-category-response', {
                success: true,
                categories: processedRows
            });
        }
    });
});

ipcMain.on('get-tax-on-items', (event, { startDate, endDate }) => {
    const query = `
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
    `;

    db.all(query, [startDate, endDate], (err, rows) => {
        if (err) {
            console.error('Error fetching tax data:', err);
            event.reply('tax-on-items-response', { 
                success: false, 
                error: err.message 
            });
        } else {
            event.reply('tax-on-items-response', {
                success: true,
                items: rows
            });
        }
    });
});
//----------------------------------------------ANALYTICS ENDS HERE--------------------------------------------------------------

let isPrinting = false;
ipcMain.on("print-kot-only", (event, { billItems, totalAmount, kot, orderId }) => {
    if (isPrinting) {
        event.sender.send('print-error', 'Printer is busy');
        return;
    }
    isPrinting = true;

    try {
        const config = store.get('printerConfig', {
            vendorId: '0x0525',
            productId: '0xA700'
        });

        const vendorId = parseInt(config.vendorId, 16);
        const productId = parseInt(config.productId, 16);

        if (isNaN(vendorId) || isNaN(productId)) {
            throw new Error('Invalid printer configuration - please check Vendor/Product IDs');
        }

        const device = new escpos.USB(vendorId, productId);
        const printer = new escpos.Printer(device, { encoding: 'UTF-8' });

        device.open((err) => {
            if (err) {
                event.sender.send('print-error', `Printer connection failed: ${err.message}`);
                return;
            }

            // Generate only KOT commands (no customer receipt)
            const commands = generateKOTOnly(billItems, totalAmount, kot, orderId);
            
            printer
                .raw(Buffer.from(commands, 'utf8'))
                .close((err) => {
                    if (err) {
                        event.sender.send('print-error', `Print failed: ${err.message}`);
                    } else {
                        event.sender.send('print-kot-success', { kot, orderId });
                    }
                });
        });
    } catch (error) {
        event.sender.send('print-error', `System error: ${error.message}`);
    } finally {
        isPrinting = false;
    }
});

// Function to generate only KOT (no customer receipt)
function generateKOTOnly(items, totalAmount, kot, orderId) {
    const template = loadReceiptTemplate({
        title: 'THE LASSI CORNER',
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
    if (isPrinting) {
        event.sender.send('print-error', 'Printer is busy');
        return;
    }
    isPrinting = true;

    try {
        const config = store.get('printerConfig', {
            vendorId: '0x0525',
            productId: '0xA700'
        });

        const vendorId = parseInt(config.vendorId, 16);
        const productId = parseInt(config.productId, 16);

        if (isNaN(vendorId) || isNaN(productId)) {
            throw new Error('Invalid printer configuration - please check Vendor/Product IDs');
        }

        const device = new escpos.USB(vendorId, productId);
        const printer = new escpos.Printer(device, { encoding: 'UTF-8' });

        device.open((err) => {
            if (err) {
                event.sender.send('print-error', `Printer connection failed: ${err.message}`);
                return;
            }

            // Generate only customer receipt commands (no KOT)
            const commands = generateBillOnly(billItems, totalAmount, kot, orderId, dateTime);
            
            printer
                .raw(Buffer.from(commands, 'utf8'))
                .close((err) => {
                    if (err) {
                        event.sender.send('print-error', `Print failed: ${err.message}`);
                    } else {
                        event.sender.send('print-success');
                    }
                });
        });
    } catch (error) {
        event.sender.send('print-error', `System error: ${error.message}`);
    } finally {
        isPrinting = false;
    }
});

// Function to generate only customer receipt (no KOT)
function generateBillOnly(items, totalAmount, kot, orderId, dateTime) {
    const template = loadReceiptTemplate({
        title: 'THE LASSI CORNER',
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
    // First get the order header
    const orderQuery = `
        SELECT * FROM Orders WHERE billno = ?;
    `;
    
    // Get actual item prices from FoodItem table
    const itemsQuery = `
        SELECT 
            f.fname,
            f.cost as item_price,
            od.quantity
        FROM OrderDetails od
        JOIN FoodItem f ON od.foodid = f.fid
        WHERE od.orderid = ?;
    `;
    
    db.get(orderQuery, [billno], (err, order) => {
        if (err) {
            console.error('Error fetching order:', err);
            event.reply('order-for-printing-response', { error: err.message });
            return;
        }
        
        if (!order) {
            event.reply('order-for-printing-response', { error: 'Order not found' });
            return;
        }
        
        db.all(itemsQuery, [billno], (err, items) => {
            if (err) {
                console.error('Error fetching order items:', err);
                event.reply('order-for-printing-response', { error: err.message });
                return;
            }
            
            // Format items with individual prices (not total prices)
            const processedItems = items.map(item => ({
                fname: item.fname,
                quantity: item.quantity,
                price: item.item_price // Individual item price, not total
            }));
            
            event.reply('order-for-printing-response', { 
                order, 
                items: processedItems 
            });
        });
    });
});

ipcMain.handle('test-printer', async (event, { printerName, vendorId, productId, testData }) => {
    if (isPrinting) {
        event.sender.send('test-printer-error', 'Printer is busy');
        return;
    }
    isPrinting = true;

    try {
        // Use config from store if not provided
        const config = store.get('printerConfig', {
            vendorId: '0x0525',
            productId: '0xA700'
        });
        const vendorNum = parseInt(vendorId || config.vendorId, 16);
        const productNum = parseInt(productId || config.productId, 16);

        if (isNaN(vendorNum) || isNaN(productNum)) {
            throw new Error('Invalid printer configuration - please check Vendor/Product IDs');
        }

        const device = new escpos.USB(vendorNum, productNum);
        const printer = new escpos.Printer(device, { encoding: 'UTF-8' });

        const commands = generateTestReceipt(testData);

        device.open((err) => {
            if (err) {
                event.sender.send('test-printer-error', `Printer connection failed: ${err.message}`);
                isPrinting = false;
                return;
            }

            printer
                .raw(Buffer.from(commands, 'utf8'))
                .close((err) => {
                    if (err) {
                        event.sender.send('test-printer-error', `Print failed: ${err.message}`);
                    } else {
                        event.sender.send('test-printer-success', true);
                    }
                    isPrinting = false;
                });
        });
    } catch (error) {
        event.sender.send('test-printer-error', `System error: ${error.message}`);
        isPrinting = false;
    }
});

function generateTestReceipt(testData) {
    const template = store.get('receiptTemplate', {
        title: 'THE LASSI CORNER',
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
    const heldOrdersQuery = `
        SELECT 
            HeldOrders.heldid, 
            User.uname AS cashier_name, 
            HeldOrders.price, 
            HeldOrders.sgst, 
            HeldOrders.cgst, 
            HeldOrders.tax, 
            GROUP_CONCAT(FoodItem.fname || ' (x' || HeldOrderDetails.quantity || ')', ', ') AS food_items
        FROM HeldOrders
        JOIN User ON HeldOrders.cashier = User.userid
        JOIN HeldOrderDetails ON HeldOrders.heldid = HeldOrderDetails.heldid
        JOIN FoodItem ON HeldOrderDetails.foodid = FoodItem.fid
        GROUP BY HeldOrders.heldid
        ORDER BY HeldOrders.heldid DESC
    `;

    db.all(heldOrdersQuery, [], (err, heldOrders) => {
        if (err) {
            console.error("Error fetching held orders:", err);
            event.reply('held-orders-data', []);
            return;
        }

        event.reply('held-orders-data', heldOrders);
    });
});
//regarding held orders:
// Fetch held order details
ipcMain.on('get-held-order-details', (event, heldId) => {
    const query = `
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
    `;

    db.get(query, [heldId], (err, orderDetails) => {
        if (err) {
            console.error("Error fetching held order details:", err);
            event.reply('held-order-details-data', [], heldId);
            return;
        }

        // Parse JSON string from SQLite JSON functions
        let foodDetails = orderDetails.food_details ? JSON.parse(orderDetails.food_details) : [];

        event.reply('held-order-details-data', foodDetails, heldId); // Pass `heldId` back
    });
});


// Delete a held order
ipcMain.on('delete-held-order', (event, heldId) => {
    const deleteOrderDetailsQuery = `DELETE FROM HeldOrderDetails WHERE heldid = ?`;
    const deleteOrderQuery = `DELETE FROM HeldOrders WHERE heldid = ?`;

    db.run(deleteOrderDetailsQuery, [heldId], function (err) {
        if (err) {
            console.error("Error deleting held order details:", err);
            return;
        }

        db.run(deleteOrderQuery, [heldId], function (err) {
            if (err) {
                console.error("Error deleting held order:", err);
                return;
            }

            event.reply('held-order-deleted', heldId);
        });
    });
});



// save bill
ipcMain.on("save-bill", async (event, orderData) => {
    const { cashier, date, orderItems, totalAmount } = orderData;

    try {
        let totalSGST = 0, totalCGST = 0, totalTax = 0, calculatedTotalAmount = 0;

        // Fetch tax details and calculate actual total
        for (const { foodId, quantity } of orderItems) {
            const row = await new Promise((resolve, reject) => {
                db.get(
                    `SELECT cost, sgst, cgst, tax FROM FoodItem WHERE fid = ?`,
                    [foodId],
                    (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    }
                );
            });

            if (!row) {
                throw new Error(`Food item with ID ${foodId} not found.`);
            }

            let itemTotal = row.cost * quantity; // Get correct item total from DB
            calculatedTotalAmount += itemTotal; // Accumulate correct total

            totalSGST += (itemTotal * row.sgst) / 100;
            totalCGST += (itemTotal * row.cgst) / 100;
            totalTax += (itemTotal * row.tax) / 100;
        }

        // If totalAmount is 0, use calculatedTotalAmount instead
        const finalTotalAmount = totalAmount > 0 ? totalAmount : calculatedTotalAmount;

        // Get the latest KOT number for the current date
        const kotRow = await new Promise((resolve, reject) => {
            db.get(
                `SELECT kot FROM Orders WHERE date = ? ORDER BY kot DESC LIMIT 1`,
                [date],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        let kot = kotRow ? kotRow.kot + 1 : 1; // Increment KOT or reset if new day

        // Insert the new order with correct total
        const orderId = await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO Orders (kot, price, sgst, cgst, tax, cashier, date) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [kot, finalTotalAmount.toFixed(2), totalSGST.toFixed(2), totalCGST.toFixed(2), totalTax.toFixed(2), cashier, date],
                function (err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });

        // Insert items into OrderDetails
        const stmt = db.prepare(
            `INSERT INTO OrderDetails (orderid, foodid, quantity) VALUES (?, ?, ?)`
        );
        orderItems.forEach(({ foodId, quantity }) => stmt.run(orderId, foodId, quantity));
        stmt.finalize();

        // Check if a discount was applied and insert into DiscountedOrders
        if (calculatedTotalAmount > finalTotalAmount) {
            const discountAmount = (calculatedTotalAmount - finalTotalAmount).toFixed(2);
            const discountPercentage = ((discountAmount / calculatedTotalAmount) * 100).toFixed(2);

            await new Promise((resolve, reject) => {
                db.run(
                    `INSERT INTO DiscountedOrders (billno, Initial_price, discount_percentage, discount_amount) VALUES (?, ?, ?, ?)`,
                    [orderId, calculatedTotalAmount.toFixed(2), discountPercentage, discountAmount],
                    function (err) {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
        }

        console.log(`Order ${orderId} saved successfully with KOT ${kot}.`);

        // Send success response and KOT number to renderer
        event.sender.send("bill-saved", { kot,orderId });

    } catch (error) {
        console.error("Error processing order:", error.message);
        event.sender.send("bill-error", { error: error.message });
    }
});


ipcMain.on("hold-bill", async (event, orderData) => {
    const { cashier, date, orderItems } = orderData;

    try {
        let totalPrice = 0, totalSGST = 0, totalCGST = 0, totalTax = 0;

        // Fetch food item data and calculate totals
        for (const { foodId, quantity } of orderItems) {
            const row = await new Promise((resolve, reject) => {
                db.get(`SELECT cost, sgst, cgst, tax FROM FoodItem WHERE fid = ?`, [foodId], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });

            if (!row) {
                throw new Error(`Food item with ID ${foodId} not found.`);
            }

            let itemTotal = row.cost * quantity;
            totalPrice += itemTotal;
            totalSGST += (itemTotal * row.sgst) / 100;
            totalCGST += (itemTotal * row.cgst) / 100;
            totalTax += (itemTotal * row.tax) / 100;
        }

        // Insert the new order
        const orderId = await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO HeldOrders (price, sgst, cgst, tax, cashier) VALUES (?, ?, ?, ?, ?)`,
                [totalPrice.toFixed(2), totalSGST.toFixed(2), totalCGST.toFixed(2), totalTax.toFixed(2), cashier], // Keeping .toFixed(2)
                function (err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });

        // Insert items into HeldOrderDetails
        const stmt = db.prepare(`INSERT INTO HeldOrderDetails (heldid, foodid, quantity) VALUES (?, ?, ?)`);

        for (const { foodId, quantity } of orderItems) {
            await new Promise((resolve, reject) => {
                stmt.run(orderId, foodId, quantity, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        }

        stmt.finalize();

        console.log(`Order Held Successfully`);

        // Send success response
        event.sender.send("bill-held");

    } catch (error) {
        console.error("Error processing order:", error.message);
        event.sender.send("bill-error", { error: error.message });
    }
});
// Fetch top selling items for a specific date range
ipcMain.on("get-top-selling-items", async (event, { startDate, endDate }) => {
    const query = `
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
    `;

    db.all(query, [startDate, endDate], (err, rows) => {
        if (err) {
            console.error("Error fetching top selling items:", err);
            event.reply("top-selling-items-response", { success: false, items: [] });
            return;
        }

        // Process the results to get the most sold item(s) for each date
        const topSellingItems = {};
        rows.forEach(row => {
            if (!topSellingItems[row.date]) {
                topSellingItems[row.date] = { most_sold_items: [row.most_sold_item], total_quantity: row.total_quantity };
            } else if (row.total_quantity === topSellingItems[row.date].total_quantity) {
                topSellingItems[row.date].most_sold_items.push(row.most_sold_item); // Add to the list of most sold items
            } else if (row.total_quantity > topSellingItems[row.date].total_quantity) {
                topSellingItems[row.date] = { most_sold_items: [row.most_sold_item], total_quantity: row.total_quantity };
            }
        });

        // Convert the object to an array for easier processing
        const itemsArray = Object.keys(topSellingItems).map(date => ({
            date,
            most_sold_item: topSellingItems[date].most_sold_items.join(", ") // Join items with commas
        }));

        event.reply("top-selling-items-response", { success: true, items: itemsArray });
    });
});

//------------------------------BILLING ENDS HERE--------------------------------
//---------------------------------HISTORY TAB-------------------------------------
// Fetch Today's Orders
ipcMain.on("get-todays-orders", (event) => {
    
    const query = `
        SELECT 
            Orders.*, 
            User.uname AS cashier_name, 
            GROUP_CONCAT(FoodItem.fname || ' (x' || OrderDetails.quantity || ')', ', ') AS food_items
        FROM Orders
        LEFT JOIN User ON Orders.cashier = User.userid
        LEFT JOIN OrderDetails ON Orders.billno = OrderDetails.orderid
        LEFT JOIN FoodItem ON OrderDetails.foodid = FoodItem.fid
        WHERE date(Orders.date) = date('now', 'localtime')
        GROUP BY Orders.billno
        ORDER BY Orders.billno DESC;

    `;

    db.all(query, [], (err, rows) => {
        if (err) {
            console.error("Error fetching today's orders:", err);
            event.reply("todays-orders-response", { success: false, orders: [] });
            return;
        }
        event.reply("todays-orders-response", { success: true, orders: rows });
    });
});

// Listen for order history requests
ipcMain.on("get-order-history", (event, data) => {
    // Add safety check to prevent destructuring undefined
    if (!data) {
        console.error("No data provided for get-order-history");
        event.reply("order-history-response", { success: false, orders: [], message: "No data provided" });
        return;
    }

    const { startDate, endDate } = data;

    if (!startDate || !endDate) {
        console.error("Missing startDate or endDate for get-order-history");
        event.reply("order-history-response", { success: false, orders: [], message: "Missing date parameters" });
        return;
    }

    const query = `
        SELECT 
            Orders.*, 
            User.uname AS cashier_name, 
            GROUP_CONCAT(FoodItem.fname || ' (x' || OrderDetails.quantity || ')', ', ') AS food_items
        FROM Orders
        LEFT JOIN User ON Orders.cashier = User.userid
        LEFT JOIN OrderDetails ON Orders.billno = OrderDetails.orderid
        LEFT JOIN FoodItem ON OrderDetails.foodid = FoodItem.fid
        WHERE date(Orders.date) BETWEEN date(?) AND date(?)
        GROUP BY Orders.billno
        ORDER BY Orders.date DESC;
    `;

    db.all(query, [startDate, endDate], (err, rows) => {
        if (err) {
            console.error("Error fetching order history:", err);
            event.reply("fetchOrderHistoryResponse", { success: false, orders: [] });
            return;
        }
        //console.log("Order history fetched:", rows); 
        event.reply("order-history-response", { success: true, orders: rows });
    });
});

ipcMain.on("confirm-delete-order", async (event, { billNo, reason, source }) => {
    try {
        // Convert db.get and db.all into Promises
        const getAsync = (query, params) => {
            return new Promise((resolve, reject) => {
                db.get(query, params, (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
        };

        const allAsync = (query, params) => {
            return new Promise((resolve, reject) => {
                db.all(query, params, (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            });
        };

        // Fetch order and order details using Promises
        const order = await getAsync("SELECT * FROM Orders WHERE billno = ?", [billNo]);
        const orderDetails = await allAsync("SELECT * FROM OrderDetails WHERE orderid = ?", [billNo]);

        if (!order) {
            event.reply("delete-order-response", { success: false, message: "Order not found!" });
            return;
        }

        // Insert into DeletedOrders
        await db.run(
            "INSERT INTO DeletedOrders (billno, date, cashier, kot, price, sgst, cgst, tax, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [order.billno, order.date, order.cashier, order.kot, order.price, order.sgst, order.cgst, order.tax, reason]
        );

        // Insert into DeletedOrderDetails
        for (const detail of orderDetails) {
            await db.run(
                "INSERT INTO DeletedOrderDetails (orderid, foodid, quantity) VALUES (?, ?, ?)",
                [detail.orderid, detail.foodid, detail.quantity]
            );
        }

        // Delete from Orders and OrderDetails
        await db.run("DELETE FROM Orders WHERE billno = ?", [billNo]);
        await db.run("DELETE FROM OrderDetails WHERE orderid = ?", [billNo]);

        event.reply("delete-order-response", { success: true, message: "Order deleted successfully!" });

        // ✅ Notify the renderer process about the deletion
        mainWindow.webContents.send("order-deleted", { source });
        mainWindow.webContents.send("refresh-order-history");

    } catch (error) {
        console.error("Error deleting order:", error);
        event.reply("delete-order-response", { success: false, message: "Failed to delete order." });
    }
});

ipcMain.on("get-categories-event", (event) => {

    const query = `SELECT catid, catname FROM Category WHERE active = 1`;

    db.all(query, [], (err, rows) => {
        if (err) {
            console.error("Error fetching categories:", err);
            event.reply("categories-response", { success: false, categories: [] });
            return;
        }
        event.reply("categories-response", { success: true, categories: rows });
    });
});

// Listens for deleted order requests, retrieves the deleted orders from the DeletedOrders table and sends records back in response
ipcMain.on("get-deleted-orders", (event, { startDate, endDate }) => {

    const query = `
        SELECT 
            DeletedOrders.*, 
            User.uname AS cashier_name, 
            GROUP_CONCAT(FoodItem.fname || ' (x' || DeletedOrderDetails.quantity || ')', ', ') AS food_items
        FROM DeletedOrders
        JOIN User ON DeletedOrders.cashier = User.userid
        JOIN DeletedOrderDetails ON DeletedOrders.billno = DeletedOrderDetails.orderid
        JOIN FoodItem ON DeletedOrderDetails.foodid = FoodItem.fid
        WHERE date(DeletedOrders.date) BETWEEN date(?) AND date(?)
        GROUP BY DeletedOrders.billno
        ORDER BY DeletedOrders.date DESC
    `;

    db.all(query, [startDate, endDate], (err, rows) => {
        if (err) {
            console.error("Error fetching deleted orders:", err);
            event.reply("fetchDeletedOrdersResponse", { success: false, orders: [] });
            return;
        }
        event.reply("deleted-orders-response", { success: true, orders: rows });
    });
});

ipcMain.handle("show-save-dialog", async (event, defaultFilename) => {
    const result = await dialog.showSaveDialog({
        title: "Save Excel File",
        defaultPath: defaultFilename,
        filters: [
            { name: "Excel Files", extensions: ["xlsx"] },
            { name: "All Files", extensions: ["*"] },
        ],
    });

    // result.filePath is null if the user cancels the dialog
    return result.canceled ? null : result.filePath;
});
// Fetch Customers
ipcMain.on("get-customers", (event) => {
    const query = `
        SELECT * FROM Customer
        ORDER BY cid ASC
    `;

    db.all(query, [], (err, rows) => {
        if (err) {
            console.error("Error fetching customers:", err);
            event.reply("customers-response", { success: false, customers: [] });
            return;
        }
        event.reply("customers-response", { success: true, customers: rows });
    });
});

// Clear Deleted Orders
ipcMain.on("clear-deleted-orders", (event) => {
    const deleteOrdersQuery = `DELETE FROM DeletedOrders`;
    const deleteOrderDetailsQuery = `DELETE FROM DeletedOrderDetails`;

    db.serialize(() => {
        db.run(deleteOrderDetailsQuery, [], (err) => {
            if (err) {
                console.error("Error clearing DeletedOrderDetails:", err);
                event.reply("clear-deleted-orders-response", { success: false });
                return;
            }
            db.run(deleteOrdersQuery, [], (err) => {
                if (err) {
                    console.error("Error clearing DeletedOrders:", err);
                    event.reply("clear-deleted-orders-response", { success: false });
                    return;
                }
                event.reply("clear-deleted-orders-response", { success: true });
            });
        });
    });
});

ipcMain.on("get-discounted-orders", (event, { startDate, endDate }) => {
    const query = `
        SELECT 
            d.billno, 
            o.kot, 
            o.date,
            d.Initial_price, 
            d.discount_percentage, 
            d.discount_amount, 
            o.price AS Final_Price,
            GROUP_CONCAT(f.fname, ', ') AS food_items
        FROM DiscountedOrders d
        JOIN Orders o ON d.billno = o.billno
        LEFT JOIN OrderDetails od ON d.billno = od.orderid
        LEFT JOIN FoodItem f ON od.foodid = f.fid
        WHERE date(o.date) BETWEEN date(?) AND date(?)
        GROUP BY d.billno, o.kot, o.date, d.Initial_price, d.discount_percentage, d.discount_amount
    `;

    db.all(query, [startDate, endDate], (err, rows) => {
        if (err) {
            console.error("Error fetching discounted orders:", err);
            event.reply("discounted-orders-response", { success: false, orders: [] });
            return;
        }
        event.reply("discounted-orders-response", { success: true, orders: rows });
    });
});

// Clear Discounted Orders
ipcMain.on("clear-discounted-orders", (event) => {
    const deleteDiscountedOrdersQuery = `DELETE FROM DiscountedOrders`;

    db.run(deleteDiscountedOrdersQuery, [], (err) => {
        if (err) {
            console.error("Error clearing DiscountedOrders:", err);
            event.reply("clear-discounted-orders-response", { success: false });
            return;
        }
        event.reply("clear-discounted-orders-response", { success: true });
    });
});

// IPC Listener to add a new customer
ipcMain.on("add-customer", (event, customerData) => {
    const { cname, phone, address } = customerData;

    const query = `INSERT INTO Customer (cname, phone, address) VALUES (?, ?, ?)`;
    db.run(query, [cname, phone, address], function (err) {
        if (err) {
            console.error("Error adding customer:", err);
            event.reply("customer-added-response", { success: false });
        } else {
            console.log("Customer added successfully");
            event.reply("customer-added-response", { success: true });
        }
    });
});

// Handle Delete Customer
ipcMain.on("delete-customer", (event, { customerId }) => {
    db.run("DELETE FROM Customer WHERE cid = ?", [customerId], function (err) {
        if (err) {
            console.error("Error deleting customer:", err);
            event.reply("customer-delete-response", { success: false });
        } else {
            console.log("Customer deleted successfully");
            event.reply("customer-delete-response", { success: true });
        }
    });
});

// Handle Update Customer
ipcMain.on("update-customer", (event, updatedCustomer) => {
    const { cid, cname, phone, address } = updatedCustomer;
    db.run(
        "UPDATE Customer SET cname = ?, phone = ?, address = ? WHERE cid = ?",
        [cname, phone, address, cid],
        function (err) {
            if (err) {
                console.error("Error updating customer:", err);
                event.reply("update-customer-response", { success: false, error: err.message });
                return;
            }
            event.reply("update-customer-response", { success: true });
        }
    );
});
// Fetch order details for a specific bill number
ipcMain.on("get-order-details", (event, billno) => {
    const query = `
        SELECT 
            OrderDetails.foodid AS foodId,
            FoodItem.fname AS foodName,
            FoodItem.cost AS price,
            OrderDetails.quantity AS quantity
        FROM OrderDetails
        JOIN FoodItem ON OrderDetails.foodid = FoodItem.fid
        WHERE OrderDetails.orderid = ?
    `;

    db.all(query, [billno], (err, rows) => {
        if (err) {
            console.error("Error fetching order details:", err);
            event.reply("order-details-response", { food_items: [] });
            return;
        }
        event.reply("order-details-response", { food_items: rows });
    });
});

// Day-Wise Data Handler
ipcMain.on('get-day-wise-data', (event, { startDate, endDate }) => {
    const query = `
        SELECT 
            date,
            COUNT(DISTINCT billno) as order_count,
            COALESCE(SUM(
                (SELECT SUM(quantity) 
                 FROM OrderDetails 
                 WHERE orderid = Orders.billno)
            ), 0) as total_units,
            COALESCE(SUM(price), 0) as total_revenue
        FROM Orders
        WHERE date BETWEEN ? AND ?
        GROUP BY date
        ORDER BY date DESC
    `;

    db.all(query, [startDate, endDate], (err, rows) => {
        if (err) {
            console.error('Error fetching day-wise data:', err);
            event.reply('day-wise-data-response', { 
                success: false, 
                error: err.message 
            });
        } else {
            event.reply('day-wise-data-response', {
                success: true,
                days: rows
            });
        }
    });
});

// Month-Wise Data Handler
ipcMain.on('get-month-wise-data', (event, { year }) => {
    const query = `
        SELECT 
            CAST(strftime('%m', date) AS INTEGER) as month,
            COUNT(DISTINCT billno) as order_count,
            COALESCE(SUM(
                (SELECT SUM(quantity) 
                 FROM OrderDetails 
                 WHERE orderid = Orders.billno)
            ), 0) as total_units,
            COALESCE(SUM(price), 0) as total_revenue
        FROM Orders
        WHERE strftime('%Y', date) = ?
        GROUP BY month
        ORDER BY month ASC
    `;

    db.all(query, [year.toString()], (err, rows) => {
        if (err) {
            console.error('Error fetching month-wise data:', err);
            event.reply('month-wise-data-response', { 
                success: false, 
                error: err.message 
            });
        } else {
            event.reply('month-wise-data-response', {
                success: true,
                months: rows
            });
        }
    });
});

// Year-Wise Data Handler
ipcMain.on('get-year-wise-data', (event) => {
    const query = `
        SELECT 
            strftime('%Y', date) as year,
            COUNT(DISTINCT billno) as order_count,
            COALESCE(SUM(
                (SELECT SUM(quantity) 
                 FROM OrderDetails 
                 WHERE orderid = Orders.billno)
            ), 0) as total_units,
            COALESCE(SUM(price), 0) as total_revenue
        FROM Orders
        GROUP BY year
        ORDER BY year DESC
    `;

    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('Error fetching year-wise data:', err);
            event.reply('year-wise-data-response', { 
                success: false, 
                error: err.message 
            });
        } else {
            event.reply('year-wise-data-response', {
                success: true,
                years: rows
            });
        }
    });
});
const Store = require('electron-store');

//----------------------------------------------SETTINGS TAB ENDS HERE--------------------------------------------

// Store for category order
let categoryOrderStore = new Store({ name: 'category-order' });

// Modified get-categories handler to respect custom order
ipcMain.handle("get-categories", async () => {
    return new Promise((resolve, reject) => {
        db.all("SELECT catid, catname FROM Category WHERE active = 1", [], (err, rows) => {
            if (err) {
                reject(err);
            } else {
                // Get custom order if exists
                const customOrder = categoryOrderStore.get('order', []);
                
                if (customOrder.length > 0) {
                    // Sort categories according to custom order
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
                    
                    // Remove undefined slots and combine with unordered categories
                    const filteredOrdered = orderedCategories.filter(cat => cat !== undefined);
                    resolve([...filteredOrdered, ...unorderedCategories]);
                } else {
                    resolve(rows);
                }
            }
        });
    });
});
//----------------------------------------------MENU TAB STARTS HERE ----------------------------------------------------------
// Update the IPC handler in main.js with better error handling
ipcMain.handle("get-menu-items", async () => {
    try {
        if (!db) {
            throw new Error("Database not connected");
        }

        const foodQuery = `
            SELECT 
                f.fid, f.fname, f.category, f.cost, 
                f.sgst, f.cgst, f.veg, f.is_on, f.active,
                c.catname AS category_name
            FROM FoodItem f
            JOIN Category c ON f.category = c.catid;
        `;

        // Wrap in try-catch and improve error messages
        const foodItems = await new Promise((resolve, reject) => {
            db.all(foodQuery, (err, rows) => {
                if (err) {
                    console.error("[Food Query] SQL Error:", err.message);
                    reject(new Error(`Food query failed: ${err.message}`));
                } else {
                    resolve(rows);
                }
            });
        });

        console.log("✅ Successfully fetched food items:", foodItems.length);
        return foodItems;

    } catch (err) {
        console.error("❌ Error in get-menu-items handler:", err);
        throw new Error(`Failed to fetch menu items: ${err.message || err}`);
    }
});

// Toggle menu items - DAILY TOGGLE ON/OFF:
ipcMain.handle("toggle-menu-item", async (event, fid) => {
    try {
        await new Promise((resolve, reject) => {
            db.run(
                `
                UPDATE FoodItem 
                SET is_on = CASE WHEN is_on = 1 THEN 0 ELSE 1 END
                WHERE fid = ?
                `,
                [fid],
                function (err) {
                    if (err) {
                        console.error("Error toggling item:", err);
                        reject(err);
                    } else {
                        resolve(true);
                    }
                }
            );
        });

        // Fetch updated value
        const updatedItem = await new Promise((resolve, reject) => {
            db.get("SELECT is_on FROM FoodItem WHERE fid = ?", [fid], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        return updatedItem ? updatedItem.is_on : null;
    } catch (err) {
        console.error("Error toggling menu item:", err);
        return null;
    }
});

// Toggle menu items - ACTIVE TOGGLE:
ipcMain.handle("toggle-menu-item-active", async (event, fid) => {
    try {
        await new Promise((resolve, reject) => {
            db.run(
                `
                UPDATE FoodItem 
                SET active = CASE WHEN active = 1 THEN 0 ELSE 1 END
                WHERE fid = ?
                `,
                [fid],
                function (err) {
                    if (err) {
                        console.error("Error toggling active state:", err);
                        reject(err);
                    } else {
                        resolve(true);
                    }
                }
            );
        });

        // Fetch updated value
        const updatedItem = await new Promise((resolve, reject) => {
            db.get("SELECT active FROM FoodItem WHERE fid = ?", [fid], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        return updatedItem ? updatedItem.active : null;
    } catch (err) {
        console.error("Error toggling active state:", err);
        return null;
    }
});

// Delete Menu Item
ipcMain.handle("delete-menu-item", async (event, fid) => {
    try {
        await new Promise((resolve, reject) => {
            db.run("DELETE FROM FoodItem WHERE fid = ?", [fid], function (err) {
                if (err) {
                    console.error("Error deleting item:", err);
                    reject(err);
                } else {
                    resolve(true);
                }
            });
        });

        return true;
    } catch (err) {
        console.error("Error deleting menu item:", err);
        return false;
    }
});
//Edit Menu ITems
ipcMain.handle("update-food-item", async (event, { fid, fname, category, cost, sgst, cgst, veg }) => {
    try {
        const query = `
            UPDATE FoodItem 
            SET fname = ?, cost = ?, category = ?, sgst = ?, cgst = ?, veg = ?
            WHERE fid = ?
        `;
        await db.run(query, [fname, cost, category, sgst, cgst, veg, fid]);
        return { success: true };
    } catch (error) {
        console.error("Error updating food item:", error);
        return { success: false, error: error.message };
    }
});

// Handle fetching categories for dropdowns
ipcMain.handle("get-categories-for-additem", async () => {
    try {
        if (!db) throw new Error("Database not connected");

        const query = "SELECT catid, catname, active FROM Category ORDER BY catname";
        
        return await new Promise((resolve, reject) => {
            db.all(query, (err, rows) => {
                if (err) {
                    console.error("Database error fetching categories:", err);
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    } catch (err) {
        console.error("Error in get-categories-for-additem handler:", err);
        throw err;
    }
});
// Add new food item
ipcMain.handle("add-food-item", async (event, item) => {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO FoodItem (fname, category, cost, sgst, cgst, tax, active, is_on, veg)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                item.fname,
                item.category,
                item.cost,
                item.sgst,
                item.cgst,
                item.tax,
                item.active,
                item.is_on,
                item.veg
            ],
            function (err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ success: true, fid: this.lastID });
                }
            }
        );
    });
});

// Bulk update food items
ipcMain.handle('bulk-update-food-items', async (event, updates) => {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            
            let completed = 0;
            let errors = [];
            
            updates.forEach(update => {
                const query = `
                    UPDATE FoodItem 
                    SET fname = ?, category = ?, cost = ?, sgst = ?, cgst = ?, veg = ?, active = ?
                    WHERE fid = ?
                `;
                
                db.run(query, [
                    update.fname,
                    update.category,
                    update.cost,
                    update.sgst,
                    update.cgst,
                    update.veg,
                    update.active,
                    update.fid
                ], function(err) {
                    completed++;
                    
                    if (err) {
                        errors.push(`Item ${update.fid}: ${err.message}`);
                    }
                    
                    if (completed === updates.length) {
                        if (errors.length > 0) {
                            db.run("ROLLBACK");
                            resolve({ success: false, error: errors.join(', ') });
                        } else {
                            db.run("COMMIT");
                            resolve({ success: true, updatedCount: updates.length });
                        }
                    }
                });
            });
        });
    });
});

//----------------------------------------------MENU TAB ENDS HERE ------------------------------------------------------------

//----------------------------------------------HOME TAB STARTS HERE ----------------------------------------------------------
ipcMain.handle("get-all-food-items", async () => {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT f.fid, f.fname, f.cost, f.veg, f.category 
            FROM FoodItem f 
            JOIN Category c ON f.category = c.catid
            WHERE f.active = 1 
            AND f.is_on = 1 
            AND c.active = 1;

        `;
        db.all(query, [], (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
});

//-0--------------------HOME TAB ENDS HERE--------------------------------------------------------------------------------

// Store for item order (you'll need to initialize this at the top)
const itemOrderStore = new Store({ name: 'item-order' });

// Get food items with custom order
ipcMain.handle("get-food-items-with-order", async (event, categoryName) => {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT f.fid, f.fname, f.cost, f.veg, f.category 
            FROM FoodItem f 
            JOIN Category c ON f.category = c.catid 
            WHERE c.catname = ? AND f.active = 1 AND f.is_on = 1
        `;
        
        db.all(query, [categoryName], (err, rows) => {
            if (err) {
                reject(err);
            } else {
                // Get custom order if exists
                const customOrder = itemOrderStore.get(categoryName, []);
                
                if (customOrder.length > 0) {
                    // Sort items according to custom order
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
                    
                    // Remove undefined slots and combine with unordered items
                    const filteredOrdered = orderedItems.filter(item => item !== undefined);
                    resolve([...filteredOrdered, ...unorderedItems]);
                } else {
                    resolve(rows);
                }
            }
        });
    });
});

// Save item order
ipcMain.handle("save-item-order", async (event, categoryName, itemOrder) => {
    return new Promise((resolve, reject) => {
        try {
            itemOrderStore.set(categoryName, itemOrder);
            resolve({ success: true });
        } catch (error) {
            reject(error);
        }
    });
});

// Reset item order
ipcMain.handle("reset-item-order", async (event, categoryName) => {
    return new Promise((resolve, reject) => {
        try {
            itemOrderStore.delete(categoryName);
            resolve({ success: true });
        } catch (error) {
            reject(error);
        }
    });
});

ipcMain.handle("get-food-items", async (event, categoryName) => {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT f.fid, f.fname, f.cost, f.veg, f.category 
            FROM FoodItem f 
            JOIN Category c ON f.category = c.catid 
            WHERE c.catname = ? AND f.active = 1 AND f.is_on = 1
        `;
        
        db.all(query, [categoryName], (err, rows) => {
            if (err) {
                reject(err);
            } else {
                // Get custom order if exists
                const customOrder = itemOrderStore.get(categoryName, []);
                
                if (customOrder.length > 0) {
                    // Sort items according to custom order
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
                    
                    // Remove undefined slots and combine with unordered items
                    const filteredOrdered = orderedItems.filter(item => item !== undefined);
                    resolve([...filteredOrdered, ...unorderedItems]);
                } else {
                    resolve(rows);
                }
            }
        });
    });
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
    // Close the database connection before quitting
      closeDatabase();
      // Clear Session Storage
      store.clear();
       app.quit(); // Close the app
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
        return {
            showHoldBill: parsed?.showHoldBill !== false,
        };
    } catch (err) {
        return {
            showHoldBill: true,
        };
    }
});

ipcMain.handle('save-ui-settings', async (event, settings) => {
    try {
        const dataPath = getFilePath('uiSettings.json');
        const nextSettings = {
            showHoldBill: settings?.showHoldBill !== false,
        };
        await fs.promises.writeFile(dataPath, JSON.stringify(nextSettings, null, 2), 'utf-8');
        return { success: true };
    } catch (err) {
        console.error('Failed to save UI settings:', err);
        return { success: false, message: err.message };
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
    db.serialize(() => {
      db.run(`CREATE TABLE IF NOT EXISTS Category (
        catid INTEGER PRIMARY KEY AUTOINCREMENT,
        catname TEXT NOT NULL,
        active INTEGER NOT NULL
      )`);
  
      db.run(`CREATE TABLE IF NOT EXISTS Customer (
        cid INTEGER PRIMARY KEY AUTOINCREMENT,
        cname TEXT NOT NULL,
        phone TEXT NOT NULL,
        address TEXT
      )`);
  
      db.run(`CREATE TABLE IF NOT EXISTS User (
        userid INTEGER PRIMARY KEY AUTOINCREMENT,
        uname TEXT NOT NULL,
        username TEXT NOT NULL,
                                email TEXT NOT NULL
      )`);
  
            db.run(`CREATE TABLE IF NOT EXISTS FoodItem (
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
      )`);
  
      db.run(`CREATE TABLE IF NOT EXISTS Orders (
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
      )`);
  
      db.run(`CREATE TABLE IF NOT EXISTS OrderDetails (
        orderid INTEGER NOT NULL,
        foodid INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        PRIMARY KEY(orderid, foodid),
        FOREIGN KEY (orderid) REFERENCES Orders(billno),
        FOREIGN KEY (foodid) REFERENCES FoodItem(fid)
      )`);
  
      db.run(`CREATE TABLE IF NOT EXISTS DiscountedOrders (
        billno INTEGER PRIMARY KEY,
        Initial_price NUMERIC NOT NULL,
        discount_percentage NUMERIC NOT NULL,
        discount_amount NUMERIC NOT NULL,
        FOREIGN KEY (billno) REFERENCES Orders(billno) ON DELETE CASCADE
      )`);
  
      db.run(`CREATE TABLE IF NOT EXISTS HeldOrders (
        heldid INTEGER PRIMARY KEY AUTOINCREMENT,
        price NUMERIC NOT NULL,
        sgst NUMERIC NOT NULL,
        cgst NUMERIC NOT NULL,
        tax NUMERIC NOT NULL,
        cashier INTEGER NOT NULL,
        FOREIGN KEY (cashier) REFERENCES User(userid)
      )`);
  
      db.run(`CREATE TABLE IF NOT EXISTS HeldOrderDetails (
        heldid INTEGER NOT NULL,
        foodid INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        PRIMARY KEY(heldid, foodid),
        FOREIGN KEY (heldid) REFERENCES HeldOrders(heldid),
        FOREIGN KEY (foodid) REFERENCES FoodItem(fid)
      )`);
  
      db.run(`CREATE TABLE IF NOT EXISTS DeletedOrders (
        billno INTEGER PRIMARY KEY,
        kot INTEGER NOT NULL,
        price NUMERIC NOT NULL,
        sgst NUMERIC NOT NULL,
        cgst NUMERIC NOT NULL,
        tax NUMERIC NOT NULL,
        cashier INTEGER NOT NULL,
        date TEXT NOT NULL,
        reason TEXT NOT NULL,
        is_offline INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (cashier) REFERENCES User(userid)
      )`);
  
            db.run(`CREATE TABLE IF NOT EXISTS DeletedOrderDetails (
        orderid INTEGER NOT NULL,
        foodid INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        PRIMARY KEY(orderid, foodid),
        FOREIGN KEY (orderid) REFERENCES DeletedOrders(billno),
        FOREIGN KEY (foodid) REFERENCES FoodItem(fid)
      )`);
  
            db.run(`DROP TABLE IF EXISTS OnlineOrderItems`);
            db.run(`DROP TABLE IF EXISTS OnlineOrders`);
                        db.run(`DROP TABLE IF EXISTS Inventory`);

                        db.run(`DROP TABLE IF EXISTS Miscellaneous`);

                        ensureUserTableSchema()
                            .then(() => getOrCreateCashierUser('cashier'))
                            .catch((schemaErr) => {
                            console.error("Error preparing local user schema:", schemaErr);
                        });

                db.all(`PRAGMA table_info(FoodItem)`, [], (err, columns) => {
                    if (err) {
                        console.error('Error inspecting FoodItem schema:', err);
                        return;
                    }

                    const hasLegacyDependInv = Array.isArray(columns) && columns.some((column) => column.name === 'depend_inv');
                    if (!hasLegacyDependInv) {
                        return;
                    }

                    db.serialize(() => {
                        db.run('PRAGMA foreign_keys = OFF');
                        db.run(`CREATE TABLE IF NOT EXISTS FoodItem_new (
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
                        )`);
                        db.run(`INSERT INTO FoodItem_new (fid, fname, category, cost, sgst, cgst, tax, active, is_on, veg)
                                        SELECT fid, fname, category, cost, sgst, cgst, tax, active, is_on, veg
                                        FROM FoodItem`);
                        db.run(`DROP TABLE FoodItem`);
                        db.run(`ALTER TABLE FoodItem_new RENAME TO FoodItem`);
                        db.run('PRAGMA foreign_keys = ON');
                    });
                });

      console.log("📦 Database schema ensured (tables created if missing).");
    });
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
            u.uname AS cashier_name,
            GROUP_CONCAT(fi.fname || ' (x' || od.quantity || ')', ', ') AS food_items
        FROM Orders o
        JOIN User u ON o.cashier = u.userid
        JOIN OrderDetails od ON o.billno = od.orderid
        JOIN FoodItem fi ON od.foodid = fi.fid
    `;

    const conditions = [];
    const params = [];

    // Bill No range
    if (filters.billNoFrom) {
        conditions.push("o.billno >= ?");
        params.push(parseInt(filters.billNoFrom));
    }
    if (filters.billNoTo) {
        conditions.push("o.billno <= ?");
        params.push(parseInt(filters.billNoTo));
    }

    // KOT range
    if (filters.kotFrom) {
        conditions.push("o.kot >= ?");
        params.push(parseInt(filters.kotFrom));
    }
    if (filters.kotTo) {
        conditions.push("o.kot <= ?");
        params.push(parseInt(filters.kotTo));
    }

    // Date range
    if (filters.startDate && filters.endDate) {
        conditions.push("o.date BETWEEN ? AND ?");
        params.push(filters.startDate, filters.endDate);
    }

    // Cashier
    if (filters.cashier) {
        conditions.push("o.cashier = ?");
        params.push(parseInt(filters.cashier));
    }

    // Price range
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

    db.all(query, params, (err, rows) => {
        if (err) {
            console.error(err);
            event.sender.send("search-orders-response", { orders: [] });
        } else {
            event.sender.send("search-orders-response", { orders: rows });
        }
    });
});

// Handle fetching all cashiers
ipcMain.on("get-all-cashiers", (event) => {
    db.all("SELECT userid, uname FROM User", [], (err, rows) => {
        if (err) {
            console.error(err);
            event.sender.send("all-cashiers-response", []);
        } else {
            event.sender.send("all-cashiers-response", rows);
        }
    });
});

//-------------------------------- Search Order (in History Section) Ends Here-------------------------------------

