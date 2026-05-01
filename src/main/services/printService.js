const fs = require('fs');
const escpos = require('escpos');
escpos.USB = require('escpos-usb');

const DEFAULT_PRINTER_CONFIG = {
  vendorId: '0x0525',
  productId: '0xA700',
};

function toHexId(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0) {
    return '';
  }
  return `0x${numeric.toString(16).padStart(4, '0').toUpperCase()}`;
}

function normalizeHexId(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }

  if (/^0x[0-9a-fA-F]{1,4}$/.test(text)) {
    const normalized = Number.parseInt(text, 16);
    return toHexId(normalized);
  }

  if (/^[0-9]{1,5}$/.test(text)) {
    return toHexId(Number.parseInt(text, 10));
  }

  return '';
}

function clampText(value, max = 42) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
}

function asPositiveNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

class PrintService {
  constructor() {
    this.store = null;
    this.fileManager = null;
    this.getAppSetupRow = null;
    this.device = null;
    this.printer = null;
    this.isPrinting = false;
    this.lastError = '';
    this.lastReceipt = null;
    this.lastJobAt = null;
  }

  configure({ store, fileManager, getAppSetupRow }) {
    this.store = store;
    this.fileManager = fileManager;
    this.getAppSetupRow = getAppSetupRow;
  }

  getStoredConfig() {
    const stored = this.store?.get('printerConfig', DEFAULT_PRINTER_CONFIG) || DEFAULT_PRINTER_CONFIG;
    return this.normalizeConfig(stored);
  }

  normalizeConfig(config) {
    const vendorId = normalizeHexId(config?.vendorId || DEFAULT_PRINTER_CONFIG.vendorId);
    const productId = normalizeHexId(config?.productId || DEFAULT_PRINTER_CONFIG.productId);

    if (!vendorId || !productId) {
      return null;
    }

    return {
      vendorId,
      productId,
      vendorIdDec: Number.parseInt(vendorId, 16),
      productIdDec: Number.parseInt(productId, 16),
    };
  }

  async init(config) {
    try {
      const normalized = this.normalizeConfig(config || this.getStoredConfig());
      if (!normalized) {
        throw new Error('Invalid printer configuration.');
      }

      this.device = new escpos.USB(normalized.vendorIdDec, normalized.productIdDec);
      this.printer = new escpos.Printer(this.device, { encoding: 'UTF-8' });
      this.lastError = '';

      return { success: true, config: normalized };
    } catch (error) {
      this.device = null;
      this.printer = null;
      this.lastError = error.message;
      return { success: false, error: error.message };
    }
  }

  async listPrinters() {
    try {
      const devices = escpos.USB.findPrinter() || [];
      const printers = devices.map((device, index) => {
        const descriptor = device?.deviceDescriptor || {};
        const vendorIdDec = Number(device?.vendorId ?? descriptor.idVendor);
        const productIdDec = Number(device?.productId ?? descriptor.idProduct);
        return {
          id: `${vendorIdDec}:${productIdDec}:${index}`,
          vendorId: toHexId(vendorIdDec),
          productId: toHexId(productIdDec),
          vendorIdDec,
          productIdDec,
        };
      }).filter((row) => row.vendorId && row.productId);

      return { success: true, printers };
    } catch (error) {
      this.lastError = error.message;
      return { success: false, error: error.message, printers: [] };
    }
  }

  async loadTemplate(defaults) {
    try {
      if (!this.fileManager) {
        return defaults;
      }

      // Fetch tenant info for defaults if available
      let tenantName = 'ALSPOS';
      let tenantLocation = '';
      if (this.getAppSetupRow) {
        try {
          const setupRow = await this.getAppSetupRow();
          if (setupRow?.tenant_name) tenantName = setupRow.tenant_name;
          if (setupRow?.tenant_location) tenantLocation = setupRow.tenant_location;
        } catch (_) {}
      }

      const dynamicDefaults = {
        ...defaults,
        title: defaults.title || tenantName,
        subtitle: defaults.subtitle || tenantLocation,
      };

      const raw = this.fileManager.readFromUserData('receiptFormat.json');
      if (!raw) {
        return dynamicDefaults;
      }
      const parsed = JSON.parse(raw);
      return { ...dynamicDefaults, ...parsed };
    } catch (_) {
      return defaults;
    }
  }

