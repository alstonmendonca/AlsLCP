import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import ipcService from '@/services/ipcService';

function today() {
  return new Date().toISOString().split('T')[0];
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
  return date.toLocaleDateString('en-IN');
}

export default function ReportsPage() {
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState(today());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [salesOverview, setSalesOverview] = useState([]);
  const [categorySales, setCategorySales] = useState([]);
  const [topItems, setTopItems] = useState([]);
  const [topCategories, setTopCategories] = useState([]);

  const loadReports = async () => {
    setLoading(true);
    setError('');

    try {
      const [overviewData, categoryData, topItemsData, topCategoriesData] = await Promise.all([
        ipcService.invoke('get-sales-overview-data', startDate, endDate),
        ipcService.invoke('get-category-wise-sales-data', startDate, endDate),
        ipcService.requestReply('get-top-selling-items', 'top-selling-items-response', { startDate, endDate }),
        ipcService.requestReply('get-top-selling-categories', 'top-selling-categories-response', { startDate, endDate }),
      ]);

      setSalesOverview(Array.isArray(overviewData) ? overviewData : []);
      setCategorySales(Array.isArray(categoryData) ? categoryData : []);
      setTopItems(Array.isArray(topItemsData?.items) ? topItemsData.items : []);
      setTopCategories(Array.isArray(topCategoriesData?.categories) ? topCategoriesData.categories : []);
    } catch (fetchError) {
      console.error('Failed loading reports:', fetchError);
      setError('Could not load reports for the selected date range.');
      setSalesOverview([]);
      setCategorySales([]);
      setTopItems([]);
      setTopCategories([]);
    } finally {
      setLoading(false);
    }
  };

  const totals = useMemo(() => {
    return salesOverview.reduce(
      (acc, row) => {
        acc.days += 1;
        acc.orders += Number(row.totalSales || 0);
        acc.revenue += Number(row.totalRevenue || 0);
        return acc;
      },
      { days: 0, orders: 0, revenue: 0 }
    );
  }, [salesOverview]);

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 md:p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs uppercase text-slate-500 mb-1">Start Date</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-10 rounded-lg border border-slate-300 px-3" />
          </div>
          <div>
            <label className="block text-xs uppercase text-slate-500 mb-1">End Date</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-10 rounded-lg border border-slate-300 px-3" />
          </div>
          <Button onClick={loadReports} disabled={loading}>{loading ? 'Loading...' : 'Run Reports'}</Button>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">Days Covered</p>
          <p className="text-2xl font-black text-slate-900">{totals.days}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">Orders</p>
          <p className="text-2xl font-black text-[#0f766e]">{totals.orders}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">Revenue</p>
          <p className="text-2xl font-black text-[#0369a1]">{formatCurrency(totals.revenue)}</p>
        </div>
      </section>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200"><h3 className="font-bold">Daily Sales Overview</h3></div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[460px]">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2 text-left text-xs uppercase text-slate-500">Date</th>
                  <th className="px-3 py-2 text-left text-xs uppercase text-slate-500">Orders</th>
                  <th className="px-3 py-2 text-left text-xs uppercase text-slate-500">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {salesOverview.length === 0 ? (
                  <tr><td colSpan={3} className="px-3 py-6 text-sm text-slate-500">No sales overview data.</td></tr>
                ) : salesOverview.map((row) => (
                  <tr key={row.date} className="border-b border-slate-100">
                    <td className="px-3 py-2 text-sm">{formatDate(row.date)}</td>
                    <td className="px-3 py-2 text-sm">{row.totalSales}</td>
                    <td className="px-3 py-2 text-sm">{formatCurrency(row.totalRevenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200"><h3 className="font-bold">Category Sales</h3></div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px]">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2 text-left text-xs uppercase text-slate-500">Category</th>
                  <th className="px-3 py-2 text-left text-xs uppercase text-slate-500">Units Sold</th>
                  <th className="px-3 py-2 text-left text-xs uppercase text-slate-500">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {categorySales.length === 0 ? (
                  <tr><td colSpan={3} className="px-3 py-6 text-sm text-slate-500">No category sales data.</td></tr>
                ) : categorySales.map((row) => (
                  <tr key={row.catid} className="border-b border-slate-100">
                    <td className="px-3 py-2 text-sm">{row.catname}</td>
                    <td className="px-3 py-2 text-sm">{row.totalSales}</td>
                    <td className="px-3 py-2 text-sm">{formatCurrency(row.totalRevenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200"><h3 className="font-bold">Top Selling Items by Day</h3></div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[500px]">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2 text-left text-xs uppercase text-slate-500">Date</th>
                  <th className="px-3 py-2 text-left text-xs uppercase text-slate-500">Top Item(s)</th>
                </tr>
              </thead>
              <tbody>
                {topItems.length === 0 ? (
                  <tr><td colSpan={2} className="px-3 py-6 text-sm text-slate-500">No top-item data.</td></tr>
                ) : topItems.map((row) => (
                  <tr key={row.date} className="border-b border-slate-100">
                    <td className="px-3 py-2 text-sm">{formatDate(row.date)}</td>
                    <td className="px-3 py-2 text-sm">{row.most_sold_item}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200"><h3 className="font-bold">Top Categories by Day</h3></div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px]">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2 text-left text-xs uppercase text-slate-500">Date</th>
                  <th className="px-3 py-2 text-left text-xs uppercase text-slate-500">Category</th>
                  <th className="px-3 py-2 text-left text-xs uppercase text-slate-500">Units</th>
                </tr>
              </thead>
              <tbody>
                {topCategories.length === 0 ? (
                  <tr><td colSpan={3} className="px-3 py-6 text-sm text-slate-500">No top-category data.</td></tr>
                ) : topCategories.map((row) => (
                  <tr key={row.date} className="border-b border-slate-100">
                    <td className="px-3 py-2 text-sm">{formatDate(row.date)}</td>
                    <td className="px-3 py-2 text-sm">{row.category_name}</td>
                    <td className="px-3 py-2 text-sm">{row.total_quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
