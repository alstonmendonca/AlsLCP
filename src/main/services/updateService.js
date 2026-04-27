const { app } = require('electron');
const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const dns = require('dns');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

function checkNetworkConnectivity(timeoutMs = 3000) {
    return new Promise((resolve) => {
        dns.resolve('dns.google', (err) => {
            resolve(!err);
        });
        setTimeout(() => resolve(false), timeoutMs);
    });
}

function normalizeBaseUrl(projectUrl) {
  return String(projectUrl || '').trim().replace(/\/+$/, '');
}

function getDownloadFileName(updateInfo) {
  const fileName = String(updateInfo?.fileName || '').trim();
  if (fileName) return fileName;

  const version = String(updateInfo?.latestVersion || app.getVersion()).trim();
  return `ProperLCP-${version || 'update'}.exe`;
}

class UpdateService extends EventEmitter {
  constructor({ getSetupRow, getRemoteAuthConfig, getAppIdentity }) {
    super();
    this.getSetupRow = getSetupRow;
    this.getRemoteAuthConfig = getRemoteAuthConfig;
    this.getAppIdentity = getAppIdentity;
    this.state = {
      status: 'idle',
      updateAvailable: false,
      checking: false,
      downloading: false,
      canInstall: false,
      currentVersion: app.getVersion(),
      latestVersion: app.getVersion(),
      message: '',
      error: '',
      updateInfo: null,
      downloadedPath: null,
      lastCheckedAt: null,
      progress: 0,
    };
  }

  emitState(overrides = {}) {
    this.state = {
      ...this.state,
      ...overrides,
    };
    this.emit('status', this.getStatus());
    return this.state;
  }

  getStatus() {
    return {
      ...this.state,
      updateInfo: this.state.updateInfo
        ? { ...this.state.updateInfo }
        : null,
    };
  }

