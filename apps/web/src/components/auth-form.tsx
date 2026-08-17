'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface AuthField {
  name: string;
  label: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  defaultValue?: string;
}

/**
 * Shared form for login / register / forgot / reset.
 *
 * Renders the API's field-keyed validation errors next to the offending input,
 * which is what the Laravel screens did with $errors.
 */
export function AuthForm({ action, fields, submitLabel, redirectTo, onDone }: {
  action: string;
  fields: AuthField[];
  submitLabel: string;
  redirectTo?: string;
  onDone?: 'message';
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [level, setLevel] = useState<'error' | 'success'>('error');
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setMessage('');
    const payload = Object.fromEntries(new FormData(e.currentTarget));

    const res = await fetch(`/api/web/auth/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({ message: 'Something went wrong.' }));
    setBusy(false);

    if (!res.ok) {
      setLevel('error');
      setErrors(body.errors ?? {});
      setMessage(body.message ?? 'Something went wrong.');
      return;
    }

    setLevel('success');
    setMessage(body.message ?? 'Done.');
    if (onDone === 'message') return;
    // The API decides where each role belongs; fall back to the caller's hint.
    router.push(body.data?.redirect_to ?? redirectTo ?? '/');
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {fields.map((f) => (
        <div key={f.name}>
          <label htmlFor={f.name} className="block text-sm font-medium text-slate-700">
            {f.label}
          </label>
          <input
            id={f.name}
            name={f.name}
            type={f.type ?? 'text'}
            autoComplete={f.autoComplete}
            required={f.required ?? true}
            defaultValue={f.defaultValue}
            aria-invalid={Boolean(errors[f.name])}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
          {errors[f.name] && (
            <p className="mt-1 text-xs text-red-600">{errors[f.name]![0]}</p>
          )}
        </div>
      ))}

      <button type="submit" disabled={busy} className="btn-primary w-full disabled:opacity-60">
        {busy ? 'Please wait' : submitLabel}
      </button>

      {message && (
        <p className={`text-sm ${level === 'error' ? 'text-red-600' : 'text-green-700'}`}>
          {message}
        </p>
      )}
    </form>
  );
}
