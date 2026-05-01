import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import ipcService from '@/services/ipcService';
import PrinterConfig from '@/pages/PrinterConfigPage';
import BusinessInfoPage from '@/pages/BusinessInfoPage';
import BackupRestorePage from '@/pages/BackupRestorePage';
import ReceiptEditorPage from '@/pages/ReceiptEditorPage';
import OfflineBanner from '@/components/OfflineBanner';
import { applyThemePreset, resolveThemePreset } from '@/lib/themePresets';
import useNetworkStatus from '@/hooks/useNetworkStatus';
import updateService from '@/services/updateService';

function ThemeTab() {
  const [selectedPreset, setSelectedPreset] = useState('creamCharcoal');
  const [savingPreset, setSavingPreset] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const presetCards = [
    {
      key: 'creamCharcoal',
      title: 'Cream + Charcoal',
      subtitle: 'EEE5DA and 262424',
      colors: ['#262424', '#EEE5DA', '#6B6B6B'],
    },
    {
      key: 'classicMono',
      title: 'Classic Black + White',
      subtitle: '000000 and FFFFFF',
      colors: ['#000000', '#FFFFFF', '#6B6B6B'],
    },
    {
      key: 'navySunburst',
      title: 'Navy + Sunburst',
      subtitle: '0A122A and FFF7E6',
      colors: ['#0A122A', '#FFF7E6', '#6B6B6B'],
    },
    {
      key: 'forestCream',
      title: 'Forest + Cream',
      subtitle: '004643 and F0EDE5',
      colors: ['#004643', '#F0EDE5', '#6B6B6B'],
    },
    {
      key: 'mintRose',
      title: 'Mint + Rose',
      subtitle: 'F0FFF0 and C54B8C',
      colors: ['#F0FFF0', '#C54B8C', '#6B6B6B'],
    },
  ];

  useEffect(() => {
    let mounted = true;

    const loadPreset = async () => {
      try {
        const settings = await ipcService.invoke('load-ui-settings');
        if (!mounted) return;
        const resolved = resolveThemePreset(settings?.themePreset);
        setSelectedPreset(resolved);
      } catch (loadError) {
        if (mounted) {
          setError('Could not load current theme preset.');
        }
      }
    };

    loadPreset();
    return () => { mounted = false; };
  }, []);

  const switchTheme = async (presetKey) => {
    const resolved = resolveThemePreset(presetKey);
    setSelectedPreset(resolved);
    setSavingPreset(true);
    setMessage('');
    setError('');
    applyThemePreset(resolved);

    try {
      const result = await ipcService.invoke('save-ui-settings', { themePreset: resolved });
      if (!result?.success) {
        setError(result?.message || 'Failed to save theme preset.');
        return;
      }
      setMessage('Theme preset updated.');
    } catch (saveError) {
      setError('Failed to save theme preset.');
    } finally {
      setSavingPreset(false);
    }
  };

  return (
    <section className="surface-card rounded-2xl p-5 space-y-5 max-w-3xl">
      <div>
        <h2 className="text-xl font-black text-on-light">Theme</h2>
        <p className="text-sm text-muted mt-1">Switch between presets any time. More presets can be added easily.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {presetCards.map((preset) => {
          const active = selectedPreset === preset.key;
          return (
            <div key={preset.key} className="rounded-xl border p-4 space-y-3" style={{ borderColor: active ? 'var(--text-on-light)' : 'var(--border-subtle)' }}>
              <div>
                <p className="text-sm font-bold text-on-light">{preset.title}</p>
                <p className="text-xs text-muted mt-1">{preset.subtitle}</p>
              </div>

              <div className="flex items-center gap-2">
                {preset.colors.map((color) => (
                  <div key={`${preset.key}-${color}`} className="h-9 w-9 rounded-md border border-on-light" style={{ backgroundColor: color }} />
                ))}
              </div>

              <Button
                type="button"
                variant={active ? 'default' : 'secondary'}
                onClick={() => switchTheme(preset.key)}
                disabled={savingPreset}
              >
                {active ? 'Active' : 'Use This Theme'}
              </Button>
            </div>
          );
        })}
      </div>

      {error ? <p className="text-sm text-error">{error}</p> : null}
      {message ? <p className="text-sm text-success">{message}</p> : null}
    </section>
  );
}

function FeatureTogglesTab() {
  const [showHoldBill, setShowHoldBill] = useState(true);
  const [usePrinter, setUsePrinter] = useState(true);
  const [autoPrintBillOnSave, setAutoPrintBillOnSave] = useState(false);
  const [autoPrintKotOnSave, setAutoPrintKotOnSave] = useState(false);
  const [enableTableSelection, setEnableTableSelection] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const load = async () => {
      setLoading(true);
      setError('');
      setMessage('');
      try {
        const settings = await ipcService.invoke('load-ui-settings');
        if (!mountedRef.current) return;
        setShowHoldBill(settings?.showHoldBill !== false);
        setUsePrinter(settings?.usePrinter !== false);
        setAutoPrintBillOnSave(settings?.autoPrintBillOnSave === true);
        setAutoPrintKotOnSave(settings?.autoPrintKotOnSave === true);
        setEnableTableSelection(settings?.enableTableSelection === true);
      } catch (loadError) {
        if (mountedRef.current) setError('Could not load feature toggles.');
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    };

    load();
    return () => { mountedRef.current = false; };
  }, []);

  const save = async () => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const result = await ipcService.invoke('save-ui-settings', {
        showHoldBill,
        usePrinter,
        autoPrintBillOnSave,
        autoPrintKotOnSave,
        enableTableSelection,
      });
      if (!mountedRef.current) return;
      if (!result?.success) {
        setError(result?.message || 'Failed to save feature toggles.');
        return;
      }
      setMessage('Feature toggles saved successfully.');
    } catch (saveError) {
      if (mountedRef.current) setError('Could not save feature toggles.');
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  };

  if (loading) {
    return <section className="surface-card rounded-2xl p-6 text-sm text-muted">Loading feature toggles...</section>;
  }

  return (
    <section className="surface-card rounded-2xl p-5 space-y-4 max-w-xl">
      <div>
        <h2 className="text-xl font-black text-on-light">Feature Toggles</h2>
        <p className="text-sm text-muted mt-1">Enable or disable optional behavior in the app.</p>
      </div>

      <label className="flex items-center justify-between gap-3 rounded-lg border border-on-light p-3">
        <span className="text-sm text-on-light">Show Hold Bill In Billing</span>
        <input type="checkbox" checked={showHoldBill} onChange={(e) => setShowHoldBill(e.target.checked)} className="h-4 w-4" />
      </label>

      <label className="flex items-center justify-between gap-3 rounded-lg border border-on-light p-3">
        <div>
          <p className="text-sm text-on-light">Use Printer</p>
          <p className="text-xs text-muted mt-1">Master switch for all print actions and printer health checks in Billing.</p>
        </div>
        <input type="checkbox" checked={usePrinter} onChange={(e) => setUsePrinter(e.target.checked)} className="h-4 w-4" />
      </label>

      <label className="flex items-center justify-between gap-3 rounded-lg border border-on-light p-3">
        <div>
          <p className="text-sm text-on-light">Auto Print Customer Bill After Save</p>
          <p className="text-xs text-muted mt-1">Automatically prints the final bill as soon as a bill is saved.</p>
        </div>
        <input type="checkbox" checked={autoPrintBillOnSave} onChange={(e) => setAutoPrintBillOnSave(e.target.checked)} className="h-4 w-4" disabled={!usePrinter} />
      </label>

      <label className="flex items-center justify-between gap-3 rounded-lg border border-on-light p-3">
        <div>
          <p className="text-sm text-on-light">Auto Print KOT After Save</p>
          <p className="text-xs text-muted mt-1">Automatically prints the kitchen order ticket as soon as a bill is saved.</p>
        </div>
        <input type="checkbox" checked={autoPrintKotOnSave} onChange={(e) => setAutoPrintKotOnSave(e.target.checked)} className="h-4 w-4" disabled={!usePrinter} />
      </label>

      <label className="flex items-center justify-between gap-3 rounded-lg border border-on-light p-3">
        <div>
          <p className="text-sm text-on-light">Enable Table Selection In Billing</p>
          <p className="text-xs text-muted mt-1">Shows a Select Table button in Billing and enables table assignment + table management modal.</p>
        </div>
        <input type="checkbox" checked={enableTableSelection} onChange={(e) => setEnableTableSelection(e.target.checked)} className="h-4 w-4" />
      </label>

      {error ? <p className="text-sm text-error">{error}</p> : null}
      {message ? <p className="text-sm text-success">{message}</p> : null}

      <Button onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save Toggles'}</Button>
    </section>
  );
}

