import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import ipcService from '@/services/ipcService';

function todayIsoDate() {
  return new Date().toISOString().split('T')[0];
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
  }).format(Number(value || 0));
}

export default function BillingPage({ user }) {
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [menuItems, setMenuItems] = useState([]);
  const [cart, setCart] = useState([]);
  const [discountPercent, setDiscountPercent] = useState('');
  const [discountAmount, setDiscountAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const loadCategories = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await ipcService.requestReply('get-categories-event', 'categories-response', undefined);
      const safeCategories = Array.isArray(result?.categories) ? result.categories : [];
      setCategories(safeCategories);
      if (safeCategories.length > 0) {
        setSelectedCategory((prev) => prev || safeCategories[0].catname);
      }
    } catch (fetchError) {
      console.error('Failed loading categories:', fetchError);
      setError('Could not load categories.');
    } finally {
      setLoading(false);
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
      setMenuItems(Array.isArray(items) ? items : []);
    } catch (fetchError) {
      console.error('Failed loading food items:', fetchError);
      setError('Could not load food items for selected category.');
      setMenuItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCategories();
  }, []);

  useEffect(() => {
    loadItems(selectedCategory);
  }, [selectedCategory]);

  useEffect(() => {
    const onSaved = (payload) => {
      setSaving(false);
      setMessage(`Bill saved successfully. KOT ${payload?.kot || '-'} | Order ${payload?.orderId || '-'}`);
      setCart([]);
      setDiscountAmount('');
      setDiscountPercent('');
    };

    const onHeld = () => {
      setSaving(false);
      setMessage('Bill held successfully.');
      setCart([]);
      setDiscountAmount('');
      setDiscountPercent('');
    };

    const onError = (payload) => {
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
          name: item.fname,
          price: Number(item.cost),
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
      date: todayIsoDate(),
      orderItems: toOrderItems(),
      totalAmount: finalTotal,
    });
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
      date: todayIsoDate(),
      orderItems: toOrderItems(),
    });
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1.5fr_1fr] gap-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-black text-slate-900">Billing</h2>
            <p className="text-sm text-slate-600">Add items to cart and save/hold bill from React.</p>
          </div>
          <Button variant="secondary" onClick={loadCategories} disabled={loading || saving}>Refresh</Button>
        </div>

        <div className="flex flex-wrap gap-2">
          {categories.map((category) => (
            <Button
              key={category.catid}
              size="sm"
              variant={selectedCategory === category.catname ? 'default' : 'secondary'}
              onClick={() => setSelectedCategory(category.catname)}
            >
              {category.catname}
            </Button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {loading ? <p className="text-sm text-slate-500 col-span-full">Loading items...</p> : null}
          {!loading && menuItems.length === 0 ? <p className="text-sm text-slate-500 col-span-full">No items available.</p> : null}
          {!loading && menuItems.map((item) => (
            <button
              key={item.fid}
              type="button"
              onClick={() => addToCart(item)}
              className="rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 p-3 text-left"
            >
              <p className="font-semibold text-slate-900">{item.fname}</p>
              <p className="text-sm text-slate-600 mt-1">{formatCurrency(item.cost)}</p>
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4 h-fit">
        <h3 className="text-lg font-black text-slate-900">Current Bill</h3>

        <div className="space-y-2 max-h-[340px] overflow-auto pr-1">
          {cart.length === 0 ? <p className="text-sm text-slate-500">No items added yet.</p> : null}
          {cart.map((line) => (
            <div key={line.foodId} className="rounded-lg border border-slate-200 p-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900">{line.name}</p>
                <button type="button" className="text-xs text-red-600" onClick={() => removeLine(line.foodId)}>Remove</button>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <input
                  type="number"
                  min="1"
                  value={line.quantity}
                  onChange={(e) => setQuantity(line.foodId, e.target.value)}
                  className="h-8 w-20 rounded border border-slate-300 px-2 text-sm"
                />
                <p className="text-sm font-semibold">{formatCurrency(line.price * line.quantity)}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-slate-500 uppercase">Discount %</label>
            <input
              type="number"
              min="0"
              value={discountPercent}
              onChange={(e) => setDiscountPercent(e.target.value)}
              className="h-9 w-full rounded border border-slate-300 px-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 uppercase">Discount Amt</label>
            <input
              type="number"
              min="0"
              value={discountAmount}
              onChange={(e) => setDiscountAmount(e.target.value)}
              className="h-9 w-full rounded border border-slate-300 px-2 text-sm"
            />
          </div>
        </div>

        <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm space-y-1">
          <div className="flex justify-between"><span>Subtotal</span><span>{formatCurrency(subtotal)}</span></div>
          <div className="flex justify-between"><span>Discount</span><span>{formatCurrency(computedDiscount.value)}</span></div>
          <div className="flex justify-between font-black text-base"><span>Total</span><span>{formatCurrency(finalTotal)}</span></div>
        </div>

        {computedDiscount.invalid ? <p className="text-xs text-red-600">{computedDiscount.reason}</p> : null}
        {error ? <p className="text-xs text-red-600">{error}</p> : null}
        {message ? <p className="text-xs text-emerald-700">{message}</p> : null}

        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={holdBill} disabled={saving || cart.length === 0}>Hold Bill</Button>
          <Button onClick={saveBill} disabled={saving || cart.length === 0}>{saving ? 'Processing...' : 'Save Bill'}</Button>
        </div>
      </section>
    </div>
  );
}
