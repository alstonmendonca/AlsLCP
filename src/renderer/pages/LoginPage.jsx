import { useState } from 'react';
import { Button } from '@/components/ui/button';

export default function LoginPage({ onLogin, loading, error }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const submit = (event) => {
    event.preventDefault();
    onLogin({ username: username.trim(), password });
  };

  return (
    <div className="min-h-screen w-full bg-[radial-gradient(circle_at_top_left,_#134e4a_0%,_#0f172a_45%,_#020617_100%)] flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-white/15 bg-white/95 backdrop-blur shadow-2xl p-8">
        <p className="text-xs tracking-[0.3em] text-[#0f766e] uppercase mb-3">Lassi Corner POS</p>
        <h1 className="text-3xl font-black text-[#0f172a] mb-2">Welcome Back</h1>
        <p className="text-sm text-slate-600 mb-6">Sign in to continue to your billing dashboard.</p>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full h-11 rounded-lg border border-slate-300 px-3 text-slate-900 outline-none focus:ring-2 focus:ring-[#0f766e]"
              placeholder="Enter your username"
              autoFocus
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full h-11 rounded-lg border border-slate-300 px-3 text-slate-900 outline-none focus:ring-2 focus:ring-[#0f766e]"
              placeholder="Enter your password"
              required
            />
          </div>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <Button type="submit" size="lg" className="w-full" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign in'}
          </Button>
        </form>
      </div>
    </div>
  );
}
