'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface LiveClassSettings {
  zoom_account_email: string | null;
  zoom_web_sdk: string | null;
  zoom_account_id: string | null;
  zoom_client_id: string | null;
  zoom_sdk_client_id: string | null;
  zoom_client_secret_set: boolean;
  zoom_sdk_client_secret_set: boolean;
  configured: boolean;
}

function Field({ label, name, defaultValue, type = 'text', hint }: {
  label: string; name: string; defaultValue?: string; type?: string; hint?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium">{label}</label>
      <input name={name} type={type} defaultValue={defaultValue}
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function LiveClassSettingsForm({ settings }: { settings: LiveClassSettings | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  return (
    <form className="card max-w-2xl space-y-4 p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const body: Record<string, string> = {};
        for (const [k, v] of f.entries()) {
          // An untouched secret field stays untouched, rather than being
          // overwritten with an empty string.
          if (typeof v === 'string' && v !== '') body[k] = v;
        }
        setBusy(true); setMessage('');
        const res = await fetch('/api/proxy/admin/live-class-settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const payload = await res.json().catch(() => ({}));
        setBusy(false);
        setMessage(payload.message ?? (res.ok ? 'Saved.' : 'Could not save.'));
        if (res.ok) router.refresh();
      }}>
      <div className="flex items-center gap-2 text-sm">
        <span className={settings?.configured
          ? 'rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700'
          : 'rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600'}>
          {settings?.configured ? 'Zoom configured' : 'Zoom not configured'}
        </span>
        <span className="text-slate-500">Jitsi is always available.</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Zoom account id" name="zoom_account_id"
          defaultValue={settings?.zoom_account_id ?? ''} />
        <Field label="Zoom account email" name="zoom_account_email" type="email"
          defaultValue={settings?.zoom_account_email ?? ''} />
        <Field label="OAuth client id" name="zoom_client_id"
          defaultValue={settings?.zoom_client_id ?? ''} />
        <Field label="OAuth client secret" name="zoom_client_secret" type="password"
          hint={settings?.zoom_client_secret_set ? 'Set. Leave blank to keep it.' : 'Not set.'} />
        <Field label="Meeting SDK key" name="zoom_sdk_client_id"
          defaultValue={settings?.zoom_sdk_client_id ?? ''} />
        <Field label="Meeting SDK secret" name="zoom_sdk_client_secret" type="password"
          hint={settings?.zoom_sdk_client_secret_set
            ? 'Set. Leave blank to keep it.'
            : 'Not set. Used only on the server, to sign joins.'} />
      </div>

      <div>
        <label className="block text-sm font-medium">Run Zoom classes in this site</label>
        <select name="zoom_web_sdk" defaultValue={settings?.zoom_web_sdk ?? 'inactive'}
          className="mt-1 w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="inactive">No, open the Zoom client</option>
          <option value="active">Yes, embed the Meeting SDK</option>
        </select>
      </div>

      <button className="btn-primary" disabled={busy} type="submit">
        {busy ? 'Saving...' : 'Save settings'}
      </button>
      {message && <p className="text-sm text-slate-600">{message}</p>}
    </form>
  );
}
