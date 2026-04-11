import { useState } from 'react';
import { Button } from '@/components/ui/button';
import ipcService from '@/services/ipcService';

export default function LoginPage({ onLogin, loading, error }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const submit = (event) => {
    event.preventDefault();
    onLogin({ username: username.trim(), password });
  };

  const handleExit = () => {
    ipcService.send('exit-app');
  };

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center p-6"
      style={{ backgroundColor: 'var(--bg-app)', color: 'var(--text-on-light)' }}
    >
      <div
        className="w-full max-w-md rounded-2xl p-8"
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
          Lassi Corner POS
        </p>
        <h1 className="text-3xl font-black mb-2" style={{ color: 'var(--text-on-light)' }}>
          Welcome Back
        </h1>
        <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
          Sign in to continue to your billing dashboard.
        </p>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-on-light)' }}>
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full h-11 rounded-lg px-3 text-sm outline-none"
              style={{
                backgroundColor: 'var(--bg-card)',
                color: 'var(--text-on-light)',
                border: '1.5px solid var(--border-on-light)',
              }}
              placeholder="Enter your username"
              autoFocus
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-on-light)' }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full h-11 rounded-lg px-3 text-sm outline-none"
              style={{
                backgroundColor: 'var(--bg-card)',
                color: 'var(--text-on-light)',
                border: '1.5px solid var(--border-on-light)',
              }}
              placeholder="Enter your password"
              required
            />
          </div>

          {error && (
            <p className="text-sm" style={{ color: 'var(--status-error)' }}>{error}</p>
          )}

          <Button type="submit" size="lg" className="w-full" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign in'}
          </Button>

          <Button type="button" variant="secondary" size="lg" className="w-full" onClick={handleExit} disabled={loading}>
            Exit App
          </Button>
        </form>
      </div>
    </div>
  );
}