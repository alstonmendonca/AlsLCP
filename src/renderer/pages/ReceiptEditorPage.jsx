import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import ipcService from '@/services/ipcService';

const DEFAULT_TEMPLATE = {
  title: '',
  subtitle: '',
  contactLine: '',
  footer: 'Thank you! Visit us again.',
  tokenPrefix: 'TOKEN',
  showTable: false,
  tablePrefix: 'Table',
  showCashier: false,
  cashierPrefix: 'Cashier',
  itemHeader: 'ITEM',
  qtyHeader: 'QTY',
  priceHeader: 'AMOUNT',
  totalText: 'TOTAL: Rs.',
  itemNameWidth: 24,
  itemQtyWidth: 8,
  itemPriceWidth: 12,
  showItemNumbers: false,
  itemNumberPrefix: '#',
  itemAlign: 'left',
  qtyAlign: 'right',
  priceAlign: 'right',
  headerBold: true,
  headerAlign: 'left',
  totalBold: true,
  totalAlign: 'right',
  lineChar: '-',
  bodyTemplate: [
    '[center][bold]{{title}}',
    '[center]{{subtitle}}',
    '[center]{{contactLine}}',
    '[blank:1]',
    '[center][bold]{{tokenPrefix}}: {{token}}',
    '[left]Date: {{dateTime}}',
    '[left]Bill #: {{billNo}}',
    '[line]',
    '{{itemHeaderRow}}',
    '{{items}}',
    '[line]',
    '{{totalLine}}',
    '[blank:1]',
    '[center]Please retain bill for returns.',
    '[center]{{footer}}',
    '[cut]',
  ].join('\n'),
  itemLineTemplate: '{{namePad}}{{qtyPad}}{{amountPad}}',
  itemHeaderLineTemplate: '{{itemHeaderPad}}{{qtyHeaderPad}}{{priceHeaderPad}}',
  totalLineTemplate: '{{totalText}} {{total}}',
};

const SAMPLE_BILL = {
  token: '47',
  billNo: '1024',
  dateTime: new Date().toLocaleString('en-IN'),
  tableLabel: 'Table 5 - Window',
  cashierName: 'john',
  items: [
    { name: 'Masala Dosa', quantity: 2, unitPrice: 80, amount: 160 },
    { name: 'Paneer Tikka', quantity: 1, unitPrice: 120, amount: 120 },
    { name: 'Mango Lassi', quantity: 3, unitPrice: 50, amount: 150 },
    { name: 'Gulab Jamun', quantity: 2, unitPrice: 40, amount: 80 },
  ],
  total: 510,
};

function safeString(value, fallback = '') {
  if (value == null) return fallback;
  return String(value);
}

function replacePlaceholders(text, context) {
  return safeString(text, '').replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, key) => {
    const replacement = context[key];
    return replacement == null ? '' : String(replacement);
  });
}

function splitLines(value) {
  return safeString(value, '').split(/\r?\n/);
}

function padCell(text, width, align) {
  const value = safeString(text, '');
  const truncated = value.length >= width ? value.slice(0, width) : value;
  if (align === 'center') {
    const left = Math.floor((width - truncated.length) / 2);
    return ' '.repeat(Math.max(0, left)) + truncated + ' '.repeat(Math.max(0, width - truncated.length - left));
  }
  if (align === 'right') return truncated.padStart(width);
  return truncated.padEnd(width);
}

