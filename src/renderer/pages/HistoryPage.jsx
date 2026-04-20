import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import ipcService from '@/services/ipcService';
import { HistoryTable } from '@/components/DataTable';

function toDateInputValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function HistoryPage() {
  const today = toDateInputValue(new Date());
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [orders, setOrders] = useState([]);

  const fetchHistory = async () => {
    if (!startDate || !endDate) {
      setError('Start date and end date are required.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const result = await ipcService.requestReply('get-order-history', 'order-history-response', {
        startDate,
        endDate,
      });
      setOrders(Array.isArray(result?.orders) ? result.orders : []);
    } catch (fetchError) {
      console.error('Failed to fetch history:', fetchError);
      setError('Could not fetch order history.');
      setOrders([]);
    } finally {
      setLoading(false);
    }
  };

  const totals = useMemo(() => {
    return orders.reduce(
      (acc, order) => {
        acc.count += 1;
        acc.price += Number(order.price || 0);
        acc.tax += Number(order.tax || 0);
        return acc;
      },
      { count: 0, price: 0, tax: 0 }
    );
  }, [orders]);

  return (
    <div className="space-y-4">
      <section className="surface-card rounded-2xl p-4 md:p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs uppercase tracking-[0.15em] text-muted mb-1">Start Date</label>
            <input
              type="date"
              lang="en-GB"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="surface-input h-10 rounded-lg px-3"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-[0.15em] text-muted mb-1">End Date</label>
            <input
              type="date"
              lang="en-GB"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="surface-input h-10 rounded-lg px-3"
            />
          </div>
          <Button onClick={fetchHistory} disabled={loading}>{loading ? 'Loading...' : 'Show History'}</Button>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="surface-card rounded-xl p-4">
          <p className="text-xs text-muted uppercase tracking-[0.15em]">Orders</p>
          <p className="text-2xl font-black text-on-light">{totals.count}</p>
        </div>
        <div className="surface-card rounded-xl p-4">
          <p className="text-xs text-muted uppercase tracking-[0.15em]">Total Amount</p>
          <p className="text-2xl font-black text-on-light">Rs. {totals.price.toFixed(2)}</p>
        </div>
        <div className="surface-card rounded-xl p-4">
          <p className="text-xs text-muted uppercase tracking-[0.15em]">Total Tax</p>
          <p className="text-2xl font-black text-on-light">Rs. {totals.tax.toFixed(2)}</p>
        </div>
      </section>

      {error ? <p className="text-sm text-error">{error}</p> : null}

      <section className="surface-card rounded-2xl overflow-hidden">
        {loading ? (
          <p className="text-sm text-muted text-center py-8">Loading order history...</p>
        ) : (
          <HistoryTable orders={orders} exportFilename="order-history" />
        )}
      </section>
    </div>
  );
}
