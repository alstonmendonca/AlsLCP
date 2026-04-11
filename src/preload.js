const { contextBridge, ipcRenderer } = require('electron');

const allowedInvokeChannels = new Set([
  'login',
  'get-session-user',
  'logout',
  'get-food-items',
  'get-all-food-items',
  'load-ui-settings',
  'load-business-info',
  'get-categories',
  'get-menu-items',
  'get-categories-for-additem',
  'add-food-item',
  'update-food-item',
  'delete-menu-item',
  'get-printer-config',
  'save-printer-config',
  'get-todays-revenue',
  'get-todays-sales',
  'get-todays-tax',
  'get-todays-discounted-orders',
  'get-todays-deleted-orders',
  'get-yesterdays-revenue',
  'get-most-sold-items',
  'get-most-sold-categories',
  'get-highest-revenue-items',
  'get-highest-revenue-category',
  'get-sales-overview-data',
  'get-category-wise-sales-data',
  'save-ui-settings',
  'edit-user-profile',
  'change-user-password',
  'show-save-dialog',
]);

const allowedSendChannels = new Set([
  'save-bill',
  'hold-bill',
  'print-bill-only',
  'print-kot-only',
  'exit-app',
  'get-all-cashiers',
  'backup-database-local',
  'restore-database-local',
  'save-business-info',
  'get-categories-event',
  'get-order-history',
  'get-customers',
  'add-customer',
  'update-customer',
  'delete-customer',
  'get-discounted-orders',
  'get-top-selling-items',
  'get-top-selling-categories',
  'get-item-summary',
  'get-employee-analysis',
  'get-best-in-category',
  'get-tax-on-items',
  'search-orders',
  'get-order-details',
  'get-todays-orders',
  'get-deleted-orders',
  'clear-discounted-orders',
  'clear-deleted-orders',
]);

const allowedReceiveChannels = new Set([
  'bill-saved',
  'bill-held',
  'bill-error',
  'print-success-with-data',
  'print-success',
  'print-kot-success',
  'print-error',
  'all-cashiers-response',
  'backup-local-completed',
  'restore-local-completed',
  'save-business-info-response',
  'categories-response',
  'order-history-response',
  'customers-response',
  'customer-added-response',
  'update-customer-response',
  'customer-delete-response',
  'order-details-response',
  'todays-orders-response',
  'discounted-orders-response',
  'deleted-orders-response',
  'clear-discounted-orders-response',
  'clear-deleted-orders-response',
  'top-selling-items-response',
  'top-selling-categories-response',
  'item-summary-response',
  'employee-analysis-response',
  'best-in-category-response',
  'tax-on-items-response',
  'search-orders-response',
]);

function isAllowedChannel(channel, allowedSet, mode) {
  if (typeof channel !== 'string' || !allowedSet.has(channel)) {
    console.warn(`[preload] Blocked IPC ${mode} on channel: ${String(channel)}`);
    return false;
  }
  return true;
}

contextBridge.exposeInMainWorld('api', {
  // Send a message to main process (fire-and-forget)
  send: (channel, ...args) => {
    if (!isAllowedChannel(channel, allowedSendChannels, 'send')) {
      return false;
    }
    ipcRenderer.send(channel, ...args);
    return true;
  },

  // Invoke a handler and await the result
  invoke: (channel, ...args) => {
    if (!isAllowedChannel(channel, allowedInvokeChannels, 'invoke')) {
      return Promise.reject(new Error(`Blocked IPC invoke channel: ${String(channel)}`));
    }
    return ipcRenderer.invoke(channel, ...args);
  },

  // Listen for a message from main process
  on: (channel, callback) => {
    if (!isAllowedChannel(channel, allowedReceiveChannels, 'on')) {
      return null;
    }
    if (typeof callback !== 'function') {
      return null;
    }
    const wrapped = (_event, ...args) => callback(...args);
    ipcRenderer.on(channel, wrapped);
    return wrapped;
  },

  // Listen once
  once: (channel, callback) => {
    if (!isAllowedChannel(channel, allowedReceiveChannels, 'once')) {
      return;
    }
    if (typeof callback !== 'function') {
      return;
    }
    ipcRenderer.once(channel, (_event, ...args) => callback(...args));
  },

  // Remove a listener
  removeListener: (channel, wrapper) => {
    if (!isAllowedChannel(channel, allowedReceiveChannels, 'removeListener')) {
      return;
    }
    ipcRenderer.removeListener(channel, wrapper);
  },
});
