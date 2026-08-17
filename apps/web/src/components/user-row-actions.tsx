'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function UserRowActions({ id, role, isSelf }: {
  id: number; role: string; isSelf: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function call(path: string, method: string, body?: unknown) {
    setBusy(true);
    const res = await fetch('/api/proxy' + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    setBusy(false);
    if (res.ok) { router.refresh(); return true; }
    const b = await res.json().catch(() => ({}));
    alert(b.message ?? 'Action failed.');
    return false;
  }

  return (
    <div className="flex justify-end gap-2 text-xs">
      <select
        defaultValue={role}
        disabled={busy || isSelf}
        title={isSelf ? 'You cannot change your own role' : 'Change role'}
        onChange={(e) => call(`/admin/users/${id}`, 'PATCH', { role: e.target.value })}
        className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50"
      >
        {['admin', 'instructor', 'student'].map((r) => <option key={r} value={r}>{r}</option>)}
      </select>

      {role === 'admin' && (
        <button className="btn-ghost px-2 py-1" onClick={() => setOpen(!open)}>
          Permissions
        </button>
      )}

      <button
        className="btn-ghost px-2 py-1 text-red-600 disabled:opacity-40"
        disabled={busy || isSelf}
        title={isSelf ? 'You cannot delete your own account' : 'Delete user'}
        onClick={() => confirm('Delete this user?') && call(`/admin/users/${id}`, 'DELETE')}
      >
        Delete
      </button>

      {open && <PermissionsPanel userId={id} onClose={() => setOpen(false)} />}
    </div>
  );
}

/** A-08: toggling a route on or off for a sub-admin. */
function PermissionsPanel({ userId, onClose }: { userId: number; onClose: () => void }) {
  const [state, setState] = useState<{ is_root_admin: boolean; permissions: string[] } | null>(null);
  const [loaded, setLoaded] = useState(false);

  if (!loaded) {
    setLoaded(true);
    fetch(`/api/proxy/admin/users/${userId}/permissions`)
      .then((r) => r.json())
      .then((b) => setState(b.data ?? null))
      .catch(() => setState(null));
  }

  const ROUTES = [
    'admin.dashboard', 'admin.courses', 'admin.users', 'admin.certificates.index',
    'admin.categories', 'admin.settings',
  ];

  async function toggle(permission: string) {
    const res = await fetch(`/api/proxy/admin/users/${userId}/permissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permission }),
    });
    const b = await res.json().catch(() => ({}));
    if (res.ok) setState((s) => s ? { ...s, permissions: b.data.permissions } : s);
    else alert(b.message ?? 'Only the root administrator can assign permissions.');
  }

  return (
    <div className="absolute right-8 z-20 mt-8 w-64 rounded-lg border border-slate-200 bg-white p-4 text-left shadow-lg">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Permissions</h3>
        <button onClick={onClose} className="text-xs text-slate-500">Close</button>
      </div>
      {!state ? (
        <p className="mt-2 text-xs text-slate-500">Loading...</p>
      ) : state.is_root_admin ? (
        <p className="mt-2 text-xs text-slate-600">
          Root administrator. Bypasses every permission check.
        </p>
      ) : (
        <ul className="mt-2 space-y-1">
          {ROUTES.map((r) => (
            <li key={r}>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={state.permissions.includes(r)}
                  onChange={() => toggle(r)} />
                {r}
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
