import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import ipcService from '@/services/ipcService';

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function localDateTimeString(date = new Date()) {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  const time = date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return `${day}-${month}-${year} ${time}`;
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
  }).format(Number(value || 0));
}

const BILL_TIMEOUT_MS = 15000;
const BILLING_DRAFT_KEY = 'billingDraft:v1';

function formatTableLabel(table) {
  if (!table) return 'No table selected';
  const tableNumber = String(table.tableNumber || '').trim();
  const tableName = String(table.tableName || '').trim();
  if (tableNumber && tableName) {
    return `Table ${tableNumber} - ${tableName}`;
  }
  if (tableNumber) {
    return `Table ${tableNumber}`;
  }
  if (tableName) {
    return tableName;
  }
  return 'No table selected';
}

function TableSelectionModal({
  open,
  tables,
  selectedTable,
  loading,
  busy,
  form,
  setForm,
  onClose,
  onSelect,
  onSave,
  onEdit,
  onDelete,
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="surface-card rounded-2xl w-full max-w-3xl max-h-[85vh] overflow-y-auto p-5 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-black text-on-light">Select Table</h3>
            <p className="text-sm text-muted mt-1">Assign this bill to a table and manage your table list.</p>
          </div>
          <Button type="button" variant="secondary" onClick={onClose}>Close</Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <section className="rounded-xl border border-on-light p-3 space-y-3">
            <h4 className="text-sm font-bold text-on-light">Available Tables</h4>
            {loading ? <p className="text-sm text-muted">Loading tables...</p> : null}
            {!loading && tables.length === 0 ? <p className="text-sm text-muted">No tables found.</p> : null}
            <div className="space-y-2 max-h-[340px] overflow-auto pr-1">
              {tables.map((table) => {
                const isActive = Number(selectedTable?.tableId) === Number(table.tableId);
                return (
                  <div key={table.tableId} className="rounded-lg border border-on-light p-2 space-y-2">
                    <button
                      type="button"
                      className="w-full text-left"
                      onClick={() => onSelect(table)}
                    >
                      <p className="text-sm font-semibold text-on-light">{formatTableLabel(table)}</p>
                      {isActive ? <p className="text-xs text-success mt-1">Selected</p> : null}
                    </button>
                    <div className="flex gap-2">
                      <Button type="button" size="sm" variant="secondary" onClick={() => onEdit(table)} disabled={busy}>Edit</Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => onDelete(table)} disabled={busy}>Delete</Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-xl border border-on-light p-3 space-y-3">
            <h4 className="text-sm font-bold text-on-light">Edit Tables</h4>
            <div>
              <label className="text-xs uppercase text-muted mb-1 block">Table Number</label>
              <input
                value={form.tableNumber}
                onChange={(e) => setForm((prev) => ({ ...prev, tableNumber: e.target.value }))}
                className="surface-input h-10 w-full rounded-lg px-3"
                placeholder="1"
              />
            </div>
            <div>
              <label className="text-xs uppercase text-muted mb-1 block">Table Name</label>
              <input
                value={form.tableName}
                onChange={(e) => setForm((prev) => ({ ...prev, tableName: e.target.value }))}
                className="surface-input h-10 w-full rounded-lg px-3"
                placeholder="Window / Patio / Family"
              />
            </div>
            <div className="flex gap-2">
              <Button type="button" onClick={onSave} disabled={busy}>
                {form.tableId ? 'Update Table' : 'Add Table'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setForm({ tableId: null, tableNumber: '', tableName: '' })}
                disabled={busy}
              >
                Clear
              </Button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default function BillingPage({ user }) {
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [menuItems, setMenuItems] = useState([]);
  const [allItems, setAllItems] = useState([]);
  const [itemSearch, setItemSearch] = useState('');
  const [cart, setCart] = useState([]);
  const [discountPercent, setDiscountPercent] = useState('');
  const [discountAmount, setDiscountAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingAllItems, setLoadingAllItems] = useState(false);
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [showHoldBill, setShowHoldBill] = useState(true);
  const [usePrinter, setUsePrinter] = useState(true);
  const [autoPrintBillOnSave, setAutoPrintBillOnSave] = useState(false);
  const [autoPrintKotOnSave, setAutoPrintKotOnSave] = useState(false);
  const [printerHealth, setPrinterHealth] = useState({ state: 'disabled', message: 'Disabled' });
  const [enableTableSelection, setEnableTableSelection] = useState(false);
  const [lastBill, setLastBill] = useState(null);
  const [tables, setTables] = useState([]);
  const [selectedTable, setSelectedTable] = useState(null);
  const [tableModalOpen, setTableModalOpen] = useState(false);
  const [tableLoading, setTableLoading] = useState(false);
  const [tableBusy, setTableBusy] = useState(false);
  const [tableForm, setTableForm] = useState({ tableId: null, tableNumber: '', tableName: '' });
  const mountedRef = useRef(true);
  const billTimerRef = useRef(null);
  const draftLoadedRef = useRef(false);
  const pendingSavedBillRef = useRef(null);
  const autoPrintBillOnSaveRef = useRef(false);
  const autoPrintKotOnSaveRef = useRef(false);
  const usePrinterRef = useRef(true);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(BILLING_DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw);
        if (Array.isArray(draft?.cart)) setCart(draft.cart);
        if (typeof draft?.discountPercent === 'string') setDiscountPercent(draft.discountPercent);
        if (typeof draft?.discountAmount === 'string') setDiscountAmount(draft.discountAmount);
        if (typeof draft?.itemSearch === 'string') setItemSearch(draft.itemSearch);
        if (typeof draft?.selectedCategory === 'string') setSelectedCategory(draft.selectedCategory);
        if (draft?.selectedTable && typeof draft.selectedTable === 'object') {
          setSelectedTable(draft.selectedTable);
        }
      }
    } catch (err) {
      console.error('Failed to restore billing draft:', err);
    } finally {
      draftLoadedRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (!draftLoadedRef.current) return;
    try {
      sessionStorage.setItem(
        BILLING_DRAFT_KEY,
        JSON.stringify({
          cart,
          discountPercent,
          discountAmount,
          itemSearch,
          selectedCategory,
          selectedTable,
        })
      );
    } catch (err) {
      console.error('Failed to persist billing draft:', err);
    }
  }, [cart, discountPercent, discountAmount, itemSearch, selectedCategory, selectedTable]);

  const loadCategories = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await ipcService.requestReply('get-categories-event', 'categories-response', undefined);
      if (!mountedRef.current) return;
      const safeCategories = Array.isArray(result?.categories) ? result.categories : [];
      setCategories(safeCategories);
      setSelectedCategory((prev) => {
        if (prev && safeCategories.some((category) => category.catname === prev)) {
          return prev;
        }
        return safeCategories[0]?.catname ?? '';
      });
    } catch (fetchError) {
      console.error('Failed loading categories:', fetchError);
      if (mountedRef.current) setError('Could not load categories.');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  const loadItems = async (categoryName) => {
    if (!categoryName) {
      setMenuItems([]);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const items = await ipcService.invoke('get-food-items', categoryName);
      if (!mountedRef.current) return;
      setMenuItems(Array.isArray(items) ? items : []);
    } catch (fetchError) {
      console.error('Failed loading food items:', fetchError);
      if (mountedRef.current) {
        setError('Could not load food items for selected category.');
        setMenuItems([]);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  const loadAllItems = async () => {
    if (allItems.length > 0) return;

    setLoadingAllItems(true);
    setError('');
    try {
      const items = await ipcService.invoke('get-all-food-items');
      if (!mountedRef.current) return;
      setAllItems(Array.isArray(items) ? items : []);
    } catch (fetchError) {
      console.error('Failed loading all food items:', fetchError);
      if (mountedRef.current) {
        setError('Could not load items for search.');
        setAllItems([]);
      }
    } finally {
      if (mountedRef.current) setLoadingAllItems(false);
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    loadCategories();
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const handleCategoriesUpdated = () => {
      loadCategories();
    };

    const wrapped = ipcService.on('categories-updated', handleCategoriesUpdated);
    return () => {
      if (wrapped) {
        ipcService.removeListener('categories-updated', handleCategoriesUpdated);
      }
    };
  }, []);

  useEffect(() => {
    let active = true;
    const loadUiSettings = async () => {
      try {
        const settings = await ipcService.invoke('load-ui-settings');
        if (!active) return;
        setShowHoldBill(settings?.showHoldBill !== false);
        setUsePrinter(settings?.usePrinter !== false);
        setAutoPrintBillOnSave(settings?.autoPrintBillOnSave === true);
        setAutoPrintKotOnSave(settings?.autoPrintKotOnSave === true);
        setEnableTableSelection(settings?.enableTableSelection === true);
      } catch (err) {
        if (active) {
          setShowHoldBill(true);
          setUsePrinter(true);
          setAutoPrintBillOnSave(false);
          setAutoPrintKotOnSave(false);
          setEnableTableSelection(false);
        }
      }
    };
    loadUiSettings();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    autoPrintBillOnSaveRef.current = autoPrintBillOnSave;
    autoPrintKotOnSaveRef.current = autoPrintKotOnSave;
  }, [autoPrintBillOnSave, autoPrintKotOnSave]);

  useEffect(() => {
    usePrinterRef.current = usePrinter;
  }, [usePrinter]);

  useEffect(() => {
    let active = true;
    let intervalId = null;

    const refresh = async () => {
      if (!usePrinter) {
        if (active) setPrinterHealth({ state: 'disabled', message: 'Disabled' });
        return;
      }

      try {
        const status = await ipcService.invoke('printer:status');
        if (!active) return;

        if (status?.busy) {
          setPrinterHealth({ state: 'busy', message: 'Busy' });
          return;
        }

        if (status?.connected) {
          setPrinterHealth({ state: 'ready', message: 'Ready' });
          return;
        }

        setPrinterHealth({ state: 'error', message: status?.lastError ? `Error: ${status.lastError}` : 'Error' });
      } catch (_) {
        if (active) setPrinterHealth({ state: 'error', message: 'Error' });
      }
    };

    refresh();
    if (usePrinter) {
      intervalId = setInterval(refresh, 3000);
    }

    return () => {
      active = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, [usePrinter]);

  const loadBillingTables = async () => {
    setTableLoading(true);
    try {
      const result = await ipcService.invoke('get-billing-tables');
      if (!result?.success) {
        setError(result?.message || 'Could not load tables.');
        setTables([]);
        return;
      }

      const nextTables = Array.isArray(result.tables) ? result.tables : [];
      setTables(nextTables);
      setSelectedTable((previous) => {
        if (!previous?.tableId) return previous;
        const latest = nextTables.find((table) => Number(table.tableId) === Number(previous.tableId));
        return latest || null;
      });
    } catch (err) {
      console.error('Failed to load billing tables:', err);
      setError('Could not load tables.');
      setTables([]);
    } finally {
      setTableLoading(false);
    }
  };

  useEffect(() => {
    if (!enableTableSelection) {
      setTableModalOpen(false);
      return;
    }
    loadBillingTables();
  }, [enableTableSelection]);

  const openTableModal = async () => {
    setError('');
    setMessage('');
    setTableModalOpen(true);
    await loadBillingTables();
  };

  const saveTable = async () => {
    const tableNumber = String(tableForm.tableNumber || '').trim();
    const tableName = String(tableForm.tableName || '').trim();
    if (!tableNumber || !tableName) {
      setError('Table name and number are required.');
      return;
    }

    setTableBusy(true);
    setError('');
    setMessage('');
    try {
      const channel = tableForm.tableId ? 'update-billing-table' : 'create-billing-table';
      const payload = tableForm.tableId
        ? { tableId: tableForm.tableId, tableName, tableNumber }
        : { tableName, tableNumber };
      const result = await ipcService.invoke(channel, payload);
      if (!result?.success) {
        setError(result?.message || 'Could not save table.');
        return;
      }

      setTableForm({ tableId: null, tableNumber: '', tableName: '' });
      setMessage(tableForm.tableId ? 'Table updated.' : 'Table created.');
      await loadBillingTables();
    } catch (err) {
      console.error('Failed to save table:', err);
      setError('Could not save table.');
    } finally {
      setTableBusy(false);
    }
  };

  const deleteTable = async (table) => {
    const ok = window.confirm(`Delete ${formatTableLabel(table)}?`);
    if (!ok) return;

    setTableBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await ipcService.invoke('delete-billing-table', { tableId: table.tableId });
      if (!result?.success) {
        setError(result?.message || 'Could not delete table.');
        return;
      }

      if (Number(selectedTable?.tableId) === Number(table.tableId)) {
        setSelectedTable(null);
      }

      setMessage('Table deleted.');
      await loadBillingTables();
    } catch (err) {
      console.error('Failed to delete table:', err);
      setError('Could not delete table.');
    } finally {
      setTableBusy(false);
    }
  };

  const sendBillPrint = async (billData, retries = 2) => {
    if (!usePrinterRef.current) return { success: false, error: 'Printer is disabled in Settings > Feature Toggles.' };
    if (!billData) return { success: false, error: 'No bill available to print.' };
    return ipcService.invoke('printer:print-bill', {
      billItems: billData.items.map((l) => ({ foodId: l.foodId, foodName: l.name, price: l.price, quantity: l.quantity })),
      totalAmount: billData.amount,
      kot: billData.kot,
      orderId: billData.orderId,
      dateTime: localDateTimeString(),
      retries,
    });
  };

  const sendKotPrint = async (billData, retries = 2) => {
    if (!usePrinterRef.current) return { success: false, error: 'Printer is disabled in Settings > Feature Toggles.' };
    if (!billData) return { success: false, error: 'No bill available to print.' };
    return ipcService.invoke('printer:print-kot', {
      billItems: billData.items.map((l) => ({ foodId: l.foodId, foodName: l.name, price: l.price, quantity: l.quantity })),
      totalAmount: billData.amount,
      kot: billData.kot,
      orderId: billData.orderId,
      retries,
    });
  };

  useEffect(() => {
    if (!selectedCategory) return;
    loadItems(selectedCategory);
  }, [selectedCategory]);

  useEffect(() => {
    if (itemSearch.trim()) {
      loadAllItems();
    }
  }, [itemSearch]);

  useEffect(() => {
    const onSaved = async (payload) => {
      if (billTimerRef.current) { clearTimeout(billTimerRef.current); billTimerRef.current = null; }
      setSaving(false);
      setMessage(`Bill saved. KOT ${payload?.kot ?? '-'} | Order ${payload?.orderId ?? '-'}`);

      const billSnapshot = pendingSavedBillRef.current || {
        items: [],
        amount: 0,
      };

      const savedBill = {
        kot: payload?.kot,
        orderId: payload?.orderId,
        items: Array.isArray(billSnapshot.items) ? billSnapshot.items : [],
        amount: Number(billSnapshot.amount || 0),
      };

      setLastBill(savedBill);

      if (usePrinterRef.current && (autoPrintBillOnSaveRef.current || autoPrintKotOnSaveRef.current)) {
        setPrinting(true);
        try {
          const printJobs = [];
          if (autoPrintBillOnSaveRef.current) {
            printJobs.push(sendBillPrint(savedBill));
          }
          if (autoPrintKotOnSaveRef.current) {
            printJobs.push(sendKotPrint(savedBill));
          }

          const results = await Promise.all(printJobs);
          const failed = results.find((result) => !result?.success);
          if (failed) {
            setError(failed?.error || 'Auto print failed.');
          } else {
            setMessage((prev) => `${prev} Print completed.`);
          }
        } catch (printError) {
          console.error('Auto print failed:', printError);
          setError('Auto print failed.');
        } finally {
          setPrinting(false);
        }
      }

      pendingSavedBillRef.current = null;
      setCart([]);
      setDiscountAmount('');
      setDiscountPercent('');
    };

    const onHeld = () => {
      if (billTimerRef.current) { clearTimeout(billTimerRef.current); billTimerRef.current = null; }
      setSaving(false);
      setMessage('Bill held successfully.');
      setLastBill(null);
      setCart([]);
      setDiscountAmount('');
      setDiscountPercent('');
    };

    const onError = (payload) => {
      if (billTimerRef.current) { clearTimeout(billTimerRef.current); billTimerRef.current = null; }
      setSaving(false);
      setError(payload?.error || 'Billing action failed.');
    };

    ipcService.on('bill-saved', onSaved);
    ipcService.on('bill-held', onHeld);
    ipcService.on('bill-error', onError);

    return () => {
      ipcService.removeListener('bill-saved', onSaved);
      ipcService.removeListener('bill-held', onHeld);
      ipcService.removeListener('bill-error', onError);
    };
  }, []);

  const addToCart = (item) => {
    setMessage('');
    setError('');
    setCart((prev) => {
      const existing = prev.find((line) => line.foodId === item.fid);
      if (existing) {
        return prev.map((line) =>
          line.foodId === item.fid
            ? { ...line, quantity: line.quantity + 1 }
            : line
        );
      }
      return [
        ...prev,
        {
          foodId: item.fid,
          name: item.fname ?? 'Unknown',
          price: Number(item.cost ?? 0),
          quantity: 1,
        },
      ];
    });
  };

  const setQuantity = (foodId, qty) => {
    const quantity = Math.max(1, Number(qty) || 1);
    setCart((prev) => prev.map((line) => (line.foodId === foodId ? { ...line, quantity } : line)));
  };

  const removeLine = (foodId) => {
    setCart((prev) => prev.filter((line) => line.foodId !== foodId));
  };

  const subtotal = useMemo(() => {
    return cart.reduce((acc, line) => acc + line.price * line.quantity, 0);
  }, [cart]);

  const filteredMenuItems = useMemo(() => {
    const sourceItems = itemSearch.trim() ? allItems : menuItems;
    const query = itemSearch.trim().toLowerCase();
    if (!query) return sourceItems;
    return sourceItems.filter((item) =>
      String(item?.fid ?? '').includes(query) ||
      (item?.fname ?? '').toLowerCase().includes(query)
    );
  }, [menuItems, allItems, itemSearch]);

  const computedDiscount = useMemo(() => {
    const pct = Number(discountPercent || 0);
    const amt = Number(discountAmount || 0);
    if (pct > 0 && amt > 0) {
      return { value: 0, invalid: true, reason: 'Use either percentage or amount, not both.' };
    }
    if (pct < 0 || amt < 0) {
      return { value: 0, invalid: true, reason: 'Discount cannot be negative.' };
    }
    if (pct > 0) {
      return { value: (subtotal * pct) / 100, invalid: false, reason: '' };
    }
    if (amt > subtotal) {
      return { value: 0, invalid: true, reason: 'Discount amount cannot exceed subtotal.' };
    }
    return { value: amt, invalid: false, reason: '' };
  }, [discountPercent, discountAmount, subtotal]);

  const finalTotal = useMemo(() => {
    return Math.max(0, subtotal - computedDiscount.value);
  }, [subtotal, computedDiscount.value]);

  const toOrderItems = () => cart.map((line) => ({ foodId: line.foodId, quantity: line.quantity }));

  const saveBill = () => {
    if (cart.length === 0) {
      setError('Add at least one item to save bill.');
      return;
    }
    if (computedDiscount.invalid) {
      setError(computedDiscount.reason);
      return;
    }
    if (!user?.userid) {
      setError('No active cashier session found.');
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');

    pendingSavedBillRef.current = {
      items: [...cart],
      amount: finalTotal,
    };

    ipcService.send('save-bill', {
      cashier: user.userid,
      date: localDateString(),
      orderItems: toOrderItems(),
      totalAmount: finalTotal,
      tableId: selectedTable?.tableId ?? null,
      tableLabel: enableTableSelection ? formatTableLabel(selectedTable) : null,
    });

    billTimerRef.current = setTimeout(() => {
      setSaving(false);
      setError('Timed out waiting for bill confirmation.');
      billTimerRef.current = null;
    }, BILL_TIMEOUT_MS);
  };

  const holdBill = () => {
    if (cart.length === 0) {
      setError('Add at least one item to hold bill.');
      return;
    }
    if (!user?.userid) {
      setError('No active cashier session found.');
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');

    ipcService.send('hold-bill', {
      cashier: user.userid,
      date: localDateString(),
      orderItems: toOrderItems(),
      tableId: selectedTable?.tableId ?? null,
      tableLabel: enableTableSelection ? formatTableLabel(selectedTable) : null,
    });

    billTimerRef.current = setTimeout(() => {
      setSaving(false);
      setError('Timed out waiting for hold confirmation.');
      billTimerRef.current = null;
    }, BILL_TIMEOUT_MS);
  };

  const printBill = async () => {
    if (!lastBill) return;
    setPrinting(true);
    setError('');
    try {
      const result = await sendBillPrint(lastBill);
      if (!result?.success) {
        setError(result?.error || 'Print failed.');
        return;
      }
      setMessage((prev) => `${prev ? `${prev} ` : ''}Bill printed.`.trim());
    } catch (err) {
      console.error('Bill print failed:', err);
      setError('Print failed.');
    } finally {
      setPrinting(false);
    }
  };

  const printKot = async () => {
    if (!lastBill) return;
    setPrinting(true);
    setError('');
    try {
      const result = await sendKotPrint(lastBill);
      if (!result?.success) {
        setError(result?.error || 'Print failed.');
        return;
      }
      setMessage((prev) => `${prev ? `${prev} ` : ''}KOT printed.`.trim());
    } catch (err) {
      console.error('KOT print failed:', err);
      setError('Print failed.');
    } finally {
      setPrinting(false);
    }
  };

  const reprintLastReceipt = async () => {
    if (!usePrinter) {
      setError('Printer is disabled in Settings > Feature Toggles.');
      return;
    }
    setPrinting(true);
    setError('');
    try {
      const result = await ipcService.invoke('printer:reprint-last', { retries: 1 });
      if (!result?.success) {
        setError(result?.error || 'Reprint failed.');
        return;
      }
      setMessage((prev) => `${prev ? `${prev} ` : ''}Last receipt reprinted.`.trim());
    } catch (err) {
      console.error('Reprint failed:', err);
      setError('Reprint failed.');
    } finally {
      setPrinting(false);
    }
  };

  const handleDiscountPercentChange = (value) => {
    setDiscountPercent(value);
    if (Number(value || 0) > 0) {
      setDiscountAmount('');
    }
  };

  const handleDiscountAmountChange = (value) => {
    setDiscountAmount(value);
    if (Number(value || 0) > 0) {
      setDiscountPercent('');
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1.5fr_1fr] gap-4 min-h-[68dvh] xl:h-[calc(100dvh-10rem)]">
      <section className="surface-card rounded-2xl p-4 space-y-4 flex flex-col h-full min-h-0 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-black text-on-light">Billing</h2>
            <p className="text-sm text-muted">Add items to cart and save/hold bill.</p>
            {enableTableSelection ? <p className="text-xs text-muted mt-1">{formatTableLabel(selectedTable)}</p> : null}
          </div>
          <div className="flex items-center gap-2">
            <div
              className="rounded-full px-3 py-1 text-xs font-semibold"
              style={{
                backgroundColor: printerHealth.state === 'ready'
                  ? 'rgba(34, 197, 94, 0.16)'
                  : printerHealth.state === 'busy'
                    ? 'rgba(245, 158, 11, 0.16)'
                    : printerHealth.state === 'disabled'
                      ? 'rgba(107, 114, 128, 0.16)'
                      : 'rgba(239, 68, 68, 0.16)',
                color: printerHealth.state === 'ready'
                  ? 'var(--status-success)'
                  : printerHealth.state === 'busy'
                    ? '#B45309'
                    : printerHealth.state === 'disabled'
                      ? 'var(--text-muted)'
                      : 'var(--status-error)',
              }}
              title={printerHealth.message}
            >
              Printer: {printerHealth.message}
            </div>
            {enableTableSelection ? (
              <Button variant="secondary" onClick={openTableModal} disabled={saving || tableBusy}>
                Select Table
              </Button>
            ) : null}
            <Button
              variant="secondary"
              onClick={loadCategories}
              disabled={loading || saving}
              aria-label="Refresh categories"
              title="Refresh categories"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span className="sr-only">Refresh</span>
            </Button>
          </div>
        </div>

        <div className="max-w-sm">
          <label className="text-xs text-muted uppercase mb-1 block">Search Items</label>
          <input
            value={itemSearch}
            onChange={(e) => setItemSearch(e.target.value)}
            placeholder="Search any item by name or ID"
            className="surface-input h-10 w-full rounded-lg px-3 text-sm"
          />
        </div>

        <div className="overflow-x-auto pb-1">
          <div className="flex flex-nowrap gap-2 min-w-max">
            {categories.map((category) => (
              <Button
                key={category.catid ?? category.catname}
                size="sm"
                variant={selectedCategory === category.catname ? 'default' : 'secondary'}
                onClick={() => setSelectedCategory(category.catname ?? '')}
                disabled={Boolean(itemSearch.trim())}
              >
                {category.catname ?? 'Unknown'}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-auto pr-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {(loading || loadingAllItems) ? <p className="text-sm text-muted col-span-full">Loading items...</p> : null}
            {!loading && !loadingAllItems && filteredMenuItems.length === 0 ? <p className="text-sm text-muted col-span-full">No matching items found.</p> : null}
            {!loading && !loadingAllItems && filteredMenuItems.map((item) => (
              <button
                key={item.fid ?? item._idx ?? Math.random()}
                type="button"
                onClick={() => addToCart(item)}
                className="rounded-xl border border-on-light bg-input hover:bg-hover p-3 text-left"
              >
                <p className="font-semibold text-on-light">{item.fname ?? 'Unknown'}</p>
                <p className="text-sm text-muted mt-1">{formatCurrency(item.cost)}</p>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="surface-card rounded-2xl p-4 space-y-4 flex flex-col h-full min-h-0 overflow-hidden">
        <h3 className="text-lg font-black text-on-light">Current Bill</h3>

        {enableTableSelection ? (
          <div className="rounded-lg border border-on-light bg-input p-2">
            <p className="text-xs text-muted uppercase">Assigned Table</p>
            <p className="text-sm font-semibold text-on-light mt-1">{formatTableLabel(selectedTable)}</p>
          </div>
        ) : null}

        <div className="space-y-2 flex-1 min-h-0 overflow-auto pr-1">
          {cart.length === 0 ? <p className="text-sm text-muted">No items added yet.</p> : null}
          {cart.map((line) => (
            <div key={line.foodId} className="rounded-lg border border-on-light p-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-on-light">{line.name}</p>
                <button type="button" className="text-xs text-error" onClick={() => removeLine(line.foodId)}>Remove</button>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <input
                  type="number"
                  min="1"
                  value={line.quantity}
                  onChange={(e) => setQuantity(line.foodId, e.target.value)}
                  className="surface-input h-8 w-20 rounded px-2 text-sm"
                />
                <p className="text-sm font-semibold text-on-light">{formatCurrency(line.price * line.quantity)}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-muted uppercase mb-1 block">Discount %</label>
            <input
              type="number"
              min="0"
              value={discountPercent}
              onChange={(e) => handleDiscountPercentChange(e.target.value)}
              disabled={Number(discountAmount || 0) > 0}
              className="surface-input h-9 w-full rounded px-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted uppercase mb-1 block">Discount Amt</label>
            <input
              type="number"
              min="0"
              value={discountAmount}
              onChange={(e) => handleDiscountAmountChange(e.target.value)}
              disabled={Number(discountPercent || 0) > 0}
              className="surface-input h-9 w-full rounded px-2 text-sm"
            />
          </div>
        </div>

        <div className="rounded-lg bg-input border border-on-light p-3 text-sm space-y-1">
          <div className="flex justify-between"><span className="text-on-light">Subtotal</span><span className="text-on-light">{formatCurrency(subtotal)}</span></div>
          <div className="flex justify-between"><span className="text-on-light">Discount</span><span className="text-on-light">{formatCurrency(computedDiscount.value)}</span></div>
          <div className="flex justify-between font-black text-base"><span className="text-on-light">Total</span><span className="text-on-light">{formatCurrency(finalTotal)}</span></div>
        </div>

        {computedDiscount.invalid ? <p className="text-xs text-error">{computedDiscount.reason}</p> : null}
        {error ? <p className="text-xs text-error">{error}</p> : null}
        {message ? <p className="text-xs text-success">{message}</p> : null}

        {lastBill && (
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={printBill} disabled={printing || !usePrinter}>Print Bill</Button>
            <Button size="sm" variant="secondary" onClick={printKot} disabled={printing || !usePrinter}>Print KOT</Button>
            <Button size="sm" variant="secondary" onClick={reprintLastReceipt} disabled={printing || !usePrinter}>Reprint Last</Button>
            <Button size="sm" variant="ghost" onClick={() => setLastBill(null)}>Dismiss</Button>
          </div>
        )}

        <div className={`grid gap-2 ${showHoldBill ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {showHoldBill ? <Button variant="secondary" onClick={holdBill} disabled={saving || cart.length === 0}>Hold Bill</Button> : null}
          <Button onClick={saveBill} disabled={saving || cart.length === 0}>{saving ? 'Processing...' : 'Save Bill'}</Button>
        </div>
      </section>

      <TableSelectionModal
        open={tableModalOpen}
        tables={tables}
        selectedTable={selectedTable}
        loading={tableLoading}
        busy={tableBusy}
        form={tableForm}
        setForm={setTableForm}
        onClose={() => setTableModalOpen(false)}
        onSelect={(table) => {
          setSelectedTable(table);
          setMessage(`Selected ${formatTableLabel(table)}.`);
          setTableModalOpen(false);
        }}
        onSave={saveTable}
        onEdit={(table) => setTableForm({ tableId: table.tableId, tableNumber: String(table.tableNumber || ''), tableName: String(table.tableName || '') })}
        onDelete={deleteTable}
      />
    </div>
  );
}