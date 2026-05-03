import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ToastProvider';
import ipcService from '@/services/ipcService';

export default function LoginPage({ onLogin, loading }) {
  const [method, setMethod] = useState('password');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const loginCardMuted = 'var(--text-on-dark)';
  const loginErrorColor = 'var(--text-on-dark)';
  const loginInputStyle = {
    backgroundColor: 'var(--bg-card)',
    color: 'var(--text-on-light)',
    border: '1.5px solid var(--border-on-light)',
  };
  const selectedMethodButtonStyle = {
    backgroundColor: 'var(--btn-secondary-bg)',
    color: 'var(--btn-secondary-text)',
    borderColor: 'var(--btn-secondary-border)',
  };
  const unselectedMethodButtonStyle = {
    backgroundColor: 'transparent',
    color: 'var(--text-on-dark)',
    borderColor: 'var(--border-on-dark)',
  };
  const submitButtonStyle = {
    backgroundColor: 'var(--btn-secondary-bg)',
    color: 'var(--btn-secondary-text)',
    borderColor: 'var(--btn-secondary-border)',
  };
  const exitButtonStyle = {
    backgroundColor: 'transparent',
    color: 'var(--text-on-dark)',
    borderColor: 'var(--border-on-dark)',
  };

  const submit = (event) => {
    event.preventDefault();
    if (method === 'pin') {
      onLogin({ method: 'pin', pin: pin.trim() });
      return;
    }

    onLogin({ method: 'password', username: username.trim(), password });
  };

  const handleExit = () => {
    ipcService.send('exit-app');
  };

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center p-6 relative overflow-hidden"
      style={{ backgroundColor: 'var(--bg-app)', color: 'var(--text-on-light)' }}
    >
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage: 'radial-gradient(circle at 25% 25%, var(--color-a) 2px, transparent 2px), radial-gradient(circle at 75% 75%, var(--color-a) 1.5px, transparent 1.5px)',
          backgroundSize: '60px 60px, 40px 40px',
        }}
      />
      <div
        className="w-full max-w-md rounded-2xl p-8 relative z-10"
        style={{
          backgroundColor: 'var(--color-a)',
          color: 'var(--text-on-dark)',
          border: '2px solid var(--border-on-dark)',
        }}
      >
        <p
          className="text-xs uppercase tracking-[0.3em] font-semibold mb-3"
          style={{ color: 'var(--text-on-dark)' }}
        >
          ViperCore
        </p>
        <h1 className="text-3xl font-black mb-2" style={{ color: 'var(--text-on-dark)' }}>
          Welcome Back
        </h1>
        <p className="text-sm mb-6" style={{ color: loginCardMuted, opacity: 0.72 }}>
          Sign in to continue to your billing dashboard.
        </p>

        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="secondary"
              className="hover:opacity-90"
              onClick={() => setMethod('password')}
              disabled={loading}
              style={method === 'password'
                ? selectedMethodButtonStyle
                : unselectedMethodButtonStyle}
            >
              Username + Password
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="hover:opacity-90"
              onClick={() => setMethod('pin')}
              disabled={loading}
              style={method === 'pin'
                ? selectedMethodButtonStyle
                : unselectedMethodButtonStyle}
            >
              PIN Login
            </Button>
          </div>

          {method === 'password' ? (
            <>
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-on-dark)' }}>
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full h-11 rounded-lg px-3 text-sm outline-none"
              style={loginInputStyle}
              placeholder="Enter your username"
              autoFocus
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-on-dark)' }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full h-11 rounded-lg px-3 text-sm outline-none"
              style={loginInputStyle}
              placeholder="Enter your password"
              required
            />
          </div>
            </>
          ) : (
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-on-dark)' }}>
                PIN
              </label>
              <input
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D+/g, '').slice(0, 8))}
                className="w-full h-11 rounded-lg px-3 text-sm outline-none"
                style={loginInputStyle}
                placeholder="Enter your PIN"
                required
              />
              <p className="text-xs mt-1" style={{ color: loginCardMuted, opacity: 0.72 }}>
                PIN should be 4 to 8 digits.
              </p>
            </div>
          )}

          {/* Error display removed - now using toast notifications */}

          <Button type="submit" size="lg" className="w-full hover:opacity-90" style={submitButtonStyle} disabled={loading}>
            {loading ? 'Signing in...' : 'Sign in'}
          </Button>

          <Button type="button" variant="secondary" size="lg" className="w-full hover:opacity-90" style={exitButtonStyle} onClick={handleExit} disabled={loading}>
            Exit App
          </Button>
        </form>
      </div>
    </div>
  );
}