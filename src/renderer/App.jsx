import { useEffect, useState } from 'react';
import DashboardPage from '@/pages/DashboardPage';
import LoginPage from '@/pages/LoginPage';
import SetupPage from '@/pages/SetupPage';
import ipcService from '@/services/ipcService';
import { useToast } from '@/components/ToastProvider';
import { applyThemePreset, resolveThemePreset } from '@/lib/themePresets';

export default function App() {
  const toast = useToast();
  const [booting, setBooting] = useState(true);
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState(null);
  const [setupStatus, setSetupStatus] = useState({ isInitialized: false, setup: null });

  useEffect(() => {
    let mounted = true;

    const restoreSession = async () => {
      try {
        if (!ipcService.isAvailable()) {
          if (mounted) toast.error('Electron IPC is unavailable.');
          return;
        }

        const status = await ipcService.invoke('get-app-setup-status');
        if (mounted) {
          setSetupStatus(status || { isInitialized: false, setup: null });
        }

        const uiSettings = await ipcService.invoke('load-ui-settings');
        applyThemePreset(resolveThemePreset(uiSettings?.themePreset));

        if (status?.isInitialized) {
          const sessionUser = await ipcService.invoke('get-session-user');
          if (mounted && sessionUser) {
            setUser(sessionUser);
          }
        }
      } catch (sessionError) {
        console.error('Failed to restore session:', sessionError);
        if (mounted) toast.error('Unable to restore previous session.');
      } finally {
        if (mounted) setBooting(false);
      }
    };

    restoreSession();
    return () => { mounted = false; };
  }, []);

  const handleLogin = async (credentials) => {
    setLoading(true);
    try {
      const loggedInUser = await ipcService.invoke('login', credentials || {});
      if (!loggedInUser) {
        toast.error('Invalid credentials.');
        return;
      }
      setUser(loggedInUser);
    } catch (loginError) {
      console.error('Login failed:', loginError);
      toast.error('Unable to login right now.');
    } finally {
      setLoading(false);
    }
  };

  const handleSetupComplete = (setupUser) => {
    setSetupStatus({ isInitialized: true, setup: null });
    if (setupUser) {
      setUser(setupUser);
    }
  };

  const handleLogout = async () => {
    try {
      await ipcService.invoke('logout');
    } catch (logoutError) {
      console.error('Logout failed:', logoutError);
    }
    setUser(null);
  };

  if (booting) {
    return (
      <div
        className="h-screen w-screen flex items-center justify-center"
        style={{ backgroundColor: 'var(--bg-app)', color: 'var(--text-on-light)' }}
      >
        <p className="text-sm tracking-[0.25em] uppercase" style={{ opacity: 0.6 }}>Loading session...</p>
      </div>
    );
  }

  if (!user) {
    if (!setupStatus?.isInitialized) {
      return <SetupPage onSetupComplete={handleSetupComplete} />;
    }

    return <LoginPage onLogin={handleLogin} loading={loading} />;
  }

  return <DashboardPage user={user} onLogout={handleLogout} />;
}