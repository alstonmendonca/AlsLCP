import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import ipcService from '@/services/ipcService';

const BILL_FIELDS = [
  { key: 'title', label: 'Title', placeholder: 'ALSPOS' },
  { key: 'subtitle', label: 'Subtitle', placeholder: 'SJEC, VAMANJOOR' },
  { key: 'footer', label: 'Footer', placeholder: 'Thank you for visiting!' },
  { key: 'itemHeader', label: 'Item Column Header', placeholder: 'ITEM' },
  { key: 'qtyHeader', label: 'Qty Column Header', placeholder: 'QTY' },
  { key: 'priceHeader', label: 'Price Column Header', placeholder: 'PRICE' },
  { key: 'totalText', label: 'Total Label', placeholder: 'TOTAL: Rs.' },
];

const KOT_FIELDS = [
  { key: 'kotItemHeader', label: 'KOT Item Header', placeholder: 'ITEM' },
  { key: 'kotQtyHeader', label: 'KOT Qty Header', placeholder: 'QTY' },
];

export default function ReceiptEditorPage() {
  const [template, setTemplate] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const load = async () => {
      setLoading(true);
      try {
        const data = await ipcService.invoke('load-receipt-template');
        if (!mountedRef.current) return;
        if (data?.success === false) {
          setError(data.message || 'Failed to load receipt template.');
        } else {
          setTemplate(data || {});
        }
      } catch (err) {
        console.error('Failed to load receipt template:', err);
        if (mountedRef.current) setError('Could not load receipt template.');
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    };
    load();
    return () => { mountedRef.current = false; };
  }, []);

  const save = async () => {
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const result = await ipcService.invoke('save-receipt-template', template);
      if (!mountedRef.current) return;
      if (result?.success) {
        setMessage('Receipt template saved.');
      } else {
        setError(result?.message || 'Failed to save receipt template.');
      }
    } catch (err) {
      if (mountedRef.current) setError('Could not save receipt template.');
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  };

  const updateField = (key, value) => {
    setTemplate((prev) => ({ ...prev, [key]: value }));
  };

  if (loading) {
    return <section className="surface-card rounded-2xl p-6 text-sm text-muted">Loading...</section>;
  }

  return (
    <section className="surface-card rounded-2xl p-5 space-y-6">
      <div>
        <h2 className="text-xl font-black text-on-light">Receipt Editor</h2>
        <p className="text-sm text-muted mt-1">Customize the text shown on printed receipts and KOTs.</p>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-on-light uppercase mb-3">Bill Receipt</h3>
        <div className="space-y-3">
          {BILL_FIELDS.map((f) => (
            <div key={f.key}>
              <label className="block text-xs uppercase text-muted mb-1">{f.label}</label>
              <input
                value={template[f.key] ?? ''}
                onChange={(e) => updateField(f.key, e.target.value)}
                className="surface-input h-10 w-full rounded-lg px-3 text-sm"
                placeholder={f.placeholder}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-on-light pt-4">
        <h3 className="text-sm font-semibold text-on-light uppercase mb-3">KOT (Kitchen Order Ticket)</h3>
        <div className="space-y-3">
          {KOT_FIELDS.map((f) => (
            <div key={f.key}>
              <label className="block text-xs uppercase text-muted mb-1">{f.label}</label>
              <input
                value={template[f.key] ?? ''}
                onChange={(e) => updateField(f.key, e.target.value)}
                className="surface-input h-10 w-full rounded-lg px-3 text-sm"
                placeholder={f.placeholder}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-on-light pt-4">
        <h3 className="text-sm font-semibold text-on-light uppercase mb-3">Preview</h3>
        <div className="bg-white text-black p-4 rounded-lg font-mono text-xs leading-relaxed max-w-sm">
          <div className="text-center font-bold text-base">{template.title || 'ALSPOS'}</div>
          <div className="text-center">{template.subtitle || 'SJEC, VAMANJOOR'}</div>
          <div className="text-center">TOKEN: 1</div>
          <div>Date: {new Date().toLocaleString('en-IN')}</div>
          <div>Bill #: 1001</div>
          <div>------------------------------------------</div>
          <div className="font-bold">
            <span className="inline-block w-48">{template.itemHeader || 'ITEM'}</span>
            <span className="inline-block w-12 text-right">{template.qtyHeader || 'QTY'}</span>
            <span className="inline-block w-20 text-right">{template.priceHeader || 'PRICE'}</span>
          </div>
          <div>
            <span className="inline-block w-48">Sample Item</span>
            <span className="inline-block w-12 text-right">2</span>
            <span className="inline-block w-20 text-right">150.00</span>
          </div>
          <div>------------------------------------------</div>
          <div className="text-right font-bold">{template.totalText || 'TOTAL: Rs.'} 300.00</div>
          <div className="text-center mt-2">{template.footer || 'Thank you for visiting!'}</div>
        </div>
      </div>

      {error ? <p className="text-sm text-error">{error}</p> : null}
      {message ? <p className="text-sm text-success">{message}</p> : null}

      <Button onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save Receipt Template'}</Button>
    </section>
  );
}