  sanitizeOrderPayload(order = {}) {
    const sourceItems = Array.isArray(order.items)
      ? order.items
      : (Array.isArray(order.billItems) ? order.billItems : []);

    const items = sourceItems
      .map((item) => ({
        name: clampText(item?.name || item?.foodName || item?.fname || 'Item', 24),
        qty: Math.max(1, Math.floor(asPositiveNumber(item?.qty ?? item?.quantity, 1))),
        price: asPositiveNumber(item?.price, 0),
      }))
      .filter((item) => item.name);

    const totalFromItems = items.reduce((sum, item) => sum + (item.qty * item.price), 0);

    return {
      shopName: clampText(order.shopName || '', 30),
      subtitle: clampText(order.subtitle || '', 30),
      footer: clampText(order.footer || 'Thank you for visiting!', 36),
      token: clampText(order.kot || order.token || '-', 12),
      billNo: clampText(order.orderId || order.billNo || '-', 20),
      dateTime: clampText(order.dateTime || new Date().toLocaleString('en-IN'), 40),
      items,
      total: asPositiveNumber(order.totalAmount, totalFromItems),
    };
  }

  async ensureReady(configOverride = null) {
    const config = configOverride ? this.normalizeConfig(configOverride) : this.getStoredConfig();
    if (!config) {
      return { success: false, error: 'Printer configuration is missing or invalid.' };
    }

    const initResult = await this.init(config);
    if (!initResult.success) {
      return initResult;
    }

    return { success: true, config };
  }

  executePrint(render) {
    if (this.isPrinting) {
      return Promise.resolve({ success: false, error: 'Printer busy' });
    }

    this.isPrinting = true;

    return new Promise((resolve) => {
      const done = (result) => {
        this.isPrinting = false;
        this.lastJobAt = new Date().toISOString();
        if (!result.success) {
          this.lastError = result.error || 'Unknown print error';
        } else {
          this.lastError = '';
        }
        resolve(result);
      };

      try {
        this.device.open((openError) => {
          if (openError) {
            done({ success: false, error: `Printer connection failed: ${openError.message}` });
            return;
          }

          try {
            render(this.printer);
            this.printer.cut().close((closeError) => {
              if (closeError) {
                done({ success: false, error: `Print failed: ${closeError.message}` });
                return;
              }

              done({ success: true });
            });
          } catch (renderError) {
            try {
              this.printer.close(() => {
                done({ success: false, error: renderError.message });
              });
            } catch (_) {
              done({ success: false, error: renderError.message });
            }
          }
        });
      } catch (error) {
        done({ success: false, error: error.message });
      }
    });
  }

  async printBill(order, configOverride = null) {
    const ready = await this.ensureReady(configOverride);
    if (!ready.success) {
      return ready;
    }

    const template = await this.loadTemplate({
      title: '',
      subtitle: '',
      footer: 'Thank you for visiting!',
      itemHeader: 'ITEM',
      qtyHeader: 'QTY',
      priceHeader: 'PRICE',
      totalText: 'TOTAL: Rs.',
    });

    const data = this.sanitizeOrderPayload(order);

    const result = await this.executePrint((printer) => {
      printer
        .align('CT')
        .style('B')
        .text(template.title || data.shopName)
        .style('NORMAL')
        .text(template.subtitle || data.subtitle)
        .text(`TOKEN: ${data.token}`)
        .align('LT')
        .text(`Date: ${data.dateTime}`)
        .text(`Bill #: ${data.billNo}`)
        .text('------------------------------------------')
        .style('B')
        .text(`${String(template.itemHeader || 'ITEM').padEnd(24)}${String(template.qtyHeader || 'QTY').padStart(6)}${String(template.priceHeader || 'PRICE').padStart(10)}`)
        .style('NORMAL');

      data.items.forEach((item) => {
        const amount = item.qty * item.price;
        printer.text(`${item.name.padEnd(24)}${String(item.qty).padStart(6)}${amount.toFixed(2).padStart(10)}`);
      });

      printer
        .text('------------------------------------------')
        .style('B')
        .text(`${String(template.totalText || 'TOTAL: Rs.').padStart(32)} ${data.total.toFixed(2)}`)
        .style('NORMAL')
        .align('CT')
        .text(template.footer || data.footer);
    });

    if (result.success) {
      this.lastReceipt = { kind: 'bill', payload: order };
    }

    return result;
  }

