import { useState } from 'react';
import { Button } from '@/components/ui/button';
import ipcService from '@/services/ipcService';
import OfflineBanner from '@/components/OfflineBanner';
import useNetworkStatus from '@/hooks/useNetworkStatus';

const initialForm = {
  setupUsername: '',
  setupPassword: '',
  supabaseProjectUrl: 'https://cjkbjnazwewpnzypgber.supabase.co',
  supabaseAnonKey: '',
  activationKey: '',
  createSubscription: false,
  tenantId: '',
  tenantName: '',
  tenantLocation: '',
  contactName: '',
  contactPhone: '',
  contactEmail: '',
  contactAddress: '',
  masterPin: '',
  adminName: '',
  adminUsername: '',
  adminPassword: '',
};

const STEPS = [
  {
    key: 'setupAccess',
    title: 'One-Time Setup Access',
    subtitle: 'Use temporary provisioning credentials and connect to Supabase.',
    fields: ['setupUsername', 'setupPassword', 'supabaseProjectUrl', 'supabaseAnonKey'],
  },
  {
    key: 'activation',
    title: 'Activation',
    subtitle: 'Enter activation key and set the master PIN.',
    fields: ['activationKey', 'masterPin'],
  },
  {
    key: 'tenant',
    title: 'Tenant Details',
    subtitle: 'Basic tenant identity and location info.',
    fields: ['tenantId', 'tenantName', 'tenantLocation'],
  },
  {
    key: 'contact',
    title: 'Contact Details',
    subtitle: 'Support and business contact details.',
    fields: ['contactName', 'contactPhone'],
  },
  {
    key: 'admin',
    title: 'Admin Account',
    subtitle: 'Create the initial admin username and password.',
    fields: ['adminName', 'adminUsername', 'adminPassword'],
  },
];