  async fetchUpdateInfo() {
    const online = await checkNetworkConnectivity();
    if (!online) {
      throw new Error('No internet connection. Please check your WiFi or network and try again.');
    }

    const setupRow = await this.getSetupRow?.();
    const remoteConfig = this.getRemoteAuthConfig?.(setupRow);
    const appIdentity = this.getAppIdentity?.();

    if (!setupRow || Number(setupRow?.is_initialized || 0) !== 1) {
      throw new Error('App setup is incomplete.');
    }

    if (!remoteConfig?.functionsBaseUrl || !remoteConfig?.anonKey) {
      throw new Error('Supabase update configuration is missing.');
    }

    const appInstanceId = String(appIdentity?.appInstanceId || '').trim();
    if (!appInstanceId) {
      throw new Error('App instance identity is unavailable.');
    }

    const payload = {
      tenantId: String(setupRow.tenant_id || '').trim(),
      appInstanceId,
      currentVersion: app.getVersion(),
      platform: String(appIdentity?.platform || process.platform).trim(),
      arch: String(appIdentity?.arch || process.arch).trim(),
      appVersion: String(appIdentity?.appVersion || app.getVersion()).trim(),
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    let response;
    try {
      response = await fetch(`${normalizeBaseUrl(remoteConfig.functionsBaseUrl)}/check-update`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${remoteConfig.anonKey}`,
          apikey: remoteConfig.anonKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (fetchErr) {
      if (fetchErr.name === 'AbortError') {
        throw new Error('Update check timed out after 15 seconds.');
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
      throw new Error(data?.message || 'Failed to check for updates.');
    }

    return data;
  }

  async checkForUpdates() {
    this.emitState({
      status: 'checking',
      checking: true,
      error: '',
      message: 'Checking for updates...',
      progress: 0,
    });

    try {
      const data = await this.fetchUpdateInfo();

      if (!data?.updateAvailable) {
        return this.emitState({
          status: 'idle',
          checking: false,
          updateAvailable: false,
          canInstall: false,
          updateInfo: null,
          downloadedPath: null,
          latestVersion: data?.latestVersion || app.getVersion(),
          message: data?.message || 'You are already on the latest version.',
          error: '',
          lastCheckedAt: new Date().toISOString(),
          progress: 0,
        });
      }

      return this.emitState({
        status: 'update-available',
        checking: false,
        updateAvailable: true,
        canInstall: false,
        updateInfo: data,
        downloadedPath: null,
        latestVersion: data.latestVersion || app.getVersion(),
        message: data.message || `Version ${data.latestVersion} is available.`,
        error: '',
        lastCheckedAt: new Date().toISOString(),
        progress: 0,
      });
    } catch (error) {
      const message = error?.message || 'Failed to check for updates.';
      this.emit('error', { message });
      return this.emitState({
        status: 'error',
        checking: false,
        error: message,
        message: '',
        progress: 0,
      });
    }
  }

  async downloadLatestUpdate() {
    const online = await checkNetworkConnectivity();
    if (!online) {
      throw new Error('No internet connection. Please check your WiFi or network and try again.');
    }

    const updateInfo = this.state.updateInfo;

    if (!updateInfo?.downloadUrl) {
      throw new Error('No downloadable update is available.');
    }

    const targetDir = path.join(app.getPath('temp'), 'ProperLCP-Updates');
    await fs.promises.mkdir(targetDir, { recursive: true });

    const fileName = getDownloadFileName(updateInfo);
    const targetPath = path.join(targetDir, fileName);

    this.emitState({
      status: 'downloading',
      downloading: true,
      canInstall: false,
      error: '',
      message: 'Downloading update...',
      progress: 0,
    });

    try {
      const response = await fetch(updateInfo.downloadUrl);
      if (!response.ok || !response.body) {
        throw new Error('Failed to download update artifact.');
      }

      const totalBytes = Number(response.headers.get('content-length') || updateInfo.fileSize || 0);
      let transferredBytes = 0;
      const writeStream = fs.createWriteStream(targetPath);
      const readable = Readable.fromWeb(response.body);

      await new Promise((resolve, reject) => {
        readable.on('data', (chunk) => {
          transferredBytes += chunk.length;
          const progress = totalBytes > 0 ? Math.min(100, Math.round((transferredBytes / totalBytes) * 100)) : 0;
          this.emit('progress', {
            status: 'downloading',
            progress,
            transferredBytes,
            totalBytes,
            downloadedPath: targetPath,
          });
        });

        readable.on('error', reject);
        writeStream.on('error', reject);
        writeStream.on('finish', resolve);

        readable.pipe(writeStream);
      });

      return this.emitState({
        status: 'downloaded',
        downloading: false,
        canInstall: true,
        downloadedPath: targetPath,
        progress: 100,
        message: 'Update downloaded. You can install it now.',
        error: '',
      });
    } catch (error) {
      const message = error?.message || 'Failed to download update artifact.';
      this.emit('error', { message });
      return this.emitState({
        status: 'error',
        downloading: false,
        canInstall: false,
        downloadedPath: null,
        message: '',
        error: message,
        progress: 0,
      });
    }
  }

  async installDownloadedUpdate() {
    const downloadedPath = this.state.downloadedPath;
    if (!downloadedPath || !fs.existsSync(downloadedPath)) {
      throw new Error('Download the update before installing it.');
    }

    try {
      if (process.platform === 'win32') {
        spawn(downloadedPath, [], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        }).unref();
      } else {
        spawn(downloadedPath, [], {
          detached: true,
          stdio: 'ignore',
        }).unref();
      }
    } catch (error) {
      const message = error?.message || 'Failed to launch installer.';
      this.emit('error', { message });
      return this.emitState({
        status: 'error',
        error: message,
        message: '',
      });
    }

    this.emitState({
      status: 'installing',
      message: 'Launching installer...',
      error: '',
    });

    app.quit();
    return { success: true };
  }
}

module.exports = UpdateService;
