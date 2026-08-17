'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface Field {
  key: string;
  label: string;
  type?: 'text' | 'email' | 'password' | 'number' | 'textarea' | 'select';
  options?: { value: string; label: string }[];
  hint?: string;
}

/**
 * SET-01..SET-05 -- one settings screen.
 *
 * A password field renders empty even when a value is stored; submitting it
 * blank leaves the stored secret alone, which is what the server does too.
 */
export function SettingsForm({ group, fields, values }: {
  group: string;
  fields: Field[];
  values: Record<string, unknown>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  return (
    <form className="card max-w-3xl space-y-4 p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const body: Record<string, string> = {};
        for (const field of fields) {
          const raw = f.get(field.key);
          if (raw === null) continue;
          const text = String(raw);
          // An untouched password posts blank; sending it would be a no-op on
          // the server, but leaving it out keeps the intent obvious.
          if (field.type === 'password' && text === '') continue;
          body[field.key] = text;
        }
        setBusy(true); setMessage('');
        const res = await fetch('/api/proxy/admin/settings/' + group, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const payload = await res.json().catch(() => ({}));
        setBusy(false);
        setMessage(payload.message ?? (res.ok ? 'Saved.' : 'Could not save.'));
        if (res.ok) router.refresh();
      }}>
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((field) => {
          const stored = values[field.key];
          const isSet = values[field.key + '_set'] === true;
          return (
            <div key={field.key}
              className={field.type === 'textarea' ? 'sm:col-span-2' : ''}>
              <label className="block text-sm font-medium">{field.label}</label>
              {field.type === 'textarea' ? (
                <textarea name={field.key} rows={4} defaultValue={String(stored ?? '')}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              ) : field.type === 'select' ? (
                <select name={field.key} defaultValue={String(stored ?? '')}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                  {(field.options ?? []).map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              ) : (
                <input name={field.key} type={field.type ?? 'text'}
                  defaultValue={field.type === 'password' ? '' : String(stored ?? '')}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              )}
              <p className="mt-1 text-xs text-slate-500">
                {field.type === 'password'
                  ? (isSet ? 'Set. Leave blank to keep it.' : 'Not set.')
                  : field.hint}
              </p>
            </div>
          );
        })}
      </div>
      <button className="btn-primary" disabled={busy} type="submit">
        {busy ? 'Saving...' : 'Save settings'}
      </button>
      {message && <p className="text-sm text-slate-600">{message}</p>}
    </form>
  );
}