export default function SetupPage({ onSetupComplete }) {
  const { isOnline } = useNetworkStatus();
  const [form, setForm] = useState(initialForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [stepIndex, setStepIndex] = useState(0);
  const [animationKey, setAnimationKey] = useState(0);

  const setField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const submit = async (event) => {
    event.preventDefault();

    if (!isOnline) {
      setError('No internet connection. Initial setup requires an active WiFi or network connection.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const appIdentity = await ipcService.invoke('get-app-identity').catch(() => null);
      const result = await ipcService.invoke('initialize-app-setup', {
        ...form,
        setupUsername: form.setupUsername.trim(),
        setupPassword: form.setupPassword,
        supabaseProjectUrl: form.supabaseProjectUrl.trim(),
        supabaseAnonKey: form.supabaseAnonKey.trim(),
        activationKey: form.activationKey.trim().toUpperCase(),
        tenantId: form.tenantId.trim(),
        tenantName: form.tenantName.trim(),
        tenantLocation: form.tenantLocation.trim(),
        contactName: form.contactName.trim(),
        contactPhone: form.contactPhone.trim(),
        contactEmail: form.contactEmail.trim(),
        contactAddress: form.contactAddress.trim(),
        masterPin: form.masterPin.trim(),
      createSubscription: Boolean(form.createSubscription),
        adminName: form.adminName.trim(),
        adminUsername: form.adminUsername.trim(),
        adminPassword: form.adminPassword,
        appInstanceId: appIdentity?.appInstanceId || '',
        appVersion: appIdentity?.appVersion || '',
        platform: appIdentity?.platform || '',
        arch: appIdentity?.arch || '',
      });

      if (!result?.success) {
        setError(result?.message || 'Setup failed.');
        setForm((prev) => ({ ...prev, setupPassword: '' }));
        return;
      }

      setForm(initialForm);
      onSetupComplete?.(result.user);
    } catch (setupError) {
      console.error('Setup failed:', setupError);
      setError('Setup failed. Please try again.');
      setForm((prev) => ({ ...prev, setupPassword: '' }));
    } finally {
      setSaving(false);
    }
  };

  const currentStep = STEPS[stepIndex];
  const isLastStep = stepIndex === STEPS.length - 1;

  const validateStep = (index) => {
    const step = STEPS[index];
    if (!step) return true;

    for (const field of step.fields) {
      if (!String(form[field] || '').trim()) {
        setError(`Please fill all required fields in "${step.title}".`);
        return false;
      }
    }

    if (step.key === 'activation' && !/^\d{4,8}$/.test(form.masterPin.trim())) {
      setError('Master PIN must be 4 to 8 digits.');
      return false;
    }

    if (step.key === 'admin' && form.adminPassword.length < 6) {
      setError('Admin password must be at least 6 characters.');
      return false;
    }

    setError('');
    return true;
  };

  const goNext = () => {
    if (!validateStep(stepIndex)) return;
    if (isLastStep) return;
    setStepIndex((prev) => prev + 1);
    setAnimationKey((prev) => prev + 1);
  };

  const goBack = () => {
    if (stepIndex === 0) return;
    setError('');
    setStepIndex((prev) => prev - 1);
    setAnimationKey((prev) => prev + 1);
  };

  return (
    <div className="min-h-screen w-full p-6 md:p-10" style={{ backgroundColor: 'var(--bg-app)', color: 'var(--text-on-light)' }}>
      <div className="max-w-3xl mx-auto min-h-[calc(100vh-3rem)] md:min-h-[calc(100vh-5rem)] flex items-center justify-center py-6">
        <div className="w-full space-y-4">
        <div>
          <p className="text-xs uppercase tracking-[0.35em]" style={{ color: 'var(--text-muted)' }}>Initial Setup</p>
          <h1 className="text-3xl font-black mt-2">Activate and Configure Your POS</h1>
          <p className="text-sm mt-2" style={{ color: 'var(--text-muted)' }}>
            This runs once on first install. Complete each step in order.
          </p>
        </div>

        {!isOnline ? (
          <div className="space-y-2">
            <OfflineBanner />
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Initial setup connects to Supabase to register your tenant and activate your license.
            </p>
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          {STEPS.map((step, index) => (
            <div key={step.key} className="flex items-center gap-2">
              <div
                className="h-2.5 rounded-full transition-all"
                style={{
                  width: index === stepIndex ? '2.5rem' : '0.75rem',
                  backgroundColor: index <= stepIndex ? 'var(--text-on-light)' : 'var(--border-subtle)',
                }}
              />
            </div>
          ))}
          <p className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>
            Step {stepIndex + 1} of {STEPS.length}
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <section key={animationKey} className="surface-card rounded-2xl p-6 space-y-4 setup-step-enter">
            <div>
              <h2 className="text-xl font-black">{currentStep.title}</h2>
              <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>{currentStep.subtitle}</p>
            </div>

            {currentStep.key === 'setupAccess' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs uppercase text-muted mb-1">Setup Username</label>
                  <input value={form.setupUsername} onChange={(e) => setField('setupUsername', e.target.value)} className="surface-input h-10 w-full rounded-lg px-3" required />
                </div>
                <div>
                  <label className="block text-xs uppercase text-muted mb-1">Setup Password</label>
                  <input type="password" value={form.setupPassword} onChange={(e) => setField('setupPassword', e.target.value)} className="surface-input h-10 w-full rounded-lg px-3" required />
                </div>
                <div>
                  <label className="block text-xs uppercase text-muted mb-1">Supabase Project URL</label>
                  <input value={form.supabaseProjectUrl} onChange={(e) => setField('supabaseProjectUrl', e.target.value)} className="surface-input h-10 w-full rounded-lg px-3" required />
                </div>
                <div>
                  <label className="block text-xs uppercase text-muted mb-1">Supabase Anon Key</label>
                  <input type="password" value={form.supabaseAnonKey} onChange={(e) => setField('supabaseAnonKey', e.target.value)} className="surface-input h-10 w-full rounded-lg px-3" required />
                </div>
              </div>
            )}

            {currentStep.key === 'activation' && (
              <div className="space-y-3 max-w-xl">
                <div>
                  <label className="block text-xs uppercase text-muted mb-1">Activation Key</label>
                  <input value={form.activationKey} onChange={(e) => setField('activationKey', e.target.value.toUpperCase())} className="surface-input h-10 w-full rounded-lg px-3 font-mono" placeholder="ABCDE-ABCDE-ABCDE-ABCDE" required />
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Use the 5-block activation key format only.</p>
                </div>
                <div>
                  <label className="block text-xs uppercase text-muted mb-1">Master PIN</label>
                  <input type="password" value={form.masterPin} onChange={(e) => setField('masterPin', e.target.value.replace(/\D+/g, '').slice(0, 8))} className="surface-input h-10 w-full rounded-lg px-3" placeholder="4 to 8 digits" required />
                </div>
                <label className="flex items-start gap-3 rounded-xl border border-[color:var(--border-subtle)] px-4 py-3">
                  <input
                    type="checkbox"
                    checked={form.createSubscription}
                    onChange={(e) => setField('createSubscription', e.target.checked)}
                    className="mt-1 h-4 w-4"
                  />
                  <span className="text-sm leading-5">
                    Add a subscription for this tenant. If enabled, it starts now and expires after 1 year.
                  </span>
                </label>
              </div>
            )}

            {currentStep.key === 'tenant' && (
              <div className="space-y-3 max-w-xl">
                <div>
                  <label className="block text-xs uppercase text-muted mb-1">Tenant ID</label>
                  <input value={form.tenantId} onChange={(e) => setField('tenantId', e.target.value)} className="surface-input h-10 w-full rounded-lg px-3" required />
                </div>
                <div>
                  <label className="block text-xs uppercase text-muted mb-1">Tenant Name</label>
                  <input value={form.tenantName} onChange={(e) => setField('tenantName', e.target.value)} className="surface-input h-10 w-full rounded-lg px-3" required />
                </div>
                <div>
                  <label className="block text-xs uppercase text-muted mb-1">Tenant Location</label>
                  <input value={form.tenantLocation} onChange={(e) => setField('tenantLocation', e.target.value)} className="surface-input h-10 w-full rounded-lg px-3" required />
                </div>
              </div>
            )}

            {currentStep.key === 'contact' && (
              <div className="space-y-3 max-w-xl">
                <div>
                  <label className="block text-xs uppercase text-muted mb-1">Contact Name</label>
                  <input value={form.contactName} onChange={(e) => setField('contactName', e.target.value)} className="surface-input h-10 w-full rounded-lg px-3" required />
                </div>
                <div>
                  <label className="block text-xs uppercase text-muted mb-1">Phone</label>
                  <input value={form.contactPhone} onChange={(e) => setField('contactPhone', e.target.value)} className="surface-input h-10 w-full rounded-lg px-3" required />
                </div>
                <div>
                  <label className="block text-xs uppercase text-muted mb-1">Email</label>
                  <input type="email" value={form.contactEmail} onChange={(e) => setField('contactEmail', e.target.value)} className="surface-input h-10 w-full rounded-lg px-3" />
                </div>
                <div>
                  <label className="block text-xs uppercase text-muted mb-1">Address</label>
                  <input value={form.contactAddress} onChange={(e) => setField('contactAddress', e.target.value)} className="surface-input h-10 w-full rounded-lg px-3" />
                </div>
              </div>
            )}

            {currentStep.key === 'admin' && (
              <div className="space-y-3 max-w-xl">
                <div>
                  <label className="block text-xs uppercase text-muted mb-1">Admin Name</label>
                  <input value={form.adminName} onChange={(e) => setField('adminName', e.target.value)} className="surface-input h-10 w-full rounded-lg px-3" required />
                </div>
                <div>
                  <label className="block text-xs uppercase text-muted mb-1">Admin Username</label>
                  <input value={form.adminUsername} onChange={(e) => setField('adminUsername', e.target.value)} className="surface-input h-10 w-full rounded-lg px-3" required />
                </div>
                <div>
                  <label className="block text-xs uppercase text-muted mb-1">Admin Password</label>
                  <input type="password" value={form.adminPassword} onChange={(e) => setField('adminPassword', e.target.value)} className="surface-input h-10 w-full rounded-lg px-3" required />
                </div>
              </div>
            )}
          </section>

          <div className="flex items-center justify-between">
            {error ? <p className="text-sm text-error">{error}</p> : <span />}
            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" onClick={goBack} disabled={stepIndex === 0 || saving}>Back</Button>
              {!isLastStep ? (
                <Button type="button" onClick={goNext} disabled={saving}>Next</Button>
              ) : (
                <Button type="submit" disabled={saving || !isOnline}>{saving ? 'Setting up...' : 'Complete Setup'}</Button>
              )}
            </div>
          </div>
        </form>
        </div>
      </div>
    </div>
  );
}