function parseLeadingTags(line) {
  const state = { align: 'left', bold: false, underline: false, underlineThick: false, invert: false, size: 'normal', font: 'a' };
  let working = line;

  while (working.trimStart().startsWith('[')) {
    const match = working.trimStart().match(/^\[([^\]]+)\]\s*/);
    if (!match) break;
    const tag = match[1].trim().toLowerCase();
    if (tag === 'center' || tag === 'left' || tag === 'right') {
      state.align = tag;
      working = working.trimStart().slice(match[0].length);
      continue;
    }
    if (tag === 'bold') {
      state.bold = true;
      working = working.trimStart().slice(match[0].length);
      continue;
    }
    if (tag === '/bold') {
      state.bold = false;
      working = working.trimStart().slice(match[0].length);
      continue;
    }
    if (tag === 'underline' || tag === 'u') {
      state.underline = true;
      working = working.trimStart().slice(match[0].length);
      continue;
    }
    if (tag === '/underline' || tag === '/u') {
      state.underline = false;
      working = working.trimStart().slice(match[0].length);
      continue;
    }
    if (tag === 'underline:thick' || tag === 'u:thick') {
      state.underlineThick = true;
      working = working.trimStart().slice(match[0].length);
      continue;
    }
    if (tag === 'invert') {
      state.invert = true;
      working = working.trimStart().slice(match[0].length);
      continue;
    }
    if (tag === '/invert') {
      state.invert = false;
      working = working.trimStart().slice(match[0].length);
      continue;
    }
    if (tag === 'double' || tag === 'size:double') {
      state.size = 'double';
      working = working.trimStart().slice(match[0].length);
      continue;
    }
    if (tag === 'wide' || tag === 'size:wide') {
      state.size = 'wide';
      working = working.trimStart().slice(match[0].length);
      continue;
    }
    if (tag === 'tall' || tag === 'size:tall') {
      state.size = 'tall';
      working = working.trimStart().slice(match[0].length);
      continue;
    }
    if (tag === 'normal' || tag === 'size:normal') {
      state.size = 'normal';
      working = working.trimStart().slice(match[0].length);
      continue;
    }
    const sizeMatch = tag.match(/^size:(\d)x(\d)$/);
    if (sizeMatch) {
      state.size = `${sizeMatch[1]}x${sizeMatch[2]}`;
      working = working.trimStart().slice(match[0].length);
      continue;
    }
    if (tag === 'font:a' || tag === 'fonta') {
      state.font = 'a';
      working = working.trimStart().slice(match[0].length);
      continue;
    }
    if (tag === 'font:b' || tag === 'fontb') {
      state.font = 'b';
      working = working.trimStart().slice(match[0].length);
      continue;
    }
    break;
  }

  return { state, text: working };
}

function alignLine(text, width, align) {
  const value = safeString(text, '');
  if (value.length >= width) return value.slice(0, width);
  if (align === 'center') {
    const left = Math.floor((width - value.length) / 2);
    return `${' '.repeat(left)}${value}`.padEnd(width);
  }
  if (align === 'right') return value.padStart(width);
  return value.padEnd(width);
}

