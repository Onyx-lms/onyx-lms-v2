'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function NewUserButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState('');

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setErrors({}); setMessage('');
    const f = new FormData(e.currentTarget);
    const res = await fetch('/api/proxy/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: String(f.get('name') ?? ''),
        email: String(f.get('email') ?? ''),
        password: String(f.get('password') ?? ''),
        role: String(f.get('role') ?? 'student'),
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setErrors(body.errors ?? {});
      setMessage(body.message ?? 'Could not create the user.');
      return;
    }
    setOpen(false);
    router.refresh();
  }

  if (!open) return <button className="btn-primary" onClick={() => setOpen(true)}>New user</button>;

  const field = (name: string, label: string, type = 'text') => (
    <div>
      <label className="block text-sm font-medium">{label}</label>
      <input name={name} type={type} required
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      {errors[name] && <p className="mt-1 text-xs text-red-600">{errors[name]![0]}</p>}
    </div>
  );

  return (
    <form onSubmit={create} className="card max-w-md space-y-3 p-4">
      {field('name', 'Full name')}
      {field('email', 'Email address', 'email')}
      {field('password', 'Password', 'password')}
      <div>
        <label className="block text-sm font-medium">Role</label>
        <select name="role" defaultValue="student"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
          {['student', 'instructor', 'admin'].map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy}>{busy ? 'Creating' : 'Create user'}</button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {message && <p className="text-sm text-red-600">{message}</p>}
    </form>
  );
}
