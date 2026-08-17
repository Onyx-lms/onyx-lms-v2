'use client';

import { useEffect, useState } from 'react';

export function VerifyEmailClient({ token }: { token: string }) {
  const [state, setState] = useState<'idle' | 'working' | 'done' | 'error'>(
    token ? 'working' : 'idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const body = await res.json().catch(() => ({ message: 'Something went wrong.' }));
      if (cancelled) return;
      setMessage(body.message ?? '');
      setState(res.ok ? 'done' : 'error');
    })();
    return () => { cancelled = true; };
  }, [token]);

  if (state === 'idle') {
    return <p className="text-sm text-slate-600">Open the link from your email to verify your address.</p>;
  }
  if (state === 'working') {
    return <p className="text-sm text-slate-600">Verifying your email address...</p>;
  }
  return (
    <p className={`text-sm ${state === 'error' ? 'text-red-600' : 'text-green-700'}`}>{message}</p>
  );
}