function buildPreviewLines(template) {
  const width = 48;
  const itemWidth = Number(template.itemNameWidth || 24);
  const qtyWidth = Number(template.itemQtyWidth || 8);
  const priceWidth = Number(template.itemPriceWidth || 12);
  const lineChar = (template.lineChar || '-')[0] || '-';
  const itemAlign = template.itemAlign || 'left';
  const qtyAlign = template.qtyAlign || 'right';
  const priceAlign = template.priceAlign || 'right';
  const headerBold = template.headerBold !== false;
  const headerAlign = template.headerAlign || 'left';
  const totalBold = template.totalBold !== false;
  const totalAlign = template.totalAlign || 'right';
  const showItemNumbers = template.showItemNumbers === true;
  const itemNumberPrefix = template.itemNumberPrefix || '#';

  const data = {
    ...SAMPLE_BILL,
    title: template.title || '',
    subtitle: template.subtitle || '',
    contactLine: template.contactLine || '',
    footer: template.footer || '',
    itemHeader: template.itemHeader || 'ITEM',
    qtyHeader: template.qtyHeader || 'QTY',
    priceHeader: template.priceHeader || 'AMOUNT',
    totalText: template.totalText || 'TOTAL: Rs.',
    tokenPrefix: template.tokenPrefix || 'TOKEN',
    tablePrefix: template.tablePrefix || 'Table',
    cashierPrefix: template.cashierPrefix || 'Cashier',
    tableLabel: SAMPLE_BILL.tableLabel,
    cashierName: SAMPLE_BILL.cashierName,
  };

  const showTable = template.showTable === true;
  const showCashier = template.showCashier === true;

  const context = {
    ...data,
    itemHeaderRow: headerBold
      ? padCell(data.itemHeader, itemWidth, headerAlign).toUpperCase() + padCell(data.qtyHeader, qtyWidth, qtyAlign).toUpperCase() + padCell(data.priceHeader, priceWidth, priceAlign).toUpperCase()
      : padCell(data.itemHeader, itemWidth, headerAlign) + padCell(data.qtyHeader, qtyWidth, qtyAlign) + padCell(data.priceHeader, priceWidth, priceAlign),
    totalLine: replacePlaceholders(template.totalLineTemplate || '{{totalText}} {{total}}', {
      totalText: data.totalText,
      total: Number(data.total || 0).toFixed(2),
    }),
    itemHeaderPad: padCell(data.itemHeader, itemWidth, headerAlign),
    qtyHeaderPad: padCell(data.qtyHeader, qtyWidth, qtyAlign),
    priceHeaderPad: padCell(data.priceHeader, priceWidth, priceAlign),
    total: Number(data.total || 0).toFixed(2),
    tableLabel: showTable ? data.tableLabel : '',
    cashierName: showCashier ? data.cashierName : '',
  };

  const lines = [];
  const bodyTemplate = safeString(template.bodyTemplate || DEFAULT_TEMPLATE.bodyTemplate, '');

  splitLines(bodyTemplate).forEach((rawLine) => {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      lines.push({ text: '', bold: false, size: 'normal', align: 'left' });
      return;
    }
    if (/^\[blank(?::\d+)?\]$/i.test(trimmed)) {
      const match = trimmed.match(/^\[blank(?::(\d+))?\]$/i);
      const count = Math.max(1, Number(match?.[1] || 1));
      for (let index = 0; index < count; index += 1) lines.push({ text: '', bold: false, size: 'normal', align: 'left' });
      return;
    }

    const parsed = parseLeadingTags(rawLine);
    const { state } = parsed;
    let effectiveWidth = width;
    if (state.size === 'wide') {
      effectiveWidth = Math.floor(width * 12 / 14);
    } else if (state.size === 'double') {
      effectiveWidth = Math.floor(width * 12 / 20);
    } else if (state.size === 'tall') {
      effectiveWidth = Math.floor(width * 12 / 16);
    } else if (typeof state.size === 'string' && /^\dx\d$/.test(state.size)) {
      const h = Number(state.size[0]);
      const fontSize = h >= 5 ? 20 : h >= 3 ? 16 : h >= 2 ? 14 : 12;
      effectiveWidth = Math.floor(width * 12 / fontSize);
    }

    const afterTags = parsed.text.trim();

    if (/^\[line(?::([^\]]+))?\]$/i.test(afterTags)) {
      const match = afterTags.match(/^\[line(?::([^\]]+))?\]$/i);
      const char = match?.[1]?.[0] || lineChar;
      lines.push({ text: char.repeat(effectiveWidth), bold: state.bold, size: state.size, align: state.align });
      return;
    }
    if (/^\[cut\]$/i.test(afterTags)) {
      lines.push({ text: '--- CUT ---'.padStart(Math.floor(effectiveWidth / 2) + 8).padEnd(effectiveWidth), bold: state.bold, size: state.size, align: 'center' });
      return;
    }
    if (afterTags === '{{items}}') {
      SAMPLE_BILL.items.forEach((item, idx) => {
        const amount = Number(item.amount || item.unitPrice * item.quantity || 0).toFixed(2);
        const nameDisplay = showItemNumbers ? `${itemNumberPrefix}${idx + 1} ${item.name}` : item.name;
        const itemContext = {
          ...context,
          index: idx + 1,
          name: item.name,
          quantity: item.quantity,
          unitPrice: Number(item.unitPrice || 0).toFixed(2),
          amount,
          namePad: padCell(nameDisplay.slice(0, itemWidth), itemWidth, itemAlign),
          qtyPad: padCell(String(item.quantity), qtyWidth, qtyAlign),
          amountPad: padCell(amount, priceWidth, priceAlign),
          pricePad: padCell(amount, priceWidth, priceAlign),
        };
        const itemTemplate = template.itemLineTemplate || DEFAULT_TEMPLATE.itemLineTemplate;
        lines.push({ text: alignLine(replacePlaceholders(itemTemplate, itemContext), effectiveWidth, 'left'), bold: state.bold, underline: state.underline, underlineThick: state.underlineThick, invert: state.invert, size: state.size, font: state.font, align: 'left' });
      });
      return;
    }

    if (afterTags === '{{totalLine}}') {
      const rendered = replacePlaceholders('{{totalLine}}', context);
      const display = (totalBold || state.bold) ? rendered.toUpperCase() : rendered;
      lines.push({ text: alignLine(display, effectiveWidth, totalAlign), bold: totalBold || state.bold, underline: state.underline, underlineThick: state.underlineThick, invert: state.invert, size: state.size, font: state.font, align: totalAlign });
      return;
    }

    const rendered = replacePlaceholders(afterTags, context);
    if (!rendered.trim()) return;
    const display = state.bold ? rendered.toUpperCase() : rendered;
    lines.push({ text: alignLine(display, effectiveWidth, state.align), bold: state.bold, underline: state.underline, underlineThick: state.underlineThick, invert: state.invert, size: state.size, font: state.font, align: state.align });
  });

  return lines;
}

