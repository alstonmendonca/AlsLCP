import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import ipcService from '@/services/ipcService';
import { SalesOverviewTable, CategorySalesTable, TopItemsTable, TopCategoriesTable } from '@/components/DataTable';

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

function ReportCard({ label, value }) {
  return (
    <div className="surface-card rounded-xl p-4">
      <p className="text-xs uppercase text-muted">{label}</p>
      <p className="text-2xl font-black text-on-light">{value}</p>
    </div>
  );
}

export default function ReportsPage({ initialReport }) {
  const today = localDateString();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeReport, setActiveReport] = useState(initialReport || 'dayEndSummary');
  const mountedRef = useRef(true);

  const [salesOverview, setSalesOverview] = useState([]);
  const [categorySales, setCategorySales] = useState([]);
  const [topItems, setTopItems] = useState([]);
  const [topCategories, setTopCategories] = useState([]);
  const [discountedOrders, setDiscountedOrders] = useState([]);
  const [itemSummary, setItemSummary] = useState([]);
  const [employeeAnalysis, setEmployeeAnalysis] = useState([]);
  const [bestInCategory, setBestInCategory] = useState([]);
  const [taxOnItems, setTaxOnItems] = useState([]);

  const [dayEnd, setDayEnd] = useState({
    revenue: 0, sales: 0, tax: 0, discounted: 0, deleted: 0, yesterdayRevenue: 0,
    mostSoldItems: [], mostSoldCategories: [], highestRevenueItems: [], highestRevenueCategory: [],
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    setActiveReport(initialReport || 'dayEndSummary');
  }, [initialReport]);

  const loadDayEnd = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const results = await Promise.allSettled([
        ipcService.invoke('get-todays-revenue'),
        ipcService.invoke('get-todays-sales'),
        ipcService.invoke('get-todays-tax'),
        ipcService.invoke('get-todays-discounted-orders'),
        ipcService.invoke('get-todays-deleted-orders'),
        ipcService.invoke('get-yesterdays-revenue'),
        ipcService.invoke('get-most-sold-items'),
        ipcService.invoke('get-most-sold-categories'),
        ipcService.invoke('get-highest-revenue-items'),
        ipcService.invoke('get-highest-revenue-category'),
      ]);

      if (!mountedRef.current) return;

      const v = (i) => results[i].status === 'fulfilled' ? results[i].value : null;
      const errors = results.filter((r) => r.status === 'rejected');
      if (errors.length > 0) {
        setError(`${errors.length} metric(s) failed to load.`);
      }

      setDayEnd({
        revenue: v(0) ?? 0,
        sales: v(1) ?? 0,
        tax: v(2) ?? 0,
        discounted: v(3) ?? 0,
        deleted: v(4) ?? 0,
        yesterdayRevenue: v(5) ?? 0,
        mostSoldItems: Array.isArray(v(6)) ? v(6) : [],
        mostSoldCategories: Array.isArray(v(7)) ? v(7) : [],
        highestRevenueItems: Array.isArray(v(8)) ? v(8) : [],
        highestRevenueCategory: Array.isArray(v(9)) ? v(9) : [],
      });
    } catch (err) {
      if (mountedRef.current) setError('Could not load day-end summary.');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  const loadDateRangeReports = useCallback(async () => {
    if (!startDate || !endDate) {
      setError('Start date and end date are required.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const results = await Promise.allSettled([
        ipcService.invoke('get-sales-overview-data', startDate, endDate),
        ipcService.invoke('get-category-wise-sales-data', startDate, endDate),
        ipcService.requestReply('get-discounted-orders', 'discounted-orders-response', { startDate, endDate }),
        ipcService.requestReply('get-top-selling-items', 'top-selling-items-response', { startDate, endDate }),
        ipcService.requestReply('get-top-selling-categories', 'top-selling-categories-response', { startDate, endDate }),
        ipcService.requestReply('get-item-summary', 'item-summary-response', { startDate, endDate }),
        ipcService.requestReply('get-employee-analysis', 'employee-analysis-response', { startDate, endDate }),
        ipcService.requestReply('get-best-in-category', 'best-in-category-response', { startDate, endDate }),
        ipcService.requestReply('get-tax-on-items', 'tax-on-items-response', { startDate, endDate }),
      ]);

      if (!mountedRef.current) return;

      const errors = results.filter((r) => r.status === 'rejected');
      if (errors.length > 0) {
        console.error('Some reports failed:', errors.map((e) => e.reason));
        setError(`Failed to load ${errors.length} report(s). Showing partial data.`);
      }

      const v = (i) => results[i].status === 'fulfilled' ? results[i].value : null;

      const salesData = v(0);
      const catData = v(1);
      const discountedData = v(2);
      const topItemsData = v(3);
      const topCatsData = v(4);
      const itemSummaryData = v(5);
      const employeeData = v(6);
      const bestData = v(7);
      const taxData = v(8);

      setSalesOverview(Array.isArray(salesData) ? salesData : []);
      setCategorySales(Array.isArray(catData) ? catData : []);
      setDiscountedOrders(Array.isArray(discountedData?.orders) ? discountedData.orders : []);
      setTopItems(Array.isArray(topItemsData?.items) ? topItemsData.items : []);
      setTopCategories(Array.isArray(topCatsData?.categories) ? topCatsData.categories : []);
      setItemSummary(Array.isArray(itemSummaryData?.items) ? itemSummaryData.items : []);
      setEmployeeAnalysis(Array.isArray(employeeData?.employees) ? employeeData.employees : []);
      setBestInCategory(Array.isArray(bestData?.categories) ? bestData.categories : []);
      setTaxOnItems(Array.isArray(taxData?.items) ? taxData.items : []);
    } catch (fetchError) {
      if (mountedRef.current) {
        console.error('Failed loading reports:', fetchError);
        setError('Could not load reports for the selected date range.');
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    if (activeReport === 'dayEndSummary') {
      loadDayEnd();
    }
  }, [activeReport, loadDayEnd]);

  const loadReports = () => {
    if (activeReport === 'dayEndSummary') {
      loadDayEnd();
    } else {
      loadDateRangeReports();
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

  const discountedTotals = useMemo(() => {
    return discountedOrders.reduce(
      (acc, row) => {
        acc.orders += 1;
        acc.totalDiscount += Number(row.discount_amount || 0);
        acc.gross += Number(row.Initial_price || 0);
        acc.net += Number(row.Final_Price || 0);
        return acc;
      },
      { orders: 0, totalDiscount: 0, gross: 0, net: 0 }
    );
  }, [discountedOrders]);

  const showDateRange = activeReport !== 'dayEndSummary';

  return (
    <div className="space-y-4">
      <section className="surface-card rounded-2xl p-4 md:p-5">
        <div className="flex flex-wrap items-end gap-3">
          {showDateRange && (
            <>
              <div>
                <label className="block text-xs uppercase text-muted mb-1">Start Date</label>
                <input type="date" lang="en-GB" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="surface-input h-10 rounded-lg px-3" />
              </div>
              <div>
                <label className="block text-xs uppercase text-muted mb-1">End Date</label>
                <input type="date" lang="en-GB" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="surface-input h-10 rounded-lg px-3" />
              </div>
            </>
          )}
          <Button
            onClick={loadReports}
            disabled={loading}
            aria-label={activeReport === 'dayEndSummary' ? 'Refresh day-end summary' : 'Run reports'}
            title={activeReport === 'dayEndSummary' ? 'Refresh day-end summary' : 'Run reports'}
          >
            {loading ? 'Loading...' : activeReport === 'dayEndSummary' ? (
              <>
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">Refresh</span>
              </>
            ) : 'Run Reports'}
          </Button>
        </div>
      </section>

      {error ? <p className="text-sm text-error">{error}</p> : null}

      {activeReport === 'dayEndSummary' && (
        <div className="space-y-4">
          <section className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <ReportCard label="Today Revenue" value={formatCurrency(dayEnd.revenue)} />
            <ReportCard label="Today Sales" value={dayEnd.sales} />
            <ReportCard label="Today Tax" value={formatCurrency(dayEnd.tax)} />
            <ReportCard label="Yesterday Revenue" value={formatCurrency(dayEnd.yesterdayRevenue)} />
            <ReportCard label="Discounted Orders" value={dayEnd.discounted} />
            <ReportCard label="Deleted Orders" value={dayEnd.deleted} />
          </section>

          <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="surface-card rounded-xl p-4 space-y-2">
              <p className="text-sm font-semibold text-on-light">Most Sold Items</p>
              {dayEnd.mostSoldItems.length === 0 ? (
                <p className="text-sm text-muted">No data</p>
              ) : dayEnd.mostSoldItems.map((item, i) => (
                <p key={i} className="text-sm text-on-light">{i + 1}. {item}</p>
              ))}
            </div>
            <div className="surface-card rounded-xl p-4 space-y-2">
              <p className="text-sm font-semibold text-on-light">Most Sold Categories</p>
              {dayEnd.mostSoldCategories.length === 0 ? (
                <p className="text-sm text-muted">No data</p>
              ) : dayEnd.mostSoldCategories.map((cat, i) => (
                <p key={i} className="text-sm text-on-light">{i + 1}. {cat}</p>
              ))}
            </div>
            <div className="surface-card rounded-xl p-4 space-y-2">
              <p className="text-sm font-semibold text-on-light">Highest Revenue Items</p>
              {dayEnd.highestRevenueItems.length === 0 ? (
                <p className="text-sm text-muted">No data</p>
              ) : dayEnd.highestRevenueItems.map((item, i) => (
                <p key={i} className="text-sm text-on-light">{i + 1}. {item}</p>
              ))}
            </div>
            <div className="surface-card rounded-xl p-4 space-y-2">
              <p className="text-sm font-semibold text-on-light">Highest Revenue Category</p>
              {dayEnd.highestRevenueCategory.length === 0 ? (
                <p className="text-sm text-muted">No data</p>
              ) : dayEnd.highestRevenueCategory.map((cat, i) => (
                <p key={i} className="text-sm text-on-light">{i + 1}. {cat}</p>
              ))}
            </div>
          </section>
        </div>
      )}

      {activeReport === 'salesOverview' && (
      <SalesOverviewTable data={salesOverview} />
      )}

      {activeReport === 'categorySales' && (
      <CategorySalesTable data={categorySales} />
      )}

      {activeReport === 'discountedOrders' && (
      <div className="space-y-4">
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <ReportCard label="Discounted Orders" value={discountedTotals.orders} />
          <ReportCard label="Gross Amount" value={formatCurrency(discountedTotals.gross)} />
          <ReportCard label="Total Discount" value={formatCurrency(discountedTotals.totalDiscount)} />
          <ReportCard label="Net Amount" value={formatCurrency(discountedTotals.net)} />
        </section>

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
                  <tr><td colSpan={6} className="px-3 py-6 text-sm text-muted">No discounted orders for this range.</td></tr>
                ) : discountedOrders.map((row, i) => (
                  <tr key={row.billno ?? `disc-${i}`} className="border-b border-subtle">
                    <td className="px-3 py-2 text-sm text-on-light">{row.billno ?? '-'}</td>
                    <td className="px-3 py-2 text-sm text-on-light">{formatDate(row.date)}</td>
                    <td className="px-3 py-2 text-sm text-on-light">{formatCurrency(row.Initial_price)}</td>
                    <td className="px-3 py-2 text-sm text-on-light">{Number(row.discount_percentage || 0).toFixed(2)}%</td>
                    <td className="px-3 py-2 text-sm text-on-light">{formatCurrency(row.discount_amount)}</td>
                    <td className="px-3 py-2 text-sm text-on-light">{formatCurrency(row.Final_Price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      )}

      {activeReport === 'topSellingItems' && (
      <section className="surface-card rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-on-light"><h3 className="font-bold text-on-light">Top Selling Items by Day</h3></div>
        <div className="max-h-[calc(100dvh-14rem)] overflow-auto">
          <TopItemsTable data={topItems} />
        </div>
      </section>
      )}

      {activeReport === 'topSellingCategory' && (
      <section className="surface-card rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-on-light"><h3 className="font-bold text-on-light">Top Categories by Day</h3></div>
        <div className="max-h-[calc(100dvh-14rem)] overflow-auto">
          <TopCategoriesTable data={topCategories} />
        </div>
      </section>
      )}

      {activeReport === 'itemSummary' && (
      <section className="surface-card rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-on-light"><h3 className="font-bold text-on-light">Item Summary</h3></div>
        <div className="max-h-[calc(100dvh-14rem)] overflow-auto">
          <table className="w-full min-w-[580px]">
            <thead className="sticky top-0 z-10 bg-input border-b border-on-light">
              <tr>
                <th className="px-3 py-2 text-left text-xs uppercase text-muted">Category</th>
                <th className="px-3 py-2 text-left text-xs uppercase text-muted">Item</th>
                <th className="px-3 py-2 text-left text-xs uppercase text-muted">Qty</th>
                <th className="px-3 py-2 text-left text-xs uppercase text-muted">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {itemSummary.length === 0 ? (
                <tr><td colSpan={4} className="px-3 py-6 text-sm text-muted">No item summary data.</td></tr>
              ) : itemSummary.map((row, i) => (
                <tr key={`${row.item ?? 'x'}-${i}`} className="border-b border-subtle">
                  <td className="px-3 py-2 text-sm text-muted">{row.categoryName ?? '-'}</td>
                  <td className="px-3 py-2 text-sm font-medium text-on-light">{row.item ?? '-'}</td>
                  <td className="px-3 py-2 text-sm text-on-light">{row.quantity ?? 0}</td>
                  <td className="px-3 py-2 text-sm text-on-light">{formatCurrency(row.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      )}

      {activeReport === 'employeeAnalysis' && (
      <section className="surface-card rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-on-light"><h3 className="font-bold text-on-light">Employee Analysis</h3></div>
        <div className="max-h-[calc(100dvh-14rem)] overflow-auto">
          <table className="w-full min-w-[580px]">
            <thead className="sticky top-0 z-10 bg-input border-b border-on-light">
              <tr>
                <th className="px-3 py-2 text-left text-xs uppercase text-muted">Name</th>
                <th className="px-3 py-2 text-left text-xs uppercase text-muted">Orders</th>
                <th className="px-3 py-2 text-left text-xs uppercase text-muted">Units Sold</th>
                <th className="px-3 py-2 text-left text-xs uppercase text-muted">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {employeeAnalysis.length === 0 ? (
                <tr><td colSpan={4} className="px-3 py-6 text-sm text-muted">No employee data.</td></tr>
              ) : employeeAnalysis.map((row, i) => (
                <tr key={row.userid ?? `emp-${i}`} className="border-b border-subtle">
                  <td className="px-3 py-2 text-sm font-medium text-on-light">{row.name ?? '-'}</td>
                  <td className="px-3 py-2 text-sm text-on-light">{row.order_count ?? 0}</td>
                  <td className="px-3 py-2 text-sm text-on-light">{row.total_units ?? 0}</td>
                  <td className="px-3 py-2 text-sm text-on-light">{formatCurrency(row.total_revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      )}

      {activeReport === 'bestInCategory' && (
      <section className="surface-card rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-on-light"><h3 className="font-bold text-on-light">Best In Category</h3></div>
        <div className="max-h-[calc(100dvh-14rem)] overflow-auto">
          <table className="w-full min-w-[460px]">
            <thead className="sticky top-0 z-10 bg-input border-b border-on-light">
              <tr>
                <th className="px-3 py-2 text-left text-xs uppercase text-muted">Category</th>
                <th className="px-3 py-2 text-left text-xs uppercase text-muted">Top Item(s)</th>
              </tr>
            </thead>
            <tbody>
              {bestInCategory.length === 0 ? (
                <tr><td colSpan={2} className="px-3 py-6 text-sm text-muted">No data.</td></tr>
              ) : bestInCategory.map((row, i) => (
                <tr key={row.catid ?? `bic-${i}`} className="border-b border-subtle">
                  <td className="px-3 py-2 text-sm font-medium text-on-light">{row.catname ?? '-'}</td>
                  <td className="px-3 py-2 text-sm text-on-light">{(row.top_items ?? []).join(', ') || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      )}

      {activeReport === 'taxOnItems' && (
      <section className="surface-card rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-on-light"><h3 className="font-bold text-on-light">Tax On Items</h3></div>
        <div className="max-h-[calc(100dvh-14rem)] overflow-auto">
          <table className="w-full min-w-[620px]">
            <thead className="sticky top-0 z-10 bg-input border-b border-on-light">
              <tr>
                <th className="px-3 py-2 text-left text-xs uppercase text-muted">Item</th>
                <th className="px-3 py-2 text-left text-xs uppercase text-muted">Qty</th>
                <th className="px-3 py-2 text-left text-xs uppercase text-muted">SGST</th>
                <th className="px-3 py-2 text-left text-xs uppercase text-muted">CGST</th>
                <th className="px-3 py-2 text-left text-xs uppercase text-muted">Tax</th>
              </tr>
            </thead>
            <tbody>
              {taxOnItems.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-6 text-sm text-muted">No tax data.</td></tr>
              ) : taxOnItems.map((row, i) => (
                <tr key={`${row.fname ?? 'x'}-${i}`} className="border-b border-subtle">
                  <td className="px-3 py-2 text-sm font-medium text-on-light">{row.fname ?? '-'}</td>
                  <td className="px-3 py-2 text-sm text-on-light">{row.total_quantity ?? 0}</td>
                  <td className="px-3 py-2 text-sm text-on-light">{formatCurrency(row.total_sgst)}</td>
                  <td className="px-3 py-2 text-sm text-on-light">{formatCurrency(row.total_cgst)}</td>
                  <td className="px-3 py-2 text-sm text-on-light">{formatCurrency(row.total_tax)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      )}
    </div>
  );
}