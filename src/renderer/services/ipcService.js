const api = typeof window !== 'undefined' ? window.api : null;
const listenerMap = new Map();

function getChannelMap(channel) {
  if (!listenerMap.has(channel)) {
    listenerMap.set(channel, new Map());
  }
  return listenerMap.get(channel);
}

/**
 * IPC Service for bidirectional communication between React and Electron main process.
 * Uses the preload bridge (window.api) — context isolation safe.
 */
export const ipcService = {
  isAvailable: () => Boolean(api),

  send: (channel, ...args) => {
    if (!api) return;
    api.send(channel, ...args);
  },

  invoke: async (channel, ...args) => {
    if (!api) {
      throw new Error('IPC bridge is not available in this environment');
    }
    return await api.invoke(channel, ...args);
  },

  on: (channel, callback) => {
    if (!api) return;
    const wrapped = api.on(channel, callback);
    const channelMap = getChannelMap(channel);
    channelMap.set(callback, wrapped);
  },

  once: (channel, callback) => {
    if (!api) return;
    api.once(channel, callback);
  },

  removeListener: (channel, callback) => {
    if (!api) return;
    const channelMap = listenerMap.get(channel);
    const wrapper = channelMap?.get(callback);
    if (!wrapper) return;
    api.removeListener(channel, wrapper);
    channelMap.delete(callback);
  },

  requestReply: (sendChannel, replyChannel, payload, timeoutMs = 10000) => {
    if (!api) {
      return Promise.reject(new Error('IPC bridge is not available in this environment'));
    }

    return new Promise((resolve, reject) => {
      let timeoutId;
      let replyWrapper;

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        api.removeListener(replyChannel, replyWrapper || onReply);
      };

      const onReply = (data) => {
        cleanup();
        resolve(data);
      };

      timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for ${replyChannel}`));
      }, timeoutMs);

      replyWrapper = api.on(replyChannel, onReply);
      api.send(sendChannel, payload);
    });
  },
};

export default ipcService;
