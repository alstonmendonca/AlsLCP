import { useState } from 'react';
import {
  Receipt, UtensilsCrossed, BookOpen,
  BarChart3, Settings, LogOut, ChevronDown, ChevronRight, Tags,
} from 'lucide-react';
import BillingPage from '@/pages/BillingPage';
import HistoryPage from '@/pages/HistoryPage';
import MenuPage from '@/pages/MenuPage';
import CategoriesPage from '@/pages/CategoriesPage';
import OperationsPage from '@/pages/OperationsPage';
import ReportsPage from '@/pages/ReportsPage';
import SettingsPage from '@/pages/SettingsPage';
import SearchOrderPage from '@/pages/SearchOrderPage';

const navSections = [
  { key: 'billing',   label: 'Billing',   Icon: Receipt },
  { key: 'menu',      label: 'Menu',      Icon: UtensilsCrossed },
  { key: 'categories', label: 'Categories', Icon: Tags },
  { key: 'history',   label: 'History',   Icon: BookOpen, subViews: [
    { key: 'todaysOrders',    label: "Today's Orders" },
    { key: 'orderHistory',    label: 'Order History' },
    { key: 'discountedOrders', label: 'Discounted Orders' },
    { key: 'deletedOrders',   label: 'Deleted Orders' },
    { key: 'searchOrder',     label: 'Search Order' },
  ]},
  { key: 'reports',   label: 'Reports',   Icon: BarChart3, subViews: [
    { key: 'dayEndSummary',      label: 'Day End Summary' },
    { key: 'salesOverview',      label: 'Sales Overview' },
    { key: 'categorySales',      label: 'Category Sales' },
    { key: 'discountedOrders',   label: 'Discounted Orders' },
    { key: 'topSellingItems',    label: 'Top Items' },
    { key: 'topSellingCategory', label: 'Top Categories' },
    { key: 'itemSummary',        label: 'Item Summary' },
    { key: 'employeeAnalysis',   label: 'Employee Analysis' },
    { key: 'bestInCategory',     label: 'Best In Category' },
    { key: 'taxOnItems',         label: 'Tax On Items' },
  ]},
  { key: 'settings', label: 'Settings', Icon: Settings, subViews: [
    { key: 'profile',       label: 'Profile & Password' },
    { key: 'featureToggles', label: 'Feature Toggles' },
    { key: 'updates',       label: 'Updates' },
    { key: 'categoryManagement', label: 'Category Management' },
    { key: 'theme',         label: 'Theme' },
    { key: 'printerConfig', label: 'Printer Config' },
    { key: 'businessInfo',  label: 'Business Info' },
    { key: 'backup',        label: 'Backup Database' },
    { key: 'restore',       label: 'Restore Database' },
    { key: 'exitApp',       label: 'Exit App' },
  ]},
];

