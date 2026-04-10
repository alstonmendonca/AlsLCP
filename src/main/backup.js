const { app } = require('electron');
const fs = require('fs');
const path = require('path');
async function backupLCdbLocal(destinationPath) {
  try {
    await app.whenReady();

    // Get the source database path
    const userDataPath = app.getPath('userData');
    const sourceDbPath = path.join(userDataPath, 'LC.db');

    console.log(`🔄 Backing up database from: ${sourceDbPath}`);
    console.log(`📁 Saving to: ${destinationPath}`);
    
    if (!fs.existsSync(sourceDbPath)) {
      throw new Error(`Database file not found at: ${sourceDbPath}`);
    }

    // Ensure the destination directory exists
    const destDir = path.dirname(destinationPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    // Copy the database file
    await fs.promises.copyFile(sourceDbPath, destinationPath);

    console.log(`✅ Local backup saved successfully to: ${destinationPath}`);
    return true;
  } catch (error) {
    console.error('❌ Local backup failed:', error);
    return false;
  }
}

module.exports = {
  backupLCdbLocal,
};
