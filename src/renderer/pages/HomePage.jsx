import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import ipcService from '@/services/ipcService';

function ItemCard({ item }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold text-slate-900 leading-tight">{item.fname}</h3>
        <span className={`text-xs px-2 py-1 rounded-full ${item.veg ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
          {item.veg ? 'VEG' : 'NON-VEG'}
        </span>
      </div>
      <p className="mt-3 text-lg font-black text-[#0f766e]">Rs. {Number(item.cost).toFixed(2)}</p>
    </div>
  );
}

export default function HomePage() {
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [items, setItems] = useState([]);
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [loadingItems, setLoadingItems] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;

    const loadCategories = async () => {
      setLoadingCategories(true);
      setError('');
      try {
        const data = await ipcService.invoke('get-categories');
        if (!mounted) return;
        const safe = Array.isArray(data) ? data : [];
        setCategories(safe);
        if (safe.length > 0) {
          setSelectedCategory(safe[0].catname);
        }
      } catch (fetchError) {
        console.error('Failed to load categories:', fetchError);
        if (mounted) {
          setError('Could not load categories.');
        }
      } finally {
        if (mounted) {
          setLoadingCategories(false);
        }
      }
    };

    loadCategories();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    const loadItems = async () => {
      if (!selectedCategory) {
        setItems([]);
        return;
      }
      setLoadingItems(true);
      setError('');
      try {
        const data = await ipcService.invoke('get-food-items', selectedCategory);
        if (!mounted) return;
        setItems(Array.isArray(data) ? data : []);
      } catch (fetchError) {
        console.error('Failed to load food items:', fetchError);
        if (mounted) {
          setError('Could not load items for this category.');
        }
      } finally {
        if (mounted) {
          setLoadingItems(false);
        }
      }
    };

    loadItems();

    return () => {
      mounted = false;
    };
  }, [selectedCategory]);

  const totalItems = useMemo(() => items.length, [items]);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-[linear-gradient(120deg,#0f766e_0%,#0f172a_70%)] text-white p-6 shadow-xl">
        <p className="text-xs uppercase tracking-[0.25em] text-emerald-200">Live Menu Snapshot</p>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-3xl font-black">Home</h2>
            <p className="text-sm text-emerald-100 mt-1">Category and item data is now powered by React + IPC.</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-emerald-100 uppercase tracking-[0.2em]">Visible Items</p>
            <p className="text-4xl font-black">{totalItems}</p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 md:p-5">
        <div className="flex flex-wrap items-center gap-2">
          {loadingCategories ? <p className="text-sm text-slate-500">Loading categories...</p> : null}
          {!loadingCategories && categories.length === 0 ? <p className="text-sm text-slate-500">No categories found.</p> : null}
          {categories.map((category) => {
            const active = selectedCategory === category.catname;
            return (
              <Button
                key={category.catid}
                variant={active ? 'default' : 'secondary'}
                size="sm"
                onClick={() => setSelectedCategory(category.catname)}
              >
                {category.catname}
              </Button>
            );
          })}
        </div>
      </section>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {loadingItems ? <p className="text-sm text-slate-500 col-span-full">Loading items...</p> : null}
        {!loadingItems && items.length === 0 ? (
          <p className="text-sm text-slate-500 col-span-full">No items available for this category.</p>
        ) : null}
        {items.map((item) => (
          <ItemCard key={item.fid} item={item} />
        ))}
      </section>
    </div>
  );
}
