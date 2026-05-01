const { app } = require('electron');
const fs = require('fs');
const path = require('path');

function getUserDataPath(filename) {
    return path.join(app.getPath('userData'), filename);
}

function readFromUserData(filename) {
    const userDataPath = getUserDataPath(filename);
    if (fs.existsSync(userDataPath)) {
        return fs.readFileSync(userDataPath, 'utf-8');
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

module.exports = {
    getUserDataPath,
    readFromUserData,
    writeToUserData,
};