function Section({ title, defaultOpen, children }) {
  const [open, setOpen] = useState(defaultOpen !== false);
  return (
    <div className="surface-card rounded-xl border border-on-light">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-on-light uppercase">
        {title}
        <span className="text-muted text-xs">{open ? '\u25B2' : '\u25BC'}</span>
      </button>
      {open ? <div className="px-4 pb-4 space-y-3 border-t border-on-light pt-3">{children}</div> : null}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs uppercase text-muted mb-1">{label}</label>
      {children}
    </div>
  );
}

function TextInput({ value, onChange, ...props }) {
  return <input value={value ?? ''} onChange={(e) => onChange(e.target.value)} className="surface-input h-9 w-full rounded-lg px-3 text-sm" {...props} />;
}

function NumberInput({ value, onChange, min, max, ...props }) {
  return <input type="number" min={min} max={max} value={value ?? 0} onChange={(e) => onChange(Number(e.target.value || 0))} className="surface-input h-9 w-full rounded-lg px-3 text-sm" {...props} />;
}

function Toggle({ value, onChange, label }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border border-on-light px-3 py-2">
      <span className="text-sm text-on-light">{label}</span>
      <Checkbox checked={value === true} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function Select({ value, onChange, options }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} className="surface-input h-9 w-full rounded-lg px-3 text-sm">
      {options.map((opt) => {
        const val = typeof opt === 'string' ? opt : opt.value;
        const label = typeof opt === 'string' ? opt : opt.label;
        return <option key={val} value={val}>{label}</option>;
      })}
    </select>
  );
}