function SidebarNav({ sections, activeView, activeSubView, expandedView, onNavClick, onSubClick }) {
  return (
    <nav className="flex-1 overflow-y-auto py-3 space-y-0.5">
      {sections.map(({ key, label, Icon, subViews }) => {
        const isActive = activeView === key;
        const hasSub = subViews?.length > 0;
        const isExpanded = expandedView === key;

        return (
          <div key={key}>
            <button
              onClick={() => onNavClick(key)}
              className="w-full text-left px-5 py-3 flex items-center gap-3 rounded-lg mx-2 transition-all"
              style={{
                backgroundColor: isActive ? 'var(--bg-hover)' : 'transparent',
                color: 'var(--text-on-dark)',
                opacity: isActive ? 1 : 0.6,
                fontWeight: isActive ? 600 : 400,
                width: 'calc(100% - 16px)',
                border: isActive ? '1px solid var(--border-on-dark)' : '1px solid transparent',
              }}
            >
              <Icon size={20} strokeWidth={isActive ? 2.5 : 1.5} />
              <span className="flex-1 text-sm">{label}</span>
              {hasSub && (
                isExpanded
                  ? <ChevronDown size={14} style={{ opacity: 0.5 }} />
                  : <ChevronRight size={14} style={{ opacity: 0.5 }} />
              )}
            </button>

            {isExpanded && hasSub && (
              <div className="px-4 mt-0.5 mb-1">
                {subViews.map((sub) => {
                  const subActive = activeSubView === sub.key;
                  return (
                    <button
                      key={sub.key}
                      onClick={() => onSubClick(sub.key)}
                      className="block w-full text-left px-4 py-2 text-xs rounded-md transition-all"
                      style={{
                        backgroundColor: subActive ? 'var(--bg-hover)' : 'transparent',
                        color: 'var(--text-on-dark)',
                        opacity: subActive ? 1 : 0.45,
                        fontWeight: subActive ? 500 : 400,
                        borderLeft: subActive ? '2px solid var(--text-on-dark)' : '2px solid transparent',
                      }}
                    >
                      {sub.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

export default function DashboardPage({ user, onLogout }) {
  const [activeView, setActiveView] = useState('billing');
  const [activeSubView, setActiveSubView] = useState('');
  const [expandedView, setExpandedView] = useState('');

  const handleNavClick = (key) => {
    const section = navSections.find((s) => s.key === key);
    const hasSubViews = Boolean(section?.subViews?.length);

    if (hasSubViews) {
      const isSameSection = activeView === key;
      const isExpanded = expandedView === key;

      setActiveView(key);
      if (!activeSubView || !section.subViews.some((sub) => sub.key === activeSubView)) {
        setActiveSubView(section.subViews[0].key);
      }

      if (isSameSection && isExpanded) {
        setExpandedView('');
      } else {
        setExpandedView(key);
      }
    } else {
      setActiveView(key);
      setActiveSubView('');
      setExpandedView('');
    }
  };

  const renderContent = () => {
    if (activeView === 'billing') return <BillingPage user={user} />;
    if (activeView === 'menu') return <MenuPage />;
    if (activeView === 'categories') return <CategoriesPage user={user} />;

    if (activeView === 'history') {
      if (['todaysOrders', 'discountedOrders', 'deletedOrders'].includes(activeSubView)) {
        return <OperationsPage initialTab={activeSubView} />;
      }
      if (activeSubView === 'orderHistory') return <HistoryPage />;
      if (activeSubView === 'searchOrder') return <SearchOrderPage />;
      return <OperationsPage initialTab="todaysOrders" />;
    }

    if (activeView === 'reports') {
      return <ReportsPage initialReport={activeSubView} />;
    }

    if (activeView === 'settings') {
      return <SettingsPage user={user} onLogout={onLogout} initialTab={activeSubView} />;
    }

    return null;
  };

  const currentSection = navSections.find((s) => s.key === activeView);
  const pageTitle = currentSection?.label ?? '';

  return (
    <div
      className="h-screen flex overflow-hidden"
      style={{ backgroundColor: 'var(--bg-app)', color: 'var(--text-on-light)' }}
    >
      {/* Sidebar */}
      <aside
        className="w-72 flex flex-col shrink-0 h-full overflow-hidden"
        style={{ backgroundColor: 'var(--bg-sidebar)', borderRight: '1px solid var(--border-on-dark)' }}
      >
        {/* Brand */}
        <div className="px-6 py-6" style={{ borderBottom: '1px solid var(--border-on-dark)' }}>
          <p className="text-sm font-bold tracking-[0.15em]" style={{ color: 'var(--text-on-dark)' }}>
            alspos
          </p>
          <p className="text-[10px] mt-1" style={{ color: 'var(--text-on-dark)', opacity: 0.4 }}>
            {user?.username ?? 'Staff'}
          </p>
        </div>

        <SidebarNav
          sections={navSections}
          activeView={activeView}
          activeSubView={activeSubView}
          expandedView={expandedView}
          onNavClick={handleNavClick}
          onSubClick={setActiveSubView}
        />

        {/* Sign out */}
        <div className="px-4 py-4" style={{ borderTop: '1px solid var(--border-on-dark)' }}>
          <button
            onClick={onLogout}
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm transition-all"
            style={{ color: 'var(--text-on-dark)', opacity: 0.72 }}
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 h-full overflow-y-auto" style={{ backgroundColor: 'var(--bg-app)' }}>
        {/* Top bar */}
        <header
          className="px-8 py-4 flex items-center justify-between sticky top-0 z-10"
          style={{
            backgroundColor: 'var(--bg-app)',
            borderBottom: '1px solid rgba(19, 18, 17, 0.10)',
          }}
        >
          <h1 className="text-lg font-bold" style={{ color: 'var(--text-on-light)' }}>
            {pageTitle}
          </h1>
          <p className="text-xs" style={{ color: 'var(--text-on-light)', opacity: 0.55 }}>
            {new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </header>

        <div className="px-8 py-6">
          {renderContent()}
        </div>
      </main>
    </div>
  );
}
