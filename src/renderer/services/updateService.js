import ipcService from '@/services/ipcService';

const listeners = new Set();

function emit(payload) {
  for (const listener of listeners) {
    try {
      listener(payload);
    } catch (error) {
      console.error('Update listener failed:', error);
    }
  }
}

ipcService.on('update-status', (payload) => emit({ type: 'status', payload }));
ipcService.on('update-progress', (payload) => emit({ type: 'progress', payload }));
ipcService.on('update-error', (payload) => emit({ type: 'error', payload }));

export const updateService = {
  subscribe(listener) {
    if (typeof listener !== 'function') {
      return () => {};
    }

    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  async getStatus() {
    return await ipcService.invoke('get-update-status');
  },

  async getSubscriptionStatus() {
    return await ipcService.invoke('get-subscription-status');
  },

  async checkForUpdates() {
    return await ipcService.invoke('check-for-updates');
  },

  async downloadUpdate() {
    return await ipcService.invoke('download-update');
  },

  async installUpdate() {
    return await ipcService.invoke('install-update');
  },
};

export default updateService;
