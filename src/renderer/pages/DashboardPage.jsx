import { useMemo, useState } from 'react';
import BillingPage from '@/pages/BillingPage';
import { Button } from '@/components/ui/button';
import HomePage from '@/pages/HomePage';
import HistoryPage from '@/pages/HistoryPage';
import InventoryPage from '@/pages/InventoryPage';
import MenuPage from '@/pages/MenuPage';
import ReportsPage from '@/pages/ReportsPage';
import SettingsPage from '@/pages/SettingsPage';

export default function DashboardPage({ user, onLogout }) {
  const [activeView, setActiveView] = useState('billing');

  const navItems = useMemo(() => ([
    { key: 'billing', label: 'Billing' },
    { key: 'home', label: 'Home' },
    { key: 'menu', label: 'Menu' },
    { key: 'history', label: 'History' },
    { key: 'inventory', label: 'Inventory' },
    { key: 'reports', label: 'Reports' },
    { key: 'settings', label: 'Settings' },
  ]), []);

  const renderContent = () => {
    if (activeView === 'billing') {
      return <BillingPage user={user} />;
    }

    if (activeView === 'home') {
      return <HomePage />;
    }

    if (activeView === 'menu') {
      return <MenuPage />;
    }

    if (activeView === 'history') {
      return <HistoryPage />;
    }

    if (activeView === 'inventory') {
      return <InventoryPage />;
    }

    if (activeView === 'reports') {
      return <ReportsPage />;
    }

    if (activeView === 'settings') {
      return <SettingsPage user={user} onLogout={onLogout} />;
    }

    return (
      <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-8">
        <h2 className="text-xl font-bold mb-2">{activeView[0].toUpperCase() + activeView.slice(1)} migration next</h2>
        <p className="text-slate-600">
          This section is queued for migration. Home is now live on React with real IPC data.
        </p>
      </section>
    );
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[#0f766e]">Lassi Corner POS</p>
            <h1 className="text-2xl font-black">React App Shell</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-sm font-semibold">{user?.username || 'User'}</p>
              <p className="text-xs text-slate-500">Role: {user?.role || 'staff'}</p>
            </div>
            <Button variant="secondary" onClick={onLogout}>Sign out</Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        <section className="rounded-2xl border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap gap-2">
            {navItems.map((item) => {
              const active = item.key === activeView;
              return (
                <Button
                  key={item.key}
                  variant={active ? 'default' : 'secondary'}
                  size="sm"
                  onClick={() => setActiveView(item.key)}
                >
                  {item.label}
                </Button>
              );
            })}
          </div>
        </section>

        {renderContent()}
      </main>
    </div>
  );
}