function EmployeeManagementTab({ user }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showAddEmployeeModal, setShowAddEmployeeModal] = useState(false);
  const [showEditEmployeeModal, setShowEditEmployeeModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null);
  const addEmployeeNameInputRef = useRef(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [form, setForm] = useState({
    name: '',
    username: '',
    password: '',
    pin: '',
  });
  const [editForm, setEditForm] = useState({
    userid: null,
    name: '',
    username: '',
    isAdmin: false,
  });
  const [pinReset, setPinReset] = useState({ userid: null, pin: '' });

  const loadUsers = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await ipcService.invoke('get-tenant-users');
      if (!result?.success) {
        setError(result?.message || 'Could not load users.');
        setUsers([]);
        return;
      }
      setUsers(Array.isArray(result.users) ? result.users : []);
    } catch (err) {
      console.error('Failed to load users:', err);
      setError('Could not load users.');
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user?.isAdmin) {
      setLoading(false);
      return;
    }

    loadUsers();
  }, [user?.isAdmin]);

  useEffect(() => {
    if (showAddEmployeeModal) {
      addEmployeeNameInputRef.current?.focus();
    }
  }, [showAddEmployeeModal]);

  const filteredUsers = users.filter((entry) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      entry.name.toLowerCase().includes(query) ||
      entry.username.toLowerCase().includes(query) ||
      (entry.isAdmin ? 'admin' : 'employee').includes(query)
    );
  });

  const createEmployee = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await ipcService.invoke('add-new-user', {
        name: form.name.trim(),
        username: form.username.trim(),
        password: form.password,
        pin: form.pin.trim(),
      });

      if (!result?.success) {
        setError(result?.message || 'Failed to create employee account.');
        return;
      }

      setMessage(result?.message || 'Employee account created.');
      setForm({ name: '', username: '', password: '', pin: '' });
      setShowAddEmployeeModal(false);
      await loadUsers();
    } catch (err) {
      console.error('Create employee failed:', err);
      setError('Failed to create employee account.');
    } finally {
      setBusy(false);
    }
  };

  const openEditModal = (entry) => {
    setEditForm({
      userid: entry.userid,
      name: entry.name,
      username: entry.username,
      isAdmin: entry.isAdmin,
    });
    setShowEditEmployeeModal(true);
    setError('');
    setMessage('');
  };

  const updateEmployee = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await ipcService.invoke('edit-employee', {
        userid: editForm.userid,
        name: editForm.name.trim(),
        username: editForm.username.trim(),
        isAdmin: editForm.isAdmin,
      });

      if (!result?.success) {
        setError(result?.message || 'Failed to update employee.');
        return;
      }

      setMessage(result?.message || 'Employee updated successfully.');
      setShowEditEmployeeModal(false);
      await loadUsers();
    } catch (err) {
      console.error('Edit employee failed:', err);
      setError('Failed to update employee.');
    } finally {
      setBusy(false);
    }
  };

  const deleteEmployee = async (userid) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await ipcService.invoke('delete-employee', { userid });

      if (!result?.success) {
        setError(result?.message || 'Failed to delete employee.');
        return;
      }

      setMessage(result?.message || 'Employee deleted successfully.');
      setShowDeleteConfirm(null);
      await loadUsers();
    } catch (err) {
      console.error('Delete employee failed:', err);
      setError('Failed to delete employee.');
    } finally {
      setBusy(false);
    }
  };

  const resetPin = async () => {
    if (!pinReset.userid) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await ipcService.invoke('reset-user-pin', {
        userid: pinReset.userid,
        newPin: pinReset.pin.trim(),
      });

      if (!result?.success) {
        setError(result?.message || 'Failed to reset PIN.');
        return;
      }

      setMessage(result?.message || 'PIN reset successfully.');
      setPinReset({ userid: null, pin: '' });
    } catch (err) {
      console.error('Reset pin failed:', err);
      setError('Failed to reset PIN.');
    } finally {
      setBusy(false);
    }
  };

  if (!user?.isAdmin) {
    return (
      <section className="surface-card rounded-2xl p-5 max-w-lg">
        <h2 className="text-xl font-black text-on-light">Employee Management</h2>
        <p className="text-sm text-muted mt-2">Only admins can manage employee accounts and PINs.</p>
      </section>
    );
  }

  return (
    <section className="surface-card rounded-2xl p-5 space-y-4">
      <div>
        <h2 className="text-xl font-black text-on-light">Employee Accounts</h2>
        <p className="text-sm text-muted mt-1">Create, edit, and manage employee accounts. Employees are stored locally.</p>
      </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="surface-input h-10 rounded-lg px-3 w-full sm:w-64"
          placeholder="Search employees..."
        />
        <Button onClick={() => setShowAddEmployeeModal(true)} disabled={busy}>Add Employee</Button>
      </div>

      {showAddEmployeeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => !busy && setShowAddEmployeeModal(false)}>
          <div className="surface-card w-full max-w-2xl rounded-2xl p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4">
              <h3 className="text-lg font-black text-on-light">Add Employee</h3>
              <p className="text-sm text-muted mt-1">Create a new employee account with username, password, and PIN.</p>
            </div>

            <form onSubmit={(event) => {
              event.preventDefault();
              createEmployee();
            }}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input ref={addEmployeeNameInputRef} value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} className="surface-input h-10 rounded-lg px-3" placeholder="Employee Name" />
                <input value={form.username} onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value }))} className="surface-input h-10 rounded-lg px-3" placeholder="Username" />
                <input type="password" value={form.password} onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))} className="surface-input h-10 rounded-lg px-3" placeholder="Password (min 6)" />
                <input value={form.pin} onChange={(e) => setForm((prev) => ({ ...prev, pin: e.target.value.replace(/\D+/g, '').slice(0, 8) }))} className="surface-input h-10 rounded-lg px-3" placeholder="PIN (4-8 digits)" />
              </div>

              <div className="mt-4 flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setShowAddEmployeeModal(false)} disabled={busy}>Cancel</Button>
                <Button type="submit" disabled={busy}>{busy ? 'Working...' : 'Add Employee'}</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showEditEmployeeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => !busy && setShowEditEmployeeModal(false)}>
          <div className="surface-card w-full max-w-lg rounded-2xl p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4">
              <h3 className="text-lg font-black text-on-light">Edit Employee</h3>
              <p className="text-sm text-muted mt-1">Update employee details and role.</p>
            </div>

            <form onSubmit={(event) => {
              event.preventDefault();
              updateEmployee();
            }}>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs uppercase text-muted mb-1">Name</label>
                  <input
                    value={editForm.name}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                    className="surface-input h-10 w-full rounded-lg px-3"
                    placeholder="Employee Name"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs uppercase text-muted mb-1">Username</label>
                  <input
                    value={editForm.username}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, username: e.target.value }))}
                    className="surface-input h-10 w-full rounded-lg px-3"
                    placeholder="Username"
                    required
                  />
                </div>
                <label className="flex items-center justify-between gap-3 rounded-lg border border-on-light p-3">
                  <div>
                    <p className="text-sm text-on-light">Admin Role</p>
                    <p className="text-xs text-muted mt-1">Grant admin privileges to this employee.</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={editForm.isAdmin}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, isAdmin: e.target.checked }))}
                    className="h-4 w-4"
                    disabled={Number(editForm.userid) === Number(user?.userid)}
                  />
                </label>
              </div>

              <div className="mt-4 flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setShowEditEmployeeModal(false)} disabled={busy}>Cancel</Button>
                <Button type="submit" disabled={busy}>{busy ? 'Saving...' : 'Save Changes'}</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => !busy && setShowDeleteConfirm(null)}>
          <div className="surface-card w-full max-w-md rounded-2xl p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4">
              <h3 className="text-lg font-black text-on-light">Delete Employee</h3>
              <p className="text-sm text-muted mt-2">
                Are you sure you want to delete <strong>{showDeleteConfirm.name}</strong> ({showDeleteConfirm.username})?
              </p>
              <p className="text-xs text-muted mt-1">
                If this employee has order history, they will be deactivated instead of permanently deleted.
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setShowDeleteConfirm(null)} disabled={busy}>Cancel</Button>
              <Button
                type="button"
                onClick={() => deleteEmployee(showDeleteConfirm.userid)}
                disabled={busy}
                style={{ backgroundColor: 'var(--status-error, #ef4444)', color: '#fff' }}
              >
                {busy ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted">Loading users...</p>
      ) : (
        <div className="overflow-auto rounded-lg border border-on-light">
          <table className="w-full min-w-[700px]">
            <thead className="bg-input border-b border-on-light">
              <tr>
                <th className="text-left px-3 py-2 text-xs uppercase text-muted">Name</th>
                <th className="text-left px-3 py-2 text-xs uppercase text-muted">Username</th>
                <th className="text-left px-3 py-2 text-xs uppercase text-muted">Role</th>
                <th className="text-left px-3 py-2 text-xs uppercase text-muted">Reset PIN</th>
                <th className="text-left px-3 py-2 text-xs uppercase text-muted">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-sm text-muted text-center">
                    {searchQuery ? 'No employees match your search.' : 'No employees found.'}
                  </td>
                </tr>
              ) : (
                filteredUsers.map((entry) => (
                  <tr key={entry.userid} className="border-b border-subtle">
                    <td className="px-3 py-2 text-sm text-on-light">{entry.name}</td>
                    <td className="px-3 py-2 text-sm text-on-light">{entry.username}</td>
                    <td className="px-3 py-2 text-sm text-on-light">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${entry.isAdmin ? 'bg-primary/15 text-primary' : 'bg-black/10 text-on-light'}`}>
                        {entry.isAdmin ? 'Admin' : 'Employee'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-sm text-on-light">
                      <div className="flex gap-2">
                        <input
                          value={pinReset.userid === entry.userid ? pinReset.pin : ''}
                          onChange={(e) => setPinReset({ userid: entry.userid, pin: e.target.value.replace(/\D+/g, '').slice(0, 8) })}
                          className="surface-input h-9 rounded px-2 w-24"
                          placeholder="New PIN"
                        />
                        <Button
                          size="sm"
                          onClick={resetPin}
                          disabled={busy || pinReset.userid !== entry.userid || !pinReset.pin}
                        >
                          Reset
                        </Button>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-sm text-on-light">
                      <div className="flex gap-2">
                        <Button size="sm" variant="secondary" onClick={() => openEditModal(entry)} disabled={busy}>
                          Edit
                        </Button>
                        {Number(entry.userid) !== Number(user?.userid) && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setShowDeleteConfirm(entry)}
                            disabled={busy}
                            style={{ color: 'var(--status-error, #ef4444)', borderColor: 'var(--status-error, #ef4444)' }}
                          >
                            Delete
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {error ? <p className="text-sm text-error">{error}</p> : null}
      {message ? <p className="text-sm text-success">{message}</p> : null}
    </section>
  );
}

function AppControlsTab({ onExitApp }) {
  return (
    <section className="surface-card rounded-2xl p-5 space-y-4 max-w-lg">
      <div>
        <h2 className="text-xl font-black text-on-light">App Controls</h2>
        <p className="text-sm text-muted mt-1">Close the application directly from settings.</p>
      </div>

      <Button type="button" variant="secondary" onClick={onExitApp}>Exit App</Button>
    </section>
  );
}

function UpdateTab() {
  const CONTACT_MESSAGE = 'Contact Alston Mendonca to subscribe: alstondmendonca@gmail.com';
  const { isOnline } = useNetworkStatus();
  const [state, setState] = useState({
    status: 'idle',
    updateAvailable: false,
    checking: false,
    downloading: false,
    canInstall: false,
    currentVersion: '',
    latestVersion: '',
    message: '',
    error: '',
    updateInfo: null,
    downloadedPath: null,
    lastCheckedAt: null,
    progress: 0,
    speed: 0,
    remainingSeconds: null,
    chunkIndex: null,
    chunkTotal: null,
  });
  const [busy, setBusy] = useState(false);
  const [subscription, setSubscription] = useState(null);
  const [subscriptionLoading, setSubscriptionLoading] = useState(true);
  const [subscribeInfo, setSubscribeInfo] = useState('');

  const formatDateTime = (value) => {
    if (!value) return 'N/A';
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return 'N/A';
    const day = String(dt.getDate()).padStart(2, '0');
    const month = String(dt.getMonth() + 1).padStart(2, '0');
    const year = dt.getFullYear();
    const time = dt.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    return `${day}-${month}-${year} ${time}`;
  };

  const formatBytes = (bytes) => {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
  };

  const formatSpeed = (bytesPerSec) => {
    if (!bytesPerSec || bytesPerSec <= 0) return '--';
    return `${formatBytes(bytesPerSec)}/s`;
  };

  const formatETA = (seconds) => {
    if (seconds === null || seconds === undefined || seconds <= 0) return '--';
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  };

  const getRemainingLabel = () => {
    if (!subscription?.subscription) return 'Not added';
    if (!subscription.subscription.hasExpiry) return 'No expiry set';
    if (typeof subscription.subscription.remainingDays !== 'number') return 'N/A';
    if (subscription.subscription.remainingDays <= 0) return 'Expired';
    return `${subscription.subscription.remainingDays} day(s)`;
  };

  const getStatusConfig = () => {
    if (state.checking) return { label: 'Checking for updates...', color: 'var(--status-info, #3b82f6)', pulse: true };
    if (state.downloading) return { label: 'Downloading...', color: 'var(--status-info, #3b82f6)', pulse: true };
    if (state.status === 'downloaded') return { label: 'Ready to install', color: 'var(--status-success, #22c55e)', pulse: false };
    if (state.status === 'installing') return { label: 'Launching installer...', color: 'var(--status-success, #22c55e)', pulse: true };
    if (state.updateAvailable) return { label: 'Update available', color: 'var(--status-warning, #f59e0b)', pulse: false };
    if (state.error) return { label: 'Error', color: 'var(--status-error, #ef4444)', pulse: false };
    return { label: 'Up to date', color: 'var(--status-success, #22c55e)', pulse: false };
  };

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      setSubscriptionLoading(true);
      try {
        const snapshot = await updateService.getStatus();
        if (mounted && snapshot) {
          setState((prev) => ({ ...prev, ...snapshot }));
        }

        if (isOnline) {
          const subscriptionSnapshot = await updateService.getSubscriptionStatus();
          if (mounted) {
            setSubscription(subscriptionSnapshot || null);
          }
        } else {
          if (mounted) {
            setSubscription({ success: false, message: 'Subscription status unavailable offline.' });
          }
        }
      } catch (error) {
        if (mounted) {
          setState((prev) => ({ ...prev, error: 'Could not load update status.' }));
          setSubscription({ success: false, message: isOnline ? 'Could not load subscription status.' : 'Subscription status unavailable offline.' });
        }
      } finally {
        if (mounted) {
          setSubscriptionLoading(false);
        }
      }
    };

    const unsubscribe = updateService.subscribe((payload) => {
      if (!mounted || !payload?.payload) return;
      setState((prev) => ({ ...prev, ...payload.payload }));
    });

    load();

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const checkForUpdates = async () => {
    if (!isOnline) {
      setState((prev) => ({ ...prev, error: 'No internet connection. Please connect to WiFi or network to check for updates.' }));
      return;
    }
    setBusy(true);
    try {
      const snapshot = await updateService.checkForUpdates();
      if (snapshot) {
        setState((prev) => ({ ...prev, ...snapshot }));
      }
    } catch (error) {
      setState((prev) => ({ ...prev, error: error?.message || 'Failed to check for updates.' }));
    } finally {
      setBusy(false);
    }
  };

  const downloadUpdate = async () => {
    if (!isOnline) {
      setState((prev) => ({ ...prev, error: 'No internet connection. Please connect to WiFi or network to download updates.' }));
      return;
    }
    setBusy(true);
    try {
      const snapshot = await updateService.downloadUpdate();
      if (snapshot) {
        setState((prev) => ({ ...prev, ...snapshot }));
      }
    } catch (error) {
      setState((prev) => ({ ...prev, error: error?.message || 'Failed to download update.' }));
    } finally {
      setBusy(false);
    }
  };

  const installUpdate = async () => {
    setBusy(true);
    try {
      await updateService.installUpdate();
    } catch (error) {
      setState((prev) => ({ ...prev, error: error?.message || 'Failed to launch installer.' }));
      setBusy(false);
    }
  };

  const releaseNotes = state.updateInfo?.releaseNotes || '';
  const isSubscribed = Boolean(subscription?.subscribed);
  const hasSubscriptionRecord = Boolean(subscription?.subscription);
  const subscriptionStatusText = subscriptionLoading
    ? 'Loading...'
    : (!isOnline && !subscription?.subscribed)
      ? 'Offline'
      : (subscription?.subscription?.status || (subscription?.subscribed ? 'active' : 'not added'));
  const statusConfig = getStatusConfig();
  const isDownloading = state.downloading || state.status === 'downloading';
  const isChunked = Number(state.chunkTotal) > 1;

  return (
    <section className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black text-on-light">Software Update</h2>
          <p className="text-sm text-muted mt-1">Check for updates and install the latest version.</p>
        </div>
        <div className="flex items-center gap-2 rounded-full px-3 py-1.5" style={{ backgroundColor: `${statusConfig.color}15` }}>
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: statusConfig.color, animation: statusConfig.pulse ? 'pulse 2s infinite' : 'none' }} />
          <span className="text-xs font-semibold" style={{ color: statusConfig.color }}>{statusConfig.label}</span>
        </div>
      </div>

      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>

      {!isOnline ? <OfflineBanner /> : null}

      <div className="surface-card rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-on-light">Subscription</p>
          <span className={`text-xs font-semibold px-2 py-1 rounded ${isSubscribed ? 'bg-success/15 text-success' : 'bg-black/10 text-on-light'}`}>
            {subscriptionStatusText}
          </span>
        </div>

        {hasSubscriptionRecord ? (
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-lg border border-on-light p-2">
              <p className="uppercase text-muted">Started</p>
              <p className="mt-0.5 text-on-light truncate">{formatDateTime(subscription?.subscription?.startsAt)}</p>
            </div>
            <div className="rounded-lg border border-on-light p-2">
              <p className="uppercase text-muted">Ends</p>
              <p className="mt-0.5 text-on-light truncate">{formatDateTime(subscription?.subscription?.expiresAt)}</p>
            </div>
            <div className="rounded-lg border border-on-light p-2">
              <p className="uppercase text-muted">Remaining</p>
              <p className="mt-0.5 text-on-light">{getRemainingLabel()}</p>
            </div>
          </div>
        ) : null}

        {!isSubscribed ? (
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" onClick={() => setSubscribeInfo(CONTACT_MESSAGE)} className="text-xs h-8">
              Subscribe
            </Button>
            {subscribeInfo ? <p className="text-xs text-muted">{subscribeInfo}</p> : null}
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="surface-card rounded-2xl p-4">
          <p className="text-xs uppercase text-muted">Current Version</p>
          <p className="text-lg font-black text-on-light mt-0.5">{state.currentVersion || 'Unknown'}</p>
        </div>
        <div className="surface-card rounded-2xl p-4">
          <p className="text-xs uppercase text-muted">Latest Version</p>
          <p className="text-lg font-black text-on-light mt-0.5">{state.latestVersion || 'Not checked'}</p>
        </div>
      </div>

      {isDownloading && (
        <div className="surface-card rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-on-light">
              {isChunked ? `Downloading chunk ${(state.chunkIndex ?? 0) + 1} of ${state.chunkTotal}` : 'Downloading update'}
            </p>
            <p className="text-2xl font-black text-on-light">{state.progress ?? 0}%</p>
          </div>

          <div className="h-3 w-full rounded-full bg-black/10 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300 ease-out"
              style={{
                width: `${Math.max(0, Math.min(100, state.progress || 0))}%`,
                background: 'linear-gradient(90deg, var(--status-info, #3b82f6), var(--status-success, #22c55e))',
              }}
            />
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg border border-on-light p-2">
              <p className="text-xs text-muted">Downloaded</p>
              <p className="text-sm font-semibold text-on-light">{formatBytes(state.transferredBytes)}</p>
            </div>
            <div className="rounded-lg border border-on-light p-2">
              <p className="text-xs text-muted">Speed</p>
              <p className="text-sm font-semibold text-on-light">{formatSpeed(state.speed)}</p>
            </div>
            <div className="rounded-lg border border-on-light p-2">
              <p className="text-xs text-muted">Remaining</p>
              <p className="text-sm font-semibold text-on-light">{formatETA(state.remainingSeconds)}</p>
            </div>
          </div>

          {state.totalBytes > 0 && (
            <p className="text-xs text-muted text-center">{formatBytes(state.transferredBytes)} of {formatBytes(state.totalBytes)}</p>
          )}
        </div>
      )}

      {state.status === 'downloaded' && (
        <div className="surface-card rounded-2xl p-5 space-y-2" style={{ borderLeft: '4px solid var(--status-success, #22c55e)' }}>
          <p className="text-sm font-semibold text-success">Update downloaded and verified</p>
          <p className="text-xs text-muted">SHA256 hash verified. Ready to install.</p>
        </div>
      )}

      {state.updateAvailable && !isDownloading && state.status !== 'downloaded' && (
        <div className="surface-card rounded-2xl p-5 space-y-3" style={{ borderLeft: '4px solid var(--status-warning, #f59e0b)' }}>
          <p className="text-sm font-semibold" style={{ color: 'var(--status-warning, #f59e0b)' }}>
            Version {state.latestVersion} is available
          </p>
          {state.updateInfo?.fileSize ? (
            <p className="text-xs text-muted">Size: {formatBytes(state.updateInfo.fileSize)}</p>
          ) : null}
          {releaseNotes ? (
            <div className="rounded-lg border border-on-light p-3 max-h-32 overflow-y-auto">
              <p className="text-xs uppercase text-muted mb-1">Release Notes</p>
              <p className="text-sm text-on-light whitespace-pre-wrap">{releaseNotes}</p>
            </div>
          ) : null}
        </div>
      )}

      {!state.updateAvailable && !isDownloading && state.status !== 'downloaded' && !state.checking && !state.error && (
        <div className="surface-card rounded-2xl p-5">
          <p className="text-sm text-muted">
            {state.lastCheckedAt ? 'You are running the latest version.' : 'Click "Check for Updates" to see if a new version is available.'}
          </p>
        </div>
      )}

      {state.message && !isDownloading ? <p className="text-sm text-success">{state.message}</p> : null}
      {state.error ? <p className="text-sm text-error">{state.error}</p> : null}

      {state.lastCheckedAt && (
        <p className="text-xs text-muted">Last checked: {formatDateTime(state.lastCheckedAt)}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={checkForUpdates}
          disabled={busy || state.checking || isDownloading || !isOnline}
        >
          {state.checking ? 'Checking...' : 'Check for Updates'}
        </Button>
        <Button
          type="button"
          onClick={downloadUpdate}
          disabled={busy || !state.updateAvailable || isDownloading || state.status === 'downloaded' || !isOnline}
        >
          {isDownloading ? `Downloading ${state.progress ?? 0}%` : 'Download Update'}
        </Button>
        <Button
          type="button"
          onClick={installUpdate}
          disabled={busy || !state.canInstall || state.status !== 'downloaded'}
        >
          Install & Restart
        </Button>
      </div>
    </section>
  );
}

export default function SettingsPage({ user, onLogout, initialTab }) {
  const activeTab = initialTab || 'profile';
  const [name, setName] = useState(user?.name || '');
  const [username, setUsername] = useState(user?.username || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [savingPin, setSavingPin] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const clearAlerts = () => {
    setMessage('');
    setError('');
  };

  const updateProfile = async () => {
    clearAlerts();
    if (!user?.userid) {
      setError('No active session found.');
      return;
    }

    setSavingProfile(true);
    try {
      const result = await ipcService.invoke('edit-user-profile', {
        userid: user.userid,
        name: name.trim(),
        username: username.trim(),
      });

      if (!result?.success) {
        setError(result?.message || 'Failed to update profile.');
        return;
      }

      setMessage(result.message || 'Profile updated successfully.');
      await onLogout();
    } catch (profileError) {
      console.error('Profile update failed:', profileError);
      setError('Failed to update profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const changePassword = async () => {
    clearAlerts();
    if (!user?.userid) {
      setError('No active session found.');
      return;
    }

    setSavingPassword(true);
    try {
      const result = await ipcService.invoke('change-user-password', {
        userid: user.userid,
        currentPassword,
        newPassword,
      });

      if (!result?.success) {
        setError(result?.message || 'Failed to change password.');
        return;
      }

      setMessage(result.message || 'Password changed successfully.');
      setCurrentPassword('');
      setNewPassword('');
      await onLogout();
    } catch (passwordError) {
      console.error('Password update failed:', passwordError);
      setError('Failed to change password.');
    } finally {
      setSavingPassword(false);
    }
  };

  const changePin = async () => {
    clearAlerts();
    if (!user?.userid) {
      setError('No active session found.');
      return;
    }

    setSavingPin(true);
    try {
      const result = await ipcService.invoke('change-user-pin', {
        userid: user.userid,
        currentPin,
        newPin,
      });

      if (!result?.success) {
        setError(result?.message || 'Failed to change PIN.');
        return;
      }

      setMessage(result.message || 'PIN changed successfully.');
      setCurrentPin('');
      setNewPin('');
    } catch (pinError) {
      console.error('PIN update failed:', pinError);
      setError('Failed to change PIN.');
    } finally {
      setSavingPin(false);
    }
  };

  const handleExitApp = () => {
    ipcService.send('exit-app');
  };

  return (
    <div className="space-y-4">

      {activeTab === 'profile' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <section className="surface-card rounded-2xl p-5 space-y-4">
            <div>
              <h2 className="text-xl font-black text-on-light">Profile Settings</h2>
              <p className="text-sm text-muted">Update your account details.</p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs uppercase text-muted mb-1">Name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} className="surface-input h-10 w-full rounded-lg px-3" />
              </div>
              <div>
                <label className="block text-xs uppercase text-muted mb-1">Username</label>
                <input value={username} onChange={(e) => setUsername(e.target.value)} className="surface-input h-10 w-full rounded-lg px-3" />
              </div>
            </div>

            <Button onClick={updateProfile} disabled={savingProfile}>{savingProfile ? 'Saving...' : 'Save Profile'}</Button>
          </section>

          <section className="surface-card rounded-2xl p-5 space-y-4">
            <div>
              <h2 className="text-xl font-black text-on-light">Security</h2>
              <p className="text-sm text-muted">Change your password and PIN.</p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs uppercase text-muted mb-1">Current Password</label>
                <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="surface-input h-10 w-full rounded-lg px-3" />
              </div>
              <div>
                <label className="block text-xs uppercase text-muted mb-1">New Password</label>
                <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="surface-input h-10 w-full rounded-lg px-3" />
              </div>
            </div>

            <Button onClick={changePassword} disabled={savingPassword}>{savingPassword ? 'Updating...' : 'Change Password'}</Button>

            <div className="border-t border-on-light pt-4 space-y-3">
              <div>
                <label className="block text-xs uppercase text-muted mb-1">Current PIN</label>
                <input value={currentPin} onChange={(e) => setCurrentPin(e.target.value.replace(/\D+/g, '').slice(0, 8))} className="surface-input h-10 w-full rounded-lg px-3" placeholder="4-8 digits" />
              </div>
              <div>
                <label className="block text-xs uppercase text-muted mb-1">New PIN</label>
                <input value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D+/g, '').slice(0, 8))} className="surface-input h-10 w-full rounded-lg px-3" placeholder="4-8 digits" />
              </div>
            </div>

            <Button onClick={changePin} disabled={savingPin}>{savingPin ? 'Updating...' : 'Change PIN'}</Button>
          </section>

          {error ? <p className="text-sm text-error xl:col-span-2">{error}</p> : null}
          {message ? <p className="text-sm text-success xl:col-span-2">{message}</p> : null}

          <div className="xl:col-span-2">
            <EmployeeManagementTab user={user} />
          </div>
        </div>
      )}

      {activeTab === 'theme' && <ThemeTab />}

      {activeTab === 'featureToggles' && <FeatureTogglesTab />}

      {activeTab === 'updates' && <UpdateTab />}

      {activeTab === 'printerConfig' && (
        <PrinterConfig />
      )}

      {activeTab === 'businessInfo' && (
        <BusinessInfoPage />
      )}

      {activeTab === 'receiptEditor' && (
        <ReceiptEditorPage />
      )}

      {activeTab === 'backup' && (
        <BackupRestorePage mode="backup" />
      )}

      {activeTab === 'restore' && user?.isAdmin && (
        <BackupRestorePage mode="restore" />
      )}

      {(activeTab === 'profile' || activeTab === 'exitApp') && (
        <AppControlsTab onExitApp={handleExitApp} />
      )}
    </div>
  );
}