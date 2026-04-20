import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialogs';
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

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}

function EditOrderModal({ billno, onSave, onCancel, busy }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const load = async () => {
      try {
        const result = await ipcService.requestReply('get-order-details', 'order-details-response', billno);
        if (!mountedRef.current) return;
        setItems(Array.isArray(result?.food_items) ? result.food_items.map((it) => ({
          foodId: it.foodId,
          name: it.foodName,
          price: it.price,
          quantity: it.quantity,
        })) : []);
      } catch (err) {
        if (mountedRef.current) setError('Could not load order details.');
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    };
    load();
    return () => { mountedRef.current = false; };
  }, [billno]);

  const setQty = (foodId, qty) => {
    const q = Math.max(0, Number(qty) || 0);
    setItems((prev) => prev.map((it) => it.foodId === foodId ? { ...it, quantity: q } : it));
  };

  const handleSave = () => {
    const orderItems = items.filter((it) => it.quantity > 0).map((it) => ({ foodId: it.foodId, quantity: it.quantity }));
    if (orderItems.length === 0) {
      setError('Order must have at least one item.');
      return;
    }
    onSave(billno, orderItems);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="surface-card rounded-2xl max-w-lg w-full max-h-[80vh] overflow-y-auto p-6 space-y-4">
        <h3 className="text-lg font-black text-on-light">Edit Order #{billno}</h3>
        {error ? <p className="text-sm text-error">{error}</p> : null}
        {loading ? (
          <p className="text-sm text-muted">Loading order details...</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted">No items found.</p>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <div key={item.foodId} className="flex items-center justify-between gap-3 p-2 rounded border border-on-light">
                <div className="flex-1">
                  <p className="text-sm font-medium text-on-light">{item.name}</p>
                  <p className="text-xs text-muted">Rs. {Number(item.price ?? 0).toFixed(2)}</p>
                </div>
                <input
                  type="number"
                  min="0"
                  value={item.quantity}
                  onChange={(e) => setQty(item.foodId, e.target.value)}
                  className="surface-input h-9 w-20 rounded px-2 text-sm text-center"
                />
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={busy || loading}>Save Changes</Button>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}

export default function OperationsPage({ initialTab }) {
  const [activeTab, setActiveTab] = useState(initialTab || 'todaysOrders');
  const [startDate, setStartDate] = useState(localDateString());
  const [endDate, setEndDate] = useState(localDateString());
  const [todayOrders, setTodayOrders] = useState([]);
  const [discountedOrders, setDiscountedOrders] = useState([]);
  const [deletedOrders, setDeletedOrders] = useState([]);
  const [loadingToday, setLoadingToday] = useState(false);
  const [loadingDiscounted, setLoadingDiscounted] = useState(false);
  const [loadingDeleted, setLoadingDeleted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [editBillno, setEditBillno] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState({ open: false, kind: '' });

  const fetchTodayOrders = async () => {
    setLoadingToday(true);
    setError('');
    try {
      const result = await ipcService.requestReply('get-todays-orders', 'todays-orders-response', undefined);
      setTodayOrders(Array.isArray(result?.orders) ? result.orders : []);
    } catch (fetchError) {
      console.error('Failed to fetch today orders:', fetchError);
      setError('Could not fetch today orders.');
      setTodayOrders([]);
    } finally {
      setLoadingToday(false);
    }
  };

  const fetchDiscountedOrders = async () => {
    if (!startDate || !endDate) {
      setError('Select start and end dates first.');
      return;
    }
    setLoadingDiscounted(true);
    setError('');
    setMessage('');
    try {
      const result = await ipcService.requestReply('get-discounted-orders', 'discounted-orders-response', {
        startDate,
        endDate,
      });
      setDiscountedOrders(Array.isArray(result?.orders) ? result.orders : []);
    } catch (fetchError) {
      console.error('Failed to fetch discounted orders:', fetchError);
      setError('Could not fetch discounted orders.');
      setDiscountedOrders([]);
    } finally {
      setLoadingDiscounted(false);
    }
  };

  const fetchDeletedOrders = async () => {
    if (!startDate || !endDate) {
      setError('Select start and end dates first.');
      return;
    }
    setLoadingDeleted(true);
    setError('');
    setMessage('');
    try {
      const result = await ipcService.requestReply('get-deleted-orders', 'deleted-orders-response', {
        startDate,
        endDate,
      });
      setDeletedOrders(Array.isArray(result?.orders) ? result.orders : []);
    } catch (fetchError) {
      console.error('Failed to fetch deleted orders:', fetchError);
      setError('Could not fetch deleted orders.');
      setDeletedOrders([]);
    } finally {
      setLoadingDeleted(false);
    }
  };

  const clearDiscountedOrders = async () => {
    setConfirmDialog({ open: true, kind: 'discounted' });
  };

  const clearDeletedOrders = async () => {
    setConfirmDialog({ open: true, kind: 'deleted' });
  };

  const runClearAction = async () => {
    if (!confirmDialog.kind) return;

    setBusy(true);
    setError('');
    setMessage('');
    try {
      const isDiscounted = confirmDialog.kind === 'discounted';
      const result = await ipcService.requestReply(
        isDiscounted ? 'clear-discounted-orders' : 'clear-deleted-orders',
        isDiscounted ? 'clear-discounted-orders-response' : 'clear-deleted-orders-response',
        undefined
      );
      if (!result?.success) {
        setError(isDiscounted ? 'Failed to clear discounted orders.' : 'Failed to clear deleted orders.');
        return;
      }
      if (isDiscounted) {
        setDiscountedOrders([]);
        setMessage('Discounted orders cleared successfully.');
      } else {
        setDeletedOrders([]);
        setMessage('Deleted orders cleared successfully.');
      }
      setConfirmDialog({ open: false, kind: '' });
    } catch (clearError) {
      console.error('Failed to clear records:', clearError);
      setError(confirmDialog.kind === 'discounted' ? 'Failed to clear discounted orders.' : 'Failed to clear deleted orders.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    setActiveTab(initialTab || 'todaysOrders');
  }, [initialTab]);

  useEffect(() => {
    if (activeTab === 'todaysOrders') {
      fetchTodayOrders();
      return;
    }
    if (activeTab === 'discountedOrders') {
      fetchDiscountedOrders();
      return;
    }
    if (activeTab === 'deletedOrders') {
      fetchDeletedOrders();
    }
  }, [activeTab, startDate, endDate]);

  return (
    <div className="space-y-4">
      {(activeTab === 'discountedOrders' || activeTab === 'deletedOrders') && (
        <section className="surface-card rounded-2xl p-4 md:p-5">
          <div className="flex flex-wrap md:flex-nowrap items-end gap-3">
            <div className="shrink-0">
              <label className="block text-xs uppercase text-muted mb-1">Start</label>
              <input type="date" lang="en-GB" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="surface-input h-10 rounded-lg px-3" />
            </div>
            <div className="shrink-0">
              <label className="block text-xs uppercase text-muted mb-1">End</label>
              <input type="date" lang="en-GB" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="surface-input h-10 rounded-lg px-3" />
            </div>
            {activeTab === 'discountedOrders' && (
              <>
                <Button className="shrink-0" variant="secondary" onClick={fetchDiscountedOrders} disabled={loadingDiscounted}>{loadingDiscounted ? 'Loading...' : 'Load Discounted Orders'}</Button>
                <Button className="shrink-0" variant="ghost" onClick={clearDiscountedOrders} disabled={busy}>Clear</Button>
              </>
            )}
            {activeTab === 'deletedOrders' && (
              <>
                <Button className="shrink-0" variant="secondary" onClick={fetchDeletedOrders} disabled={loadingDeleted}>{loadingDeleted ? 'Loading...' : 'Load Deleted Orders'}</Button>
                <Button className="shrink-0" variant="ghost" onClick={clearDeletedOrders} disabled={busy}>Clear</Button>
              </>
            )}
          </div>
        </section>
      )}

      {error ? <p className="text-sm text-error">{error}</p> : null}
      {message ? <p className="text-sm text-success">{message}</p> : null}

      <div className="grid grid-cols-1 gap-4">
        {activeTab === 'todaysOrders' && (
        <section className="surface-card rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-on-light"><h3 className="font-bold text-on-light">Today's Orders</h3></div>
          <div className="max-h-[calc(100dvh-14rem)] overflow-auto">
            <table className="w-full min-w-[760px]">
              <thead className="sticky top-0 z-10 bg-input border-b border-on-light">
                <tr>
                  <th className="px-3 py-2 text-left text-xs uppercase text-muted">Bill</th>
                  <th className="px-3 py-2 text-left text-xs uppercase text-muted">Date</th>
                  <th className="px-3 py-2 text-left text-xs uppercase text-muted">Cashier</th>
                  <th className="px-3 py-2 text-left text-xs uppercase text-muted">Amount</th>
                  <th className="px-3 py-2 text-left text-xs uppercase text-muted">Items</th>
                  <th className="px-3 py-2 text-left text-xs uppercase text-muted">Actions</th>
                </tr>
              </thead>
              <tbody>
                {todayOrders.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-6 text-sm text-muted">No today-order data loaded.</td></tr>
                ) : todayOrders.map((order, i) => (
                  <tr key={order.billno ?? `today-${i}`} className="border-b border-subtle">
                    <td className="px-3 py-2 text-sm text-on-light">{order.billno ?? '-'}</td>
                    <td className="px-3 py-2 text-sm text-on-light">{formatDate(order.date)}</td>
                    <td className="px-3 py-2 text-sm text-on-light">{order.cashier_name || '-'}</td>
                    <td className="px-3 py-2 text-sm text-on-light">{formatCurrency(order.price)}</td>
                    <td className="px-3 py-2 text-sm text-on-light">{order.food_items || '-'}</td>
                    <td className="px-3 py-2">
                      <Button size="sm" variant="secondary" onClick={() => setEditBillno(order.billno)} disabled={busy}>Edit</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        )}

        {activeTab === 'discountedOrders' && (
        <section className="surface-card rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-on-light"><h3 className="font-bold text-on-light">Discounted Orders</h3></div>
          <div className="max-h-[calc(100dvh-14rem)] overflow-auto">
            <table className="w-full min-w-[860px]">
              <thead className="sticky top-0 z-10 bg-input border-b border-on-light">
                <tr>
                  <th className="px-3 py-2 text-left text-xs uppercase text-muted">Bill</th>
                  <th className="px-3 py-2 text-left text-xs uppercase text-muted">Date</th>
                  <th className="px-3 py-2 text-left text-xs uppercase text-muted">Initial</th>
                  <th className="px-3 py-2 text-left text-xs uppercase text-muted">Discount %</th>
                  <th className="px-3 py-2 text-left text-xs uppercase text-muted">Discount Amt</th>
                  <th className="px-3 py-2 text-left text-xs uppercase text-muted">Final</th>
                </tr>
              </thead>
              <tbody>
                {discountedOrders.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-6 text-sm text-muted">No discounted-order data loaded.</td></tr>
                ) : discountedOrders.map((order, i) => (
                  <tr key={order.billno ?? `disc-${i}`} className="border-b border-subtle">
                    <td className="px-3 py-2 text-sm text-on-light">{order.billno ?? '-'}</td>
                    <td className="px-3 py-2 text-sm text-on-light">{formatDate(order.date)}</td>
                    <td className="px-3 py-2 text-sm text-on-light">{formatCurrency(order.Initial_price)}</td>
                    <td className="px-3 py-2 text-sm text-on-light">{Number(order.discount_percentage || 0).toFixed(2)}%</td>
                    <td className="px-3 py-2 text-sm text-on-light">{formatCurrency(order.discount_amount)}</td>
                    <td className="px-3 py-2 text-sm text-on-light">{formatCurrency(order.Final_Price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        )}

        {activeTab === 'deletedOrders' && (
        <section className="surface-card rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-on-light"><h3 className="font-bold text-on-light">Deleted Orders</h3></div>
          <div className="max-h-[calc(100dvh-14rem)] overflow-auto">
            <table className="w-full min-w-[980px]">
              <thead className="sticky top-0 z-10 bg-input border-b border-on-light">
                <tr>
                  <th className="px-3 py-2 text-left text-xs uppercase text-muted">Bill</th>
                  <th className="px-3 py-2 text-left text-xs uppercase text-muted">Date</th>
                  <th className="px-3 py-2 text-left text-xs uppercase text-muted">Cashier</th>
                  <th className="px-3 py-2 text-left text-xs uppercase text-muted">Amount</th>
                  <th className="px-3 py-2 text-left text-xs uppercase text-muted">Reason</th>
                  <th className="px-3 py-2 text-left text-xs uppercase text-muted">Items</th>
                </tr>
              </thead>
              <tbody>
                {deletedOrders.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-6 text-sm text-muted">No deleted-order data loaded.</td></tr>
                ) : deletedOrders.map((order, i) => (
                  <tr key={order.billno ?? `del-${i}`} className="border-b border-subtle">
                    <td className="px-3 py-2 text-sm text-on-light">{order.billno ?? '-'}</td>
                    <td className="px-3 py-2 text-sm text-on-light">{formatDate(order.date)}</td>
                    <td className="px-3 py-2 text-sm text-on-light">{order.cashier_name || '-'}</td>
                    <td className="px-3 py-2 text-sm text-on-light">{formatCurrency(order.price)}</td>
                    <td className="px-3 py-2 text-sm text-on-light">{order.reason || '-'}</td>
                    <td className="px-3 py-2 text-sm text-on-light">{order.food_items || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        )}
      </div>

      {editBillno && (
        <EditOrderModal
          billno={editBillno}
          onSave={updateOrder}
          onCancel={() => setEditBillno(null)}
          busy={busy}
        />
      )}

      <ConfirmDialog
        open={confirmDialog.open}
        title={confirmDialog.kind === 'discounted' ? 'Clear Discounted Orders' : 'Clear Deleted Orders'}
        message={
          confirmDialog.kind === 'discounted'
            ? 'Clear all discounted order records? This cannot be undone.'
            : 'Clear all deleted order records? This cannot be undone.'
        }
        confirmText="Clear"
        onConfirm={runClearAction}
        onCancel={() => setConfirmDialog({ open: false, kind: '' })}
        busy={busy}
      />
    </div>
  );
}