export default function ReceiptEditorPage() {
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
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
          setTemplate((prev) => ({ ...DEFAULT_TEMPLATE, ...prev, ...(data || {}) }));
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

  const previewLines = useMemo(() => buildPreviewLines(template), [template]);

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

  const resetTemplate = () => {
    setTemplate((prev) => {
      const kotFields = {};
      for (const key of Object.keys(prev)) {
        if (key.startsWith('kot')) kotFields[key] = prev[key];
      }
      return { ...DEFAULT_TEMPLATE, ...kotFields };
    });
    setMessage('Default receipt template restored. KOT settings preserved.');
    setError('');
  };

  const insertSnippet = (snippet) => {
    setTemplate((prev) => ({
      ...prev,
      bodyTemplate: `${prev.bodyTemplate || ''}\n${snippet}`.trim(),
    }));
  };

  if (loading) {
    return <section className="surface-card rounded-2xl p-6 text-sm text-muted">Loading...</section>;
  }

  const alignOpts = [
    { value: 'left', label: 'Left' },
    { value: 'center', label: 'Center' },
    { value: 'right', label: 'Right' },
  ];

  return (
    <section className="surface-card rounded-2xl p-5 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-black text-on-light">Receipt Editor</h2>
          <p className="text-sm text-muted mt-1">Full control over every part of the printed bill. Changes preview live on the right.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={resetTemplate}>Reset to Default</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save Template'}</Button>
        </div>
      </div>

      {error ? <p className="text-sm text-error">{error}</p> : null}
      {message ? <p className="text-sm text-success">{message}</p> : null}

      <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-5">
        <div className="space-y-3 max-h-[calc(100dvh-14rem)] overflow-y-auto pr-1">

          <Section title="Business Info" defaultOpen>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Business Name"><TextInput value={template.title} onChange={(v) => updateField('title', v)} placeholder="THE LASSI CORNER" /></Field>
              <Field label="Location / Address"><TextInput value={template.subtitle} onChange={(v) => updateField('subtitle', v)} placeholder="SJEC, VAMANJOOR" /></Field>
              <Field label="Contact Line"><TextInput value={template.contactLine} onChange={(v) => updateField('contactLine', v)} placeholder="Ph: 9876543210" /></Field>
              <Field label="Footer Text"><TextInput value={template.footer} onChange={(v) => updateField('footer', v)} placeholder="Thank you! Visit us again." /></Field>
            </div>
          </Section>

          <Section title="Receipt Details">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Token Prefix"><TextInput value={template.tokenPrefix} onChange={(v) => updateField('tokenPrefix', v)} placeholder="TOKEN" /></Field>
              <Field label="Total Label"><TextInput value={template.totalText} onChange={(v) => updateField('totalText', v)} placeholder="TOTAL: Rs." /></Field>
            </div>
            <Toggle value={template.showTable} onChange={(v) => updateField('showTable', v)} label="Show Table on Bill" />
            {template.showTable ? <Field label="Table Prefix"><TextInput value={template.tablePrefix} onChange={(v) => updateField('tablePrefix', v)} placeholder="Table" /></Field> : null}
            <Toggle value={template.showCashier} onChange={(v) => updateField('showCashier', v)} label="Show Cashier on Bill" />
            {template.showCashier ? <Field label="Cashier Prefix"><TextInput value={template.cashierPrefix} onChange={(v) => updateField('cashierPrefix', v)} placeholder="Cashier" /></Field> : null}
          </Section>

          <Section title="Item Columns">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Item Header"><TextInput value={template.itemHeader} onChange={(v) => updateField('itemHeader', v)} /></Field>
              <Field label="Qty Header"><TextInput value={template.qtyHeader} onChange={(v) => updateField('qtyHeader', v)} /></Field>
              <Field label="Price Header"><TextInput value={template.priceHeader} onChange={(v) => updateField('priceHeader', v)} /></Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Item Width"><NumberInput value={template.itemNameWidth} onChange={(v) => updateField('itemNameWidth', v)} min={8} max={40} /></Field>
              <Field label="Qty Width"><NumberInput value={template.itemQtyWidth} onChange={(v) => updateField('itemQtyWidth', v)} min={2} max={14} /></Field>
              <Field label="Price Width"><NumberInput value={template.itemPriceWidth} onChange={(v) => updateField('itemPriceWidth', v)} min={4} max={16} /></Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Item Align"><Select value={template.itemAlign} onChange={(v) => updateField('itemAlign', v)} options={alignOpts} /></Field>
              <Field label="Qty Align"><Select value={template.qtyAlign} onChange={(v) => updateField('qtyAlign', v)} options={alignOpts} /></Field>
              <Field label="Price Align"><Select value={template.priceAlign} onChange={(v) => updateField('priceAlign', v)} options={alignOpts} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Header Alignment"><Select value={template.headerAlign} onChange={(v) => updateField('headerAlign', v)} options={alignOpts} /></Field>
              <Field label="Total Alignment"><Select value={template.totalAlign} onChange={(v) => updateField('totalAlign', v)} options={alignOpts} /></Field>
            </div>
            <div className="grid grid-cols-1 gap-3">
              <Toggle value={template.headerBold} onChange={(v) => updateField('headerBold', v)} label="Bold Column Headers" />
            </div>
            <Toggle value={template.showItemNumbers} onChange={(v) => updateField('showItemNumbers', v)} label="Show Item Numbers" />
            {template.showItemNumbers ? <Field label="Number Prefix"><TextInput value={template.itemNumberPrefix} onChange={(v) => updateField('itemNumberPrefix', v)} placeholder="#" /></Field> : null}
          </Section>

          <Section title="Item Row Template">
            <textarea
              value={template.itemLineTemplate ?? ''}
              onChange={(e) => updateField('itemLineTemplate', e.target.value)}
              rows={2}
              className="surface-input w-full rounded-lg px-3 py-2 font-mono text-xs leading-5"
              spellCheck="false"
            />
            <p className="text-xs text-muted">
              Variables: <span className="font-mono">{'{{namePad}}'}</span>{' '}
              <span className="font-mono">{'{{qtyPad}}'}</span>{' '}
              <span className="font-mono">{'{{amountPad}}'}</span>{' '}
              <span className="font-mono">{'{{name}}'}</span>{' '}
              <span className="font-mono">{'{{quantity}}'}</span>{' '}
              <span className="font-mono">{'{{unitPrice}}'}</span>{' '}
              <span className="font-mono">{'{{amount}}'}</span>{' '}
              <span className="font-mono">{'{{index}}'}</span>
            </p>
            <Field label="Header Row Template">
              <textarea
                value={template.itemHeaderLineTemplate ?? ''}
                onChange={(e) => updateField('itemHeaderLineTemplate', e.target.value)}
                rows={2}
                className="surface-input w-full rounded-lg px-3 py-2 font-mono text-xs leading-5"
                spellCheck="false"
              />
            </Field>
            <Field label="Total Line Template">
              <TextInput value={template.totalLineTemplate} onChange={(v) => updateField('totalLineTemplate', v)} />
            </Field>
            <Field label="Divider Character">
              <TextInput value={template.lineChar} onChange={(v) => updateField('lineChar', v)} placeholder="-" />
            </Field>
          </Section>

          <Section title="Body Template">
            <div className="flex flex-wrap gap-1.5 mb-2">
              <Button size="sm" variant="secondary" onClick={() => insertSnippet('[blank:1]')}>Blank</Button>
              <Button size="sm" variant="secondary" onClick={() => insertSnippet('[line]')}>Divider</Button>
              <Button size="sm" variant="secondary" onClick={() => insertSnippet('[cut]')}>Cut</Button>
              <Button size="sm" variant="secondary" onClick={() => insertSnippet('{{items}}')}>Items</Button>
              <Button size="sm" variant="secondary" onClick={() => insertSnippet('[center][bold]{{title}}')}>Title</Button>
              <Button size="sm" variant="secondary" onClick={() => insertSnippet('[center]{{subtitle}}')}>Subtitle</Button>
              <Button size="sm" variant="secondary" onClick={() => insertSnippet('[center]{{contactLine}}')}>Contact</Button>
              <Button size="sm" variant="secondary" onClick={() => insertSnippet('[left]{{tablePrefix}}: {{tableLabel}}')}>Table</Button>
              <Button size="sm" variant="secondary" onClick={() => insertSnippet('[left]{{cashierPrefix}}: {{cashierName}}')}>Cashier</Button>
              <Button size="sm" variant="secondary" onClick={() => insertSnippet('{{totalLine}}')}>Total</Button>
              <Button size="sm" variant="secondary" onClick={() => insertSnippet('[center]{{footer}}')}>Footer</Button>
              <Button size="sm" variant="secondary" onClick={() => insertSnippet('[bold][/bold]')}>Bold</Button>
              <Button size="sm" variant="secondary" onClick={() => insertSnippet('[underline][/underline]')}>Underline</Button>
              <Button size="sm" variant="secondary" onClick={() => insertSnippet('[double]')}>Double</Button>
              <Button size="sm" variant="secondary" onClick={() => insertSnippet('[invert][/invert]')}>Invert</Button>
            </div>
            <textarea
              value={template.bodyTemplate ?? ''}
              onChange={(e) => updateField('bodyTemplate', e.target.value)}
              rows={20}
              className="surface-input w-full rounded-xl px-4 py-3 font-mono text-xs leading-6 min-h-[400px]"
              spellCheck="false"
            />
            <p className="text-xs text-muted">
              Tags: <span className="font-mono">[center]</span>{' '}
              <span className="font-mono">[left]</span>{' '}
              <span className="font-mono">[right]</span>{' '}
              <span className="font-mono">[bold]</span>{' '}
              <span className="font-mono">[/bold]</span>{' '}
              <span className="font-mono">[underline]</span>{' '}
              <span className="font-mono">[/underline]</span>{' '}
              <span className="font-mono">[underline:thick]</span>{' '}
              <span className="font-mono">[invert]</span>{' '}
              <span className="font-mono">[/invert]</span>{' '}
              <span className="font-mono">[double]</span>{' '}
              <span className="font-mono">[wide]</span>{' '}
              <span className="font-mono">[tall]</span>{' '}
              <span className="font-mono">[normal]</span>{' '}
              <span className="font-mono">[size:HxW]</span>{' '}
              <span className="font-mono">[font:a]</span>{' '}
              <span className="font-mono">[font:b]</span>{' '}
              <span className="font-mono">[blank:n]</span>{' '}
              <span className="font-mono">[line]</span>{' '}
              <span className="font-mono">[line:=]</span>{' '}
              <span className="font-mono">[cut]</span>
            </p>
          </Section>
        </div>

        <div className="space-y-4">
          <div className="surface-card rounded-xl border border-on-light p-4 space-y-3 sticky top-4">
            <h3 className="text-sm font-semibold text-on-light uppercase">Live Preview</h3>
            <div className="bg-white text-black rounded-xl p-4 font-mono text-xs leading-5 whitespace-pre overflow-x-hidden overflow-y-auto border border-black/10 shadow-inner max-h-[calc(100dvh-18rem)] w-[52ch] mx-auto">
              {previewLines.map((line, index) => {
                const text = line.text ?? line;
                const bold = line.bold || false;
                const underline = line.underline || false;
                const underlineThick = line.underlineThick || false;
                const invert = line.invert || false;
                const size = line.size || 'normal';
                const font = line.font || 'a';
                let sizeClass = '';
                if (size === 'double') sizeClass = 'text-xl';
                else if (size === 'wide') sizeClass = 'text-sm tracking-wide';
                else if (size === 'tall') sizeClass = 'text-base';
                else if (typeof size === 'string' && /^\dx\d$/.test(size)) {
                  const h = Number(size[0]);
                  sizeClass = h >= 5 ? 'text-xl' : h >= 3 ? 'text-base' : h >= 2 ? 'text-sm' : '';
                }
                const classes = [
                  bold ? 'font-bold' : '',
                  underline ? 'underline' : '',
                  underlineThick ? 'underline decoration-2' : '',
                  invert ? 'bg-black text-white' : '',
                  font === 'b' ? 'text-[10px]' : '',
                  sizeClass,
                ].filter(Boolean).join(' ');
                return (
                  <div key={index} className={classes || undefined}>
                    {text || '\u00A0'}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="surface-card rounded-xl border border-on-light p-4 space-y-3">
            <h3 className="text-sm font-semibold text-on-light uppercase">Available Placeholders</h3>
            <div className="text-xs text-muted space-y-1.5 font-mono">
              <p>{'{{title}}'} {'{{subtitle}}'} {'{{contactLine}}'} {'{{footer}}'}</p>
              <p>{'{{token}}'} {'{{tokenPrefix}}'} {'{{dateTime}}'} {'{{billNo}}'}</p>
              <p>{'{{tableLabel}}'} {'{{tablePrefix}}'} {'{{cashierName}}'} {'{{cashierPrefix}}'}</p>
              <p>{'{{items}}'} {'{{itemHeaderRow}}'} {'{{totalLine}}'} {'{{total}}'}</p>
              <p>{'{{itemHeaderPad}}'} {'{{qtyHeaderPad}}'} {'{{priceHeaderPad}}'}</p>
              <p>{'{{itemHeader}}'} {'{{qtyHeader}}'} {'{{priceHeader}}'} {'{{totalText}}'}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