  async printKot(order, configOverride = null) {
    const ready = await this.ensureReady(configOverride);
    if (!ready.success) {
      return ready;
    }

    const template = await this.loadTemplate({
      kotItemHeader: 'ITEM',
      kotQtyHeader: 'QTY',
    });

    const data = this.sanitizeOrderPayload(order);

    const result = await this.executePrint((printer) => {
      printer
        .align('CT')
        .style('B')
        .size(1, 1)
        .text(String(data.token || '-'))
        .size(0, 0)
        .style('NORMAL')
        .align('LT')
        .text(`Time: ${new Date().toLocaleTimeString('en-IN')}`)
        .text('------------------------------------------')
        .style('B')
        .text(`${String(template.kotItemHeader || 'ITEM').padEnd(32)}${String(template.kotQtyHeader || 'QTY').padStart(10)}`)
        .style('NORMAL');

      data.items.forEach((item) => {
        printer.text(`${item.name.padEnd(32)}${String(item.qty).padStart(10)}`);
      });

      printer
        .text('------------------------------------------')
        .style('B')
        .text(`Total: Rs. ${data.total.toFixed(2)}`)
        .style('NORMAL');
    });

    if (result.success) {
      this.lastReceipt = { kind: 'kot', payload: order };
    }

    return result;
  }

  async testPrint(configOverride = null) {
    const ready = await this.ensureReady(configOverride);
    if (!ready.success) {
      return ready;
    }

    return this.executePrint((printer) => {
      printer
        .align('CT')
        .style('B')
        .text('TEST PRINT')
        .style('NORMAL')
        .text('----------------')
        .text('Printer is working')
        .text(new Date().toLocaleString('en-IN'));
    });
  }

  async safePrint(kind, payload, retries = 2, configOverride = null) {
    const maxRetries = Math.max(0, Math.floor(Number(retries) || 0));
    let attempt = 0;
    let lastResult = { success: false, error: 'Print not attempted' };

    while (attempt <= maxRetries) {
      if (kind === 'kot') {
        lastResult = await this.printKot(payload, configOverride);
      } else {
        lastResult = await this.printBill(payload, configOverride);
      }

      if (lastResult.success || lastResult.error === 'Printer busy') {
        return { ...lastResult, attempt: attempt + 1 };
      }

      attempt += 1;
    }

    return { success: false, error: `Failed after ${maxRetries + 1} attempts: ${lastResult.error || 'unknown error'}`, attempt: maxRetries + 1 };
  }

  async reprintLast(retries = 1) {
    if (!this.lastReceipt) {
      return { success: false, error: 'No receipt available to reprint.' };
    }

    return this.safePrint(this.lastReceipt.kind, this.lastReceipt.payload, retries);
  }

  getStatus() {
    return {
      connected: Boolean(this.device && this.printer),
      busy: this.isPrinting,
      hasLastReceipt: Boolean(this.lastReceipt),
      lastJobAt: this.lastJobAt,
      lastError: this.lastError,
    };
  }
}

module.exports = new PrintService();
