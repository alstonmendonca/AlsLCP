const { app } = require('electron');
const fs = require('fs');
const path = require('path');

function getSeedPath(filename) {
    if (app.isPackaged) {
        return path.join(__dirname, '..', '..', 'resources', filename);
    }
    return path.join(__dirname, '..', 'resources', filename);
}

function getUserDataPath(filename) {
    return path.join(app.getPath('userData'), filename);
}

function ensureSeedFileSync(filename) {
    const userDataPath = getUserDataPath(filename);
    if (fs.existsSync(userDataPath)) {
        return userDataPath;
    }

    const userDataDir = path.dirname(userDataPath);
    if (!fs.existsSync(userDataDir)) {
        fs.mkdirSync(userDataDir, { recursive: true });
    }

    const seedPath = getSeedPath(filename);
    if (fs.existsSync(seedPath)) {
        fs.copyFileSync(seedPath, userDataPath);
        console.log(`[fileManager] Seed "${filename}" copied to userData.`);
    } else {
        console.warn(`[fileManager] No seed found for "${filename}".`);
    }

    return userDataPath;
}

function readWithSeedFallback(filename) {
    const userDataPath = getUserDataPath(filename);
    if (fs.existsSync(userDataPath)) {
        return fs.readFileSync(userDataPath, 'utf-8');
    }

    const seedPath = getSeedPath(filename);
    if (fs.existsSync(seedPath)) {
        return fs.readFileSync(seedPath, 'utf-8');
    }

    return null;
}

function writeToUserData(filename, data) {
    const userDataPath = getUserDataPath(filename);
    const dir = path.dirname(userDataPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(userDataPath, data, 'utf-8');
    return userDataPath;
}

function getDatabasePath() {
    return ensureSeedFileSync('LC.db');
}

module.exports = {
    getSeedPath,
    getUserDataPath,
    ensureSeedFileSync,
    readWithSeedFallback,
    writeToUserData,
    getDatabasePath,
};
