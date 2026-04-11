import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import ipcService from '@/services/ipcService';

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
  }).format(Number(value || 0));
}

const BILL_TIMEOUT_MS = 15000;
const BILLING_DRAFT_KEY = 'billingDraft:v1';

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
  const [lastBill, setLastBill] = useState(null);
  const mountedRef = useRef(true);
  const billTimerRef = useRef(null);
  const draftLoadedRef = useRef(false);

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
        })
      );
    } catch (err) {
      console.error('Failed to persist billing draft:', err);
    }
  }, [cart, discountPercent, discountAmount, itemSearch, selectedCategory]);

  const loadCategories = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await ipcService.requestReply('get-categories-event', 'categories-response', undefined);
      if (!mountedRef.current) return;
      const safeCategories = Array.isArray(result?.categories) ? result.categories : [];
      setCategories(safeCategories);
      if (safeCategories.length > 0) {
        setSelectedCategory((prev) => prev || (safeCategories[0]?.catname ?? ''));
      }
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
    let active = true;
    const loadUiSettings = async () => {
      try {
        const settings = await ipcService.invoke('load-ui-settings');
        if (!active) return;
        setShowHoldBill(settings?.showHoldBill !== false);
      } catch (err) {
        if (active) setShowHoldBill(true);
      }
    };
    loadUiSettings();
    return () => { active = false; };
  }, []);

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
    const onSaved = (payload) => {
      if (billTimerRef.current) { clearTimeout(billTimerRef.current); billTimerRef.current = null; }
      setSaving(false);
      setMessage(`Bill saved. KOT ${payload?.kot ?? '-'} | Order ${payload?.orderId ?? '-'}`);
      setLastBill({ kot: payload?.kot, orderId: payload?.orderId, items: [...cart], amount: finalTotal });
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

    const onPrintSuccess = () => {
      setPrinting(false);
      setMessage((prev) => prev + ' Print completed.');
    };

    const onPrintError = (msg) => {
      setPrinting(false);
      setError(msg || 'Print failed.');
    };

    ipcService.on('bill-saved', onSaved);
    ipcService.on('bill-held', onHeld);
    ipcService.on('bill-error', onError);
    ipcService.on('print-success-with-data', onPrintSuccess);
    ipcService.on('print-success', onPrintSuccess);
    ipcService.on('print-kot-success', onPrintSuccess);
    ipcService.on('print-error', onPrintError);

    return () => {
      ipcService.removeListener('bill-saved', onSaved);
      ipcService.removeListener('bill-held', onHeld);
      ipcService.removeListener('bill-error', onError);
      ipcService.removeListener('print-success-with-data', onPrintSuccess);
      ipcService.removeListener('print-success', onPrintSuccess);
      ipcService.removeListener('print-kot-success', onPrintSuccess);
      ipcService.removeListener('print-error', onPrintError);
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

    ipcService.send('save-bill', {
      cashier: user.userid,
      date: localDateString(),
      orderItems: toOrderItems(),
      totalAmount: finalTotal,
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
    });

    billTimerRef.current = setTimeout(() => {
      setSaving(false);
      setError('Timed out waiting for hold confirmation.');
      billTimerRef.current = null;
    }, BILL_TIMEOUT_MS);
  };

  const printBill = () => {
    if (!lastBill) return;
    setPrinting(true);
    setError('');
    ipcService.send('print-bill-only', {
      billItems: lastBill.items.map((l) => ({ foodId: l.foodId, foodName: l.name, price: l.price, quantity: l.quantity })),
      totalAmount: lastBill.amount,
      kot: lastBill.kot,
      orderId: lastBill.orderId,
      dateTime: new Date().toLocaleString('en-IN'),
    });
  };

  const printKot = () => {
    if (!lastBill) return;
    setPrinting(true);
    setError('');
    ipcService.send('print-kot-only', {
      billItems: lastBill.items.map((l) => ({ foodId: l.foodId, foodName: l.name, price: l.price, quantity: l.quantity })),
      totalAmount: lastBill.amount,
      kot: lastBill.kot,
      orderId: lastBill.orderId,
    });
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
          </div>
          <Button variant="secondary" onClick={loadCategories} disabled={loading || saving}>Refresh</Button>
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

        <div className="flex flex-wrap gap-2">
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
            <Button size="sm" variant="secondary" onClick={printBill} disabled={printing}>Print Bill</Button>
            <Button size="sm" variant="secondary" onClick={printKot} disabled={printing}>Print KOT</Button>
            <Button size="sm" variant="ghost" onClick={() => setLastBill(null)}>Dismiss</Button>
          </div>
        )}

        <div className={`grid gap-2 ${showHoldBill ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {showHoldBill ? <Button variant="secondary" onClick={holdBill} disabled={saving || cart.length === 0}>Hold Bill</Button> : null}
          <Button onClick={saveBill} disabled={saving || cart.length === 0}>{saving ? 'Processing...' : 'Save Bill'}</Button>
        </div>
      </section>
    </div>
  );
}