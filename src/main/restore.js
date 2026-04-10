const { app } = require('electron');
const fs = require('fs');
const path = require('path');

async function restoreLCdbLocal(sourceDbPath) {
    try {
        await app.whenReady();
        
        // Get the destination database path
        const userDataPath = app.getPath('userData');
        const destDbPath = path.join(userDataPath, 'LC.db');

        console.log(`🔄 Restoring database from: ${sourceDbPath}`);
        console.log(`📁 Restoring to: ${destDbPath}`);
        
        if (!fs.existsSync(sourceDbPath)) {
            throw new Error(`Source database file not found at: ${sourceDbPath}`);
        }

        // Ensure the destination directory exists
        const destDir = path.dirname(destDbPath);
        if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
        }

        // Create a backup of the current database (just in case)
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(destDir, `LC_backup_${timestamp}.db`);
        
        if (fs.existsSync(destDbPath)) {
            await fs.promises.copyFile(destDbPath, backupPath);
            console.log(`📋 Current database backed up to: ${backupPath}`);
        }

        // Copy the source database to destination
        await fs.promises.copyFile(sourceDbPath, destDbPath);

        console.log(`✅ Local database restored successfully from: ${sourceDbPath}`);
        return true;
    } catch (error) {
        console.error('❌ Local restore failed:', error);
        return false;
    }
}

module.exports = { restoreLCdbLocal };
