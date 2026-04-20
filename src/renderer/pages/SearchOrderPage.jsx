import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import ipcService from '@/services/ipcService';

function formatCurrency(value) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(value || 0));
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}

export default function SearchOrderPage() {
  const [filters, setFilters] = useState({
    billNoFrom: '', billNoTo: '', kotFrom: '', kotTo: '',
    startDate: '', endDate: '', cashier: '', minPrice: '', maxPrice: '',
  });
  const [orders, setOrders] = useState([]);
  const [cashiers, setCashiers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    ipcService.send('get-all-cashiers');

    const onCashiers = (data) => {
      if (!mountedRef.current) return;
      setCashiers(Array.isArray(data) ? data : []);
    };

    ipcService.on('all-cashiers-response', onCashiers);
    return () => {
      mountedRef.current = false;
      ipcService.removeListener('all-cashiers-response', onCashiers);
    };
  }, []);

  const search = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await ipcService.requestReply('search-orders', 'search-orders-response', {
        billNoFrom: filters.billNoFrom || undefined,
        billNoTo: filters.billNoTo || undefined,
        kotFrom: filters.kotFrom || undefined,
        kotTo: filters.kotTo || undefined,
        startDate: filters.startDate || undefined,
        endDate: filters.endDate || undefined,
        cashier: filters.cashier || undefined,
        minPrice: filters.minPrice || undefined,
        maxPrice: filters.maxPrice || undefined,
      });
      if (!mountedRef.current) return;
      setOrders(Array.isArray(result?.orders) ? result.orders : []);
    } catch (err) {
      console.error('Search failed:', err);
      if (mountedRef.current) {
        setError('Could not search orders.');
        setOrders([]);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  const set = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="space-y-4">
      <section className="surface-card rounded-2xl p-4 md:p-5 space-y-3">
        <div>
          <h2 className="text-xl font-black text-on-light">Search Orders</h2>
          <p className="text-sm text-muted">Filter orders by bill number, date, cashier, or price range.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs uppercase text-muted mb-1">Bill No From</label>
            <input value={filters.billNoFrom} onChange={(e) => set('billNoFrom', e.target.value)} className="surface-input h-10 w-full rounded-lg px-3" />
          </div>
          <div>
            <label className="block text-xs uppercase text-muted mb-1">Bill No To</label>
            <input value={filters.billNoTo} onChange={(e) => set('billNoTo', e.target.value)} className="surface-input h-10 w-full rounded-lg px-3" />
          </div>
          <div>
            <label className="block text-xs uppercase text-muted mb-1">KOT From</label>
            <input value={filters.kotFrom} onChange={(e) => set('kotFrom', e.target.value)} className="surface-input h-10 w-full rounded-lg px-3" />
          </div>
          <div>
            <label className="block text-xs uppercase text-muted mb-1">KOT To</label>
            <input value={filters.kotTo} onChange={(e) => set('kotTo', e.target.value)} className="surface-input h-10 w-full rounded-lg px-3" />
          </div>
          <div>
            <label className="block text-xs uppercase text-muted mb-1">Start Date</label>
            <input type="date" lang="en-GB" value={filters.startDate} onChange={(e) => set('startDate', e.target.value)} className="surface-input h-10 w-full rounded-lg px-3" />
          </div>
          <div>
            <label className="block text-xs uppercase text-muted mb-1">End Date</label>
            <input type="date" lang="en-GB" value={filters.endDate} onChange={(e) => set('endDate', e.target.value)} className="surface-input h-10 w-full rounded-lg px-3" />
          </div>
          <div>
            <label className="block text-xs uppercase text-muted mb-1">Cashier</label>
            <select value={filters.cashier} onChange={(e) => set('cashier', e.target.value)} className="surface-input h-10 w-full rounded-lg px-3">
              <option value="">All Cashiers</option>
              {cashiers.map((c) => (
                <option key={c.userid} value={c.userid}>{c.uname}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs uppercase text-muted mb-1">Min Price</label>
              <input type="number" min="0" value={filters.minPrice} onChange={(e) => set('minPrice', e.target.value)} className="surface-input h-10 w-full rounded-lg px-3" />
            </div>
            <div>
              <label className="block text-xs uppercase text-muted mb-1">Max Price</label>
              <input type="number" min="0" value={filters.maxPrice} onChange={(e) => set('maxPrice', e.target.value)} className="surface-input h-10 w-full rounded-lg px-3" />
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <Button onClick={search} disabled={loading}>{loading ? 'Searching...' : 'Search'}</Button>
          <Button variant="secondary" onClick={() => {
            setFilters({ billNoFrom: '', billNoTo: '', kotFrom: '', kotTo: '', startDate: '', endDate: '', cashier: '', minPrice: '', maxPrice: '' });
            setOrders([]);
          }}>Clear</Button>
        </div>
      </section>

      {error ? <p className="text-sm text-error">{error}</p> : null}

      <section className="surface-card rounded-2xl overflow-hidden">
        <div className="max-h-[calc(100dvh-14rem)] overflow-auto">
          <table className="w-full min-w-[980px]">
            <thead className="sticky top-0 z-10 bg-input border-b border-on-light">
              <tr>
                <th className="px-3 py-2 text-left text-xs uppercase text-muted">Bill</th>
                <th className="px-3 py-2 text-left text-xs uppercase text-muted">KOT</th>
                <th className="px-3 py-2 text-left text-xs uppercase text-muted">Date</th>
                <th className="px-3 py-2 text-left text-xs uppercase text-muted">Cashier</th>
                <th className="px-3 py-2 text-left text-xs uppercase text-muted">Price</th>
                <th className="px-3 py-2 text-left text-xs uppercase text-muted">SGST</th>
                <th className="px-3 py-2 text-left text-xs uppercase text-muted">CGST</th>
                <th className="px-3 py-2 text-left text-xs uppercase text-muted">Tax</th>
                <th className="px-3 py-2 text-left text-xs uppercase text-muted">Items</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr><td colSpan={9} className="px-3 py-6 text-sm text-muted">No orders found. Use the filters above to search.</td></tr>
              ) : orders.map((order, i) => (
                <tr key={order.billno ?? `so-${i}`} className="border-b border-subtle">
                  <td className="px-3 py-2 text-sm font-medium text-on-light">{order.billno ?? '-'}</td>
                  <td className="px-3 py-2 text-sm text-on-light">{order.kot ?? '-'}</td>
                  <td className="px-3 py-2 text-sm text-on-light">{formatDate(order.date)}</td>
                  <td className="px-3 py-2 text-sm text-on-light">{order.cashier_name ?? '-'}</td>
                  <td className="px-3 py-2 text-sm text-on-light">{formatCurrency(order.price)}</td>
                  <td className="px-3 py-2 text-sm text-on-light">{formatCurrency(order.sgst)}</td>
                  <td className="px-3 py-2 text-sm text-on-light">{formatCurrency(order.cgst)}</td>
                  <td className="px-3 py-2 text-sm text-on-light">{formatCurrency(order.tax)}</td>
                  <td className="px-3 py-2 text-sm text-on-light max-w-[300px] whitespace-normal">{order.food_items ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}