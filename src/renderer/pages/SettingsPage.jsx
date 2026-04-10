import { useState } from 'react';
import { Button } from '@/components/ui/button';
import ipcService from '@/services/ipcService';

export default function SettingsPage({ user, onLogout }) {
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

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
        <div>
          <h2 className="text-xl font-black text-slate-900">Profile Settings</h2>
          <p className="text-sm text-slate-600">Update your account details.</p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs uppercase text-slate-500 mb-1">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="h-10 w-full rounded-lg border border-slate-300 px-3" />
          </div>
          <div>
            <label className="block text-xs uppercase text-slate-500 mb-1">Username</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} className="h-10 w-full rounded-lg border border-slate-300 px-3" />
          </div>
          <div>
            <label className="block text-xs uppercase text-slate-500 mb-1">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-10 w-full rounded-lg border border-slate-300 px-3" />
          </div>
        </div>

        <Button onClick={updateProfile} disabled={savingProfile}>{savingProfile ? 'Saving...' : 'Save Profile'}</Button>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
        <div>
          <h2 className="text-xl font-black text-slate-900">Security</h2>
          <p className="text-sm text-slate-600">Change your password securely.</p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs uppercase text-slate-500 mb-1">Current Password</label>
            <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="h-10 w-full rounded-lg border border-slate-300 px-3" />
          </div>
          <div>
            <label className="block text-xs uppercase text-slate-500 mb-1">New Password</label>
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="h-10 w-full rounded-lg border border-slate-300 px-3" />
          </div>
        </div>

        <Button onClick={changePassword} disabled={savingPassword}>{savingPassword ? 'Updating...' : 'Change Password'}</Button>
      </section>

      {error ? <p className="text-sm text-red-600 xl:col-span-2">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-700 xl:col-span-2">{message}</p> : null}
    </div>
  );
}
