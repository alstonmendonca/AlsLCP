import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { exportToExcel } from '@/lib/exportExcel';
import { useSortableData } from '@/hooks/useSortableData';

function SortHeader({ label, sortKey, sortConfig, onSort }) {
  const active = sortConfig.key === sortKey;
  const arrow = active ? (sortConfig.direction === 'asc' ? ' [A]' : ' [D]') : '';
  return (
    <th
      className="px-3 py-2 text-left text-xs uppercase text-muted cursor-pointer select-none hover:opacity-80"
      onClick={() => onSort(sortKey)}
    >
      {label}{arrow}
    </th>
  );
}

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

export function HistoryTable({ orders, exportFilename }) {
  const { sorted, sortConfig, requestSort } = useSortableData(orders);
  const [exporting, setExporting] = useState(false);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      await exportToExcel({
        filename: exportFilename || 'history',
        columns: [
          { header: 'Bill No', accessor: (r) => r.billno },
          { header: 'Date', accessor: (r) => formatDate(r.date) },
          { header: 'Cashier', accessor: (r) => r.cashier_name },
          { header: 'KOT', accessor: (r) => r.kot },
          { header: 'Price', accessor: (r) => Number(r.price || 0).toFixed(2) },
          { header: 'SGST', accessor: (r) => Number(r.sgst || 0).toFixed(2) },
          { header: 'CGST', accessor: (r) => Number(r.cgst || 0).toFixed(2) },
          { header: 'Tax', accessor: (r) => Number(r.tax || 0).toFixed(2) },
          { header: 'Items', accessor: (r) => r.food_items },
        ],
        rows: sorted,
      });
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(false);
    }
  }, [sorted, exportFilename]);

  if (sorted.length === 0) {
    return <p className="text-sm text-muted py-4 text-center">No order data loaded.</p>;
  }

  return (
    <div className="max-h-[calc(100dvh-14rem)] overflow-auto">
      <div className="flex justify-end p-2">
        <Button size="sm" variant="secondary" onClick={handleExport} disabled={exporting}>
          {exporting ? 'Exporting...' : 'Export Excel'}
        </Button>
      </div>
      <table className="w-full min-w-[980px]">
        <thead className="sticky top-0 z-10 bg-input border-b border-on-light">
          <tr>
            <SortHeader label="Bill No" sortKey="billno" sortConfig={sortConfig} onSort={requestSort} />
            <SortHeader label="Date" sortKey="date" sortConfig={sortConfig} onSort={requestSort} />
            <SortHeader label="Cashier" sortKey="cashier_name" sortConfig={sortConfig} onSort={requestSort} />
            <SortHeader label="KOT" sortKey="kot" sortConfig={sortConfig} onSort={requestSort} />
            <SortHeader label="Price" sortKey="price" sortConfig={sortConfig} onSort={requestSort} />
            <SortHeader label="SGST" sortKey="sgst" sortConfig={sortConfig} onSort={requestSort} />
            <SortHeader label="CGST" sortKey="cgst" sortConfig={sortConfig} onSort={requestSort} />
            <SortHeader label="Tax" sortKey="tax" sortConfig={sortConfig} onSort={requestSort} />
            <SortHeader label="Items" sortKey="food_items" sortConfig={sortConfig} onSort={requestSort} />
          </tr>
        </thead>
        <tbody>
          {sorted.map((order, i) => (
            <tr key={order.billno ?? `order-${i}`} className="border-b border-subtle align-top">
              <td className="px-3 py-2 text-sm text-on-light">{order.billno ?? '-'}</td>
              <td className="px-3 py-2 text-sm text-on-light">{formatDate(order.date)}</td>
              <td className="px-3 py-2 text-sm text-on-light">{order.cashier_name || '-'}</td>
              <td className="px-3 py-2 text-sm text-on-light">{order.kot || '-'}</td>
              <td className="px-3 py-2 text-sm text-on-light">{Number(order.price || 0).toFixed(2)}</td>
              <td className="px-3 py-2 text-sm text-on-light">{Number(order.sgst || 0).toFixed(2)}</td>
              <td className="px-3 py-2 text-sm text-on-light">{Number(order.cgst || 0).toFixed(2)}</td>
              <td className="px-3 py-2 text-sm text-on-light">{Number(order.tax || 0).toFixed(2)}</td>
              <td className="px-3 py-2 text-sm text-on-light max-w-[420px] whitespace-normal">{order.food_items || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SalesOverviewTable({ data }) {
  const { sorted, sortConfig, requestSort } = useSortableData(data);
  const [exporting, setExporting] = useState(false);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      await exportToExcel({
        filename: 'sales-overview',
        columns: [
          { header: 'Date', accessor: (r) => formatDate(r.date) },
          { header: 'Orders', accessor: (r) => r.totalSales ?? 0 },
          { header: 'Revenue', accessor: (r) => Number(r.totalRevenue || 0).toFixed(2) },
        ],
        rows: sorted,
      });
    } catch (err) { console.error('Export failed:', err); }
    finally { setExporting(false); }
  }, [sorted]);

  return (
    <div className="max-h-[calc(100dvh-14rem)] overflow-auto">
      <div className="flex justify-end p-2">
        <Button size="sm" variant="secondary" onClick={handleExport} disabled={exporting}>{exporting ? 'Exporting...' : 'Export Excel'}</Button>
      </div>
      <table className="w-full min-w-[460px]">
        <thead className="sticky top-0 z-10 bg-input border-b border-on-light">
          <tr>
            <SortHeader label="Date" sortKey="date" sortConfig={sortConfig} onSort={requestSort} />
            <SortHeader label="Orders" sortKey="totalSales" sortConfig={sortConfig} onSort={requestSort} />
            <SortHeader label="Revenue" sortKey="totalRevenue" sortConfig={sortConfig} onSort={requestSort} />
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr><td colSpan={3} className="px-3 py-6 text-sm text-muted">No data.</td></tr>
          ) : sorted.map((row, i) => (
            <tr key={row.date ?? `so-${i}`} className="border-b border-subtle">
              <td className="px-3 py-2 text-sm text-on-light">{formatDate(row.date)}</td>
              <td className="px-3 py-2 text-sm text-on-light">{row.totalSales ?? 0}</td>
              <td className="px-3 py-2 text-sm text-on-light">{formatCurrency(row.totalRevenue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CategorySalesTable({ data }) {
  const { sorted, sortConfig, requestSort } = useSortableData(data);
  const [exporting, setExporting] = useState(false);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      await exportToExcel({
        filename: 'category-sales',
        columns: [
          { header: 'Category', accessor: (r) => r.catname },
          { header: 'Units Sold', accessor: (r) => r.totalSales ?? 0 },
          { header: 'Revenue', accessor: (r) => Number(r.totalRevenue || 0).toFixed(2) },
        ],
        rows: sorted,
      });
    } catch (err) { console.error('Export failed:', err); }
    finally { setExporting(false); }
  }, [sorted]);

  return (
    <div className="max-h-[calc(100dvh-14rem)] overflow-auto">
      <div className="flex justify-end p-2">
        <Button size="sm" variant="secondary" onClick={handleExport} disabled={exporting}>{exporting ? 'Exporting...' : 'Export Excel'}</Button>
      </div>
      <table className="w-full min-w-[520px]">
        <thead className="sticky top-0 z-10 bg-input border-b border-on-light">
          <tr>
            <SortHeader label="Category" sortKey="catname" sortConfig={sortConfig} onSort={requestSort} />
            <SortHeader label="Units Sold" sortKey="totalSales" sortConfig={sortConfig} onSort={requestSort} />
            <SortHeader label="Revenue" sortKey="totalRevenue" sortConfig={sortConfig} onSort={requestSort} />
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr><td colSpan={3} className="px-3 py-6 text-sm text-muted">No data.</td></tr>
          ) : sorted.map((row, i) => (
            <tr key={row.catid ?? `cs-${i}`} className="border-b border-subtle">
              <td className="px-3 py-2 text-sm text-on-light">{row.catname ?? '-'}</td>
              <td className="px-3 py-2 text-sm text-on-light">{row.totalSales ?? 0}</td>
              <td className="px-3 py-2 text-sm text-on-light">{formatCurrency(row.totalRevenue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TopItemsTable({ data }) {
  const { sorted, sortConfig, requestSort } = useSortableData(data);
  return (
    <table className="w-full min-w-[500px]">
      <thead className="sticky top-0 z-10 bg-input border-b border-on-light">
        <tr>
          <SortHeader label="Date" sortKey="date" sortConfig={sortConfig} onSort={requestSort} />
          <SortHeader label="Top Item(s)" sortKey="most_sold_item" sortConfig={sortConfig} onSort={requestSort} />
        </tr>
      </thead>
      <tbody>
        {sorted.length === 0 ? (
          <tr><td colSpan={2} className="px-3 py-6 text-sm text-muted">No data.</td></tr>
        ) : sorted.map((row, i) => (
          <tr key={row.date ?? `ti-${i}`} className="border-b border-subtle">
            <td className="px-3 py-2 text-sm text-on-light">{formatDate(row.date)}</td>
            <td className="px-3 py-2 text-sm text-on-light">{row.most_sold_item ?? '-'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function TopCategoriesTable({ data }) {
  const { sorted, sortConfig, requestSort } = useSortableData(data);
  return (
    <table className="w-full min-w-[520px]">
      <thead className="sticky top-0 z-10 bg-input border-b border-on-light">
        <tr>
          <SortHeader label="Date" sortKey="date" sortConfig={sortConfig} onSort={requestSort} />
          <SortHeader label="Category" sortKey="category_name" sortConfig={sortConfig} onSort={requestSort} />
          <SortHeader label="Units" sortKey="total_quantity" sortConfig={sortConfig} onSort={requestSort} />
        </tr>
      </thead>
      <tbody>
        {sorted.length === 0 ? (
          <tr><td colSpan={3} className="px-3 py-6 text-sm text-muted">No data.</td></tr>
        ) : sorted.map((row, i) => (
          <tr key={row.date ?? `tc-${i}`} className="border-b border-subtle">
            <td className="px-3 py-2 text-sm text-on-light">{formatDate(row.date)}</td>
            <td className="px-3 py-2 text-sm text-on-light">{row.category_name ?? '-'}</td>
            <td className="px-3 py-2 text-sm text-on-light">{row.total_quantity ?? 0}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}