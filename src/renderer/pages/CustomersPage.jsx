import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import ipcService from '@/services/ipcService';

const emptyForm = { cname: '', phone: '', address: '' };

export default function CustomersPage() {
  const [customers, setCustomers] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingForm, setEditingForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadCustomers = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await ipcService.requestReply('get-customers', 'customers-response', undefined);
      setCustomers(Array.isArray(result?.customers) ? result.customers : []);
    } catch (fetchError) {
      console.error('Failed to load customers:', fetchError);
      setError('Could not load customers.');
      setCustomers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCustomers();
  }, []);

  const filteredCustomers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return customers;

    return customers.filter((customer) => {
      return (
        String(customer.cid).includes(term) ||
        String(customer.cname || '').toLowerCase().includes(term) ||
        String(customer.phone || '').toLowerCase().includes(term) ||
        String(customer.address || '').toLowerCase().includes(term)
      );
    });
  }, [customers, search]);

  const addCustomer = async () => {
    const payload = {
      cname: form.cname.trim(),
      phone: form.phone.trim(),
      address: form.address.trim(),
    };

    if (!payload.cname) {
      setError('Customer name is required.');
      return;
    }

    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await ipcService.requestReply('add-customer', 'customer-added-response', payload);
      if (!result?.success) {
        setError('Failed to add customer.');
        return;
      }
      setForm(emptyForm);
      setMessage('Customer added successfully.');
      await loadCustomers();
    } catch (addError) {
      console.error('Failed to add customer:', addError);
      setError('Failed to add customer.');
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (customer) => {
    setEditingId(customer.cid);
    setEditingForm({
      cname: customer.cname || '',
      phone: customer.phone || '',
      address: customer.address || '',
    });
  };

  const saveEdit = async () => {
    if (!editingId) return;

    const payload = {
      cid: editingId,
      cname: editingForm.cname.trim(),
      phone: editingForm.phone.trim(),
      address: editingForm.address.trim(),
    };

    if (!payload.cname) {
      setError('Customer name is required.');
      return;
    }

    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await ipcService.requestReply('update-customer', 'update-customer-response', payload);
      if (!result?.success) {
        setError(result?.error || 'Failed to update customer.');
        return;
      }
      setEditingId(null);
      setEditingForm(emptyForm);
      setMessage('Customer updated successfully.');
      await loadCustomers();
    } catch (updateError) {
      console.error('Failed to update customer:', updateError);
      setError('Failed to update customer.');
    } finally {
      setBusy(false);
    }
  };

  const deleteCustomer = async (customerId) => {
    const ok = window.confirm('Delete this customer?');
    if (!ok) return;

    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await ipcService.requestReply('delete-customer', 'customer-delete-response', { customerId });
      if (!result?.success) {
        setError('Failed to delete customer.');
        return;
      }
      setMessage('Customer deleted successfully.');
      await loadCustomers();
    } catch (deleteError) {
      console.error('Failed to delete customer:', deleteError);
      setError('Failed to delete customer.');
    } finally {
      setBusy(false);
    }
  };

  const clearAllCustomers = async () => {
    const ok = window.confirm('Delete ALL customers? This cannot be undone.');
    if (!ok) return;

    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await ipcService.requestReply('clear-customer-data', 'clear-customer-data-response', undefined);
      if (!result?.success) {
        setError('Failed to clear customer data.');
        return;
      }
      setMessage('All customer data cleared.');
      await loadCustomers();
    } catch (clearError) {
      console.error('Failed to clear customer data:', clearError);
      setError('Failed to clear customer data.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-black text-slate-900">Customers</h2>
            <p className="text-sm text-slate-600">Manage customer records from React.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={loadCustomers} disabled={loading || busy}>Refresh</Button>
            <Button variant="ghost" onClick={clearAllCustomers} disabled={busy}>Clear All</Button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-2">
          <input
            value={form.cname}
            onChange={(e) => setForm((prev) => ({ ...prev, cname: e.target.value }))}
            placeholder="Customer Name"
            className="h-10 rounded-lg border border-slate-300 px-3"
          />
          <input
            value={form.phone}
            onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
            placeholder="Phone"
            className="h-10 rounded-lg border border-slate-300 px-3"
          />
          <input
            value={form.address}
            onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))}
            placeholder="Address"
            className="h-10 rounded-lg border border-slate-300 px-3"
          />
          <Button onClick={addCustomer} disabled={busy}>Add Customer</Button>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by id, name, phone, address"
          className="h-10 w-full rounded-lg border border-slate-300 px-3"
        />
      </section>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}

      <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-3 py-2 text-left text-xs uppercase text-slate-500">ID</th>
                <th className="px-3 py-2 text-left text-xs uppercase text-slate-500">Name</th>
                <th className="px-3 py-2 text-left text-xs uppercase text-slate-500">Phone</th>
                <th className="px-3 py-2 text-left text-xs uppercase text-slate-500">Address</th>
                <th className="px-3 py-2 text-left text-xs uppercase text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="px-3 py-8 text-sm text-slate-500">Loading customers...</td></tr>
              ) : null}
              {!loading && filteredCustomers.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-8 text-sm text-slate-500">No customers found.</td></tr>
              ) : null}
              {!loading && filteredCustomers.map((customer) => {
                const editing = editingId === customer.cid;
                return (
                  <tr key={customer.cid} className="border-b border-slate-100">
                    <td className="px-3 py-2 text-sm">{customer.cid}</td>
                    <td className="px-3 py-2 text-sm">
                      {editing ? (
                        <input
                          value={editingForm.cname}
                          onChange={(e) => setEditingForm((prev) => ({ ...prev, cname: e.target.value }))}
                          className="h-8 w-full rounded border border-slate-300 px-2"
                        />
                      ) : customer.cname}
                    </td>
                    <td className="px-3 py-2 text-sm">
                      {editing ? (
                        <input
                          value={editingForm.phone}
                          onChange={(e) => setEditingForm((prev) => ({ ...prev, phone: e.target.value }))}
                          className="h-8 w-full rounded border border-slate-300 px-2"
                        />
                      ) : (customer.phone || '-')}
                    </td>
                    <td className="px-3 py-2 text-sm">
                      {editing ? (
                        <input
                          value={editingForm.address}
                          onChange={(e) => setEditingForm((prev) => ({ ...prev, address: e.target.value }))}
                          className="h-8 w-full rounded border border-slate-300 px-2"
                        />
                      ) : (customer.address || '-')}
                    </td>
                    <td className="px-3 py-2 text-sm">
                      <div className="flex gap-2">
                        {editing ? (
                          <>
                            <Button size="sm" onClick={saveEdit} disabled={busy}>Save</Button>
                            <Button size="sm" variant="secondary" onClick={() => setEditingId(null)} disabled={busy}>Cancel</Button>
                          </>
                        ) : (
                          <>
                            <Button size="sm" variant="secondary" onClick={() => startEdit(customer)} disabled={busy}>Edit</Button>
                            <Button size="sm" variant="ghost" onClick={() => deleteCustomer(customer.cid)} disabled={busy}>Delete</Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
