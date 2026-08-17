'use client';

import { useState } from 'react';

export function ContactForm() {
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState('sending');
    setErrors({});
    const form = new FormData(e.currentTarget);
    const res = await fetch('/api/web/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(form)),
    });
    const body = await res.json();
    setMessage(body.message ?? '');
    if (res.ok) {
      setState('done');
      e.currentTarget.reset();
    } else {
      // Field-keyed errors come straight from the API's Laravel-shaped envelope.
      setErrors(body.errors ?? {});
      setState('error');
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field name="name" label="Your name" errors={errors.name} required />
      <Field name="email" label="Email address" type="email" errors={errors.email} required />
      <Field name="phone" label="Phone (optional)" errors={errors.phone} />
      <div>
        <label htmlFor="message" className="block text-sm font-medium">Message</label>
        <textarea id="message" name="message" required rows={5}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500" />
        {errors.message && <p className="mt-1 text-xs text-red-600">{errors.message[0]}</p>}
      </div>
      <button className="btn-primary" disabled={state === 'sending'}>
        {state === 'sending' ? 'Sending' : 'Send message'}
      </button>
      {message && (
        <p className={`text-sm ${state === 'error' ? 'text-red-600' : 'text-green-700'}`}>{message}</p>
      )}
    </form>
  );
}

function Field({ name, label, type = 'text', required, errors }: {
  name: string; label: string; type?: string; required?: boolean; errors?: string[];
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-sm font-medium">{label}</label>
      <input id={name} name={name} type={type} required={required}
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500" />
      {errors && <p className="mt-1 text-xs text-red-600">{errors[0]}</p>}
    </div>
  );
}
