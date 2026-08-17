'use client';

import { useState } from 'react';

/**
 * Posts through the app's own route handler rather than straight at the API,
 * so the API base URL never has to be public.
 */
export function NewsletterForm() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState('sending');
    try {
      const res = await fetch('/api/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const body = await res.json();
      setMessage(body.message ?? (res.ok ? 'You are subscribed.' : 'Please check the address.'));
      setState(res.ok ? 'done' : 'error');
      if (res.ok) setEmail('');
    } catch {
      setState('error');
      setMessage('Something went wrong. Please try again.');
    }
  }

  return (
    <form onSubmit={submit} className="mt-2">
      <div className="flex gap-2">
        <label className="sr-only" htmlFor="newsletter-email">Email address</label>
        <input
          id="newsletter-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
        />
        <button type="submit" className="btn-primary" disabled={state === 'sending'}>
          {state === 'sending' ? 'Joining' : 'Join'}
        </button>
      </div>
      {message && (
        <p className={`mt-2 text-xs ${state === 'error' ? 'text-red-600' : 'text-green-700'}`}>
          {message}
        </p>
      )}
    </form>
  );
}
