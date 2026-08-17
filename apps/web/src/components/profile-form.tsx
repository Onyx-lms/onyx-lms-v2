'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Profile {
  name: string | null; email: string; phone: string | null;
  address: string | null; about: string | null; skills: string[];
}

export function ProfileForm({ profile, mode = 'details' }: {
  profile: Profile;
  mode?: 'details' | 'password';
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [level, setLevel] = useState<'error' | 'success'>('success');
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setErrors({}); setMessage('');
    const form = new FormData(e.currentTarget);
    const raw = Object.fromEntries(form) as Record<string, string>;

    const path = mode === 'password' ? '/me/password' : '/me';
    const method = mode === 'password' ? 'POST' : 'PATCH';
    const payload = mode === 'password'
      ? raw
      // Skills are a comma-separated field in the UI but an array in the column.
      : { ...raw, skills: (raw.skills ?? '').split(',').map((s) => s.trim()).filter(Boolean) };

    const res = await fetch('/api/proxy' + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({ message: 'Something went wrong.' }));
    setBusy(false);
    setLevel(res.ok ? 'success' : 'error');
    setErrors(body.errors ?? {});
    setMessage(body.message ?? (res.ok ? 'Saved.' : 'Could not save.'));
    if (res.ok) {
      if (mode === 'password') e.currentTarget.reset();
      router.refresh();
    }
  }

  const field = (name: string, label: string, opts: {
    type?: string; defaultValue?: string; textarea?: boolean;
  } = {}) => (
    <div>
      <label htmlFor={name} className="block text-sm font-medium text-slate-700">{label}</label>
      {opts.textarea ? (
        <textarea id={name} name={name} rows={3} defaultValue={opts.defaultValue ?? ''}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500" />
      ) : (
        <input id={name} name={name} type={opts.type ?? 'text'} defaultValue={opts.defaultValue ?? ''}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500" />
      )}
      {errors[name] && <p className="mt-1 text-xs text-red-600">{errors[name]![0]}</p>}
    </div>
  );

  return (
    <form onSubmit={submit} className="mt-4 space-y-4">
      {mode === 'details' ? (
        <>
          {field('name', 'Full name', { defaultValue: profile.name ?? '' })}
          {field('phone', 'Phone', { defaultValue: profile.phone ?? '' })}
          {field('address', 'Address', { defaultValue: profile.address ?? '', textarea: true })}
          {field('about', 'About you', { defaultValue: profile.about ?? '', textarea: true })}
          {field('skills', 'Skills (comma separated)',
            { defaultValue: (profile.skills ?? []).join(', ') })}
        </>
      ) : (
        <>
          {field('current_password', 'Current password', { type: 'password' })}
          {field('password', 'New password', { type: 'password' })}
        </>
      )}

      <button className="btn-primary" disabled={busy}>
        {busy ? 'Saving' : mode === 'password' ? 'Update password' : 'Save changes'}
      </button>
      {message && (
        <p className={`text-sm ${level === 'error' ? 'text-red-600' : 'text-green-700'}`}>{message}</p>
      )}
    </form>
  );
}
