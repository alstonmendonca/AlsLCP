const electron = typeof window !== 'undefined' && window.require
  ? window.require('electron')
  : null;

const ipcRenderer = electron?.ipcRenderer || null;

/**
 * IPC Service for bidirectional communication between React and Electron main process
 */
export const ipcService = {
  isAvailable: () => Boolean(ipcRenderer),

  // Send message to main process without expecting response
  send: (channel, ...args) => {
    if (!ipcRenderer) return;
    ipcRenderer.send(channel, ...args);
  },

  // Send message and expect response
  invoke: async (channel, ...args) => {
    if (!ipcRenderer) {
      throw new Error('ipcRenderer is not available in this environment');
    }
    return await ipcRenderer.invoke(channel, ...args);
  },

  // Listen for messages from main process
  on: (channel, callback) => {
    if (!ipcRenderer) return;
    ipcRenderer.on(channel, (event, ...args) => {
      callback(...args);
    });
  },

  // One-time listener
  once: (channel, callback) => {
    if (!ipcRenderer) return;
    ipcRenderer.once(channel, (event, ...args) => {
      callback(...args);
    });
  },

  // Remove listener
  removeListener: (channel, callback) => {
    if (!ipcRenderer) return;
    ipcRenderer.removeListener(channel, callback);
  },
};

export default ipcService;
