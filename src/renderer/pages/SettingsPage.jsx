import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import ipcService from '@/services/ipcService';
import PrinterConfig from '@/pages/PrinterConfigPage';
import BusinessInfoPage from '@/pages/BusinessInfoPage';
import BackupRestorePage from '@/pages/BackupRestorePage';

function ThemeTab() {
  const palette = [
    { name: 'Black', value: '#000000' },
    { name: 'White', value: '#FFFFFF' },
    { name: 'Gray 90', value: '#1A1A1A' },
    { name: 'Gray 60', value: '#6B6B6B' },
    { name: 'Gray 15', value: '#E6E6E6' },
  ];

  return (
    <section className="surface-card rounded-2xl p-5 space-y-5 max-w-lg">
      <div>
        <h2 className="text-xl font-black text-on-light">Theme</h2>
        <p className="text-sm text-muted mt-1">The app uses a fixed monochrome palette across every screen.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {palette.map((swatch) => (
          <div key={swatch.value} className="rounded-xl border border-on-light p-3 text-center space-y-2">
            <div className="h-12 rounded-lg border border-on-light" style={{ backgroundColor: swatch.value }} />
            <div>
              <p className="text-xs font-semibold text-on-light">{swatch.name}</p>
              <p className="text-[11px] text-muted">{swatch.value}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function FeatureTogglesTab() {
  const [showHoldBill, setShowHoldBill] = useState(true);
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
      const result = await ipcService.invoke('save-ui-settings', { showHoldBill });
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
    <section className="surface-card rounded-2xl p-5 space-y-4 max-w-lg">
      <div>
        <h2 className="text-xl font-black text-on-light">Feature Toggles</h2>
        <p className="text-sm text-muted mt-1">Enable or disable optional behavior in the app.</p>
      </div>

      <label className="flex items-center justify-between gap-3 rounded-lg border border-on-light p-3">
        <span className="text-sm text-on-light">Show Hold Bill In Billing</span>
        <input type="checkbox" checked={showHoldBill} onChange={(e) => setShowHoldBill(e.target.checked)} className="h-4 w-4" />
      </label>

      {error ? <p className="text-sm text-error">{error}</p> : null}
      {message ? <p className="text-sm text-success">{message}</p> : null}

      <Button onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save Toggles'}</Button>
    </section>
  );
}

export default function SettingsPage({ user, onLogout, initialTab }) {
  const activeTab = initialTab || 'profile';
  const [name, setName] = useState(user?.name || '');
  const [username, setUsername] = useState(user?.username || '');
  const [email, setEmail] = useState(user?.email || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
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
        email: email.trim(),
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
              <div>
                <label className="block text-xs uppercase text-muted mb-1">Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="surface-input h-10 w-full rounded-lg px-3" />
              </div>
            </div>

            <Button onClick={updateProfile} disabled={savingProfile}>{savingProfile ? 'Saving...' : 'Save Profile'}</Button>
          </section>

          <section className="surface-card rounded-2xl p-5 space-y-4">
            <div>
              <h2 className="text-xl font-black text-on-light">Security</h2>
              <p className="text-sm text-muted">Change your password securely.</p>
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
          </section>

          {error ? <p className="text-sm text-error xl:col-span-2">{error}</p> : null}
          {message ? <p className="text-sm text-success xl:col-span-2">{message}</p> : null}
        </div>
      )}

      {activeTab === 'theme' && <ThemeTab />}

      {activeTab === 'featureToggles' && <FeatureTogglesTab />}

      {activeTab === 'printerConfig' && (
        <PrinterConfig />
      )}

      {activeTab === 'businessInfo' && (
        <BusinessInfoPage />
      )}

      {activeTab === 'backup' && (
        <BackupRestorePage mode="backup" />
      )}

      {activeTab === 'restore' && (
        <BackupRestorePage mode="restore" />
      )}

      <section className="surface-card rounded-2xl p-5 space-y-4 max-w-lg">
        <div>
          <h2 className="text-xl font-black text-on-light">App Controls</h2>
          <p className="text-sm text-muted mt-1">Close the application directly from settings.</p>
        </div>

        <Button type="button" variant="secondary" onClick={handleExitApp}>Exit App</Button>
      </section>
    </div>
  );
}