'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

export interface Contact { id: number; name: string | null; email: string | null; role?: string | null }
export interface Message {
  id: number; thread_id: number; sender_id: number; receiver_id: number;
  message: string | null; read: number | null; created_at: string | null;
}
export interface Thread {
  id: number; code: string; contact_one: number; contact_two: number;
  updated_at: string | null; contact: Contact | null; unread: number;
  last_message: Message | null;
}

interface RealtimeGrant {
  token: string; expires_at: number; user_id: number;
  supabase_url: string; supabase_anon_key: string;
}

function time(value: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB',
    { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/**
 * M-02 / M-03 -- the inbox and conversation view.
 *
 * Delivery is a Supabase Realtime subscription on `messages`, not polling. The
 * socket authenticates with a short-lived scoped token (see ADR-004): the API
 * refuses it, and RLS limits it to rows where the holder is sender or receiver,
 * so the socket can only ever carry this user's own conversations.
 */
export function Messenger({ threads, active, messages, viewerId, basePath }: {
  threads: Thread[];
  active: Thread | null;
  messages: Message[];
  viewerId: number;
  basePath: string;
}) {
  const router = useRouter();
  const [live, setLive] = useState<Message[]>(messages);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const [finding, setFinding] = useState<Contact[]>([]);
  const bottom = useRef<HTMLDivElement | null>(null);

  // A server render for a different thread must replace the live list, not
  // append to it -- otherwise messages from the previous conversation linger.
  useEffect(() => { setLive(messages); }, [messages, active?.id]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [live.length]);

  useEffect(() => {
    if (!active) return;
    let channel: RealtimeChannel | null = null;
    let client: SupabaseClient | null = null;
    let cancelled = false;

    (async () => {
      const res = await fetch('/api/proxy/messages/realtime-token', { method: 'POST' });
      if (!res.ok) return;
      const grant = (await res.json()).data as RealtimeGrant;
      if (cancelled || !grant.supabase_url) return;

      const { createClient } = await import('@supabase/supabase-js');
      client = createClient(grant.supabase_url, grant.supabase_anon_key, {
        auth: { persistSession: false },
        realtime: { params: { eventsPerSecond: 5 } },
      });
      // Awaited, and it matters. `setAuth` is async: it hands the token to
      // the socket, and the join below carries whatever token is set when it
      // goes out. Not awaiting it is a race that loses quietly -- the channel
      // joins as `anon`, Realtime records the listener with no user_id, the
      // RLS policy on `messages` (sender or receiver = the caller) can never
      // match, and not one change is ever delivered. No error, no failed
      // subscribe: the inbox just sits there until the reader refreshes.
      await client.realtime.setAuth(grant.token);
      if (cancelled) return;

      channel = client
        .channel('thread:' + active.id)
        .on('postgres_changes', {
          event: '*', schema: 'public', table: 'messages',
          filter: 'thread_id=eq.' + active.id,
        }, (payload) => {
          if (payload.eventType === 'DELETE') {
            const gone = payload.old as Partial<Message>;
            setLive((prev) => prev.filter((m) => m.id !== gone.id));
            return;
          }
          const row = payload.new as Message;
          setLive((prev) => (prev.some((m) => m.id === row.id)
            ? prev.map((m) => (m.id === row.id ? row : m))
            : [...prev, row]));
          // Someone else's message landing means the sidebar counts moved.
          if (payload.eventType === 'INSERT' && row.sender_id !== viewerId) {
            void fetch('/api/proxy/messages/threads/' + active.id + '/read', { method: 'POST' });
            router.refresh();
          }
        })
        .subscribe((status) => {
          setConnected(status === 'SUBSCRIBED');
          // Catch up on whatever was said while this socket was opening.
          //
          // The list on screen was rendered by the server before this
          // component mounted, and the listener is not registered until some
          // time after the page loads -- a token request, a dynamic import, a
          // websocket connect, a join, and then the server's own write of the
          // subscription, which is measurably ~0.5s behind the SUBSCRIBED ack
          // even on an idle project. Nothing sent inside that window arrives:
          // it is too late for the render and too early for the channel, so
          // it appears only on a refresh, which is the exact thing this
          // component exists to avoid. Reconciling once the channel is
          // genuinely live closes the window however long it turns out to be.
          if (status !== 'SUBSCRIBED' || cancelled) return;
          void (async () => {
            const back = await fetch('/api/proxy/messages/threads/' + active.code);
            if (!back.ok || cancelled) return;
            const missed = ((await back.json()).data?.messages ?? []) as Message[];
            setLive((prev) => {
              const known = new Set(prev.map((m) => m.id));
              const extra = missed.filter((m) => !known.has(m.id));
              return extra.length ? [...prev, ...extra] : prev;
            });
          })();
        });
    })();

    return () => {
      cancelled = true;
      if (channel && client) void client.removeChannel(channel);
      setConnected(false);
    };
  }, [active?.id, viewerId, router]);

  const send = useCallback(async (form: HTMLFormElement) => {
    if (!active) return;
    const text = String(new FormData(form).get('message') ?? '');
    if (!text.trim()) return;
    setBusy(true); setError('');
    const res = await fetch('/api/proxy/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ thread_id: active.id, message: text }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(body.message ?? 'Could not send the message.'); return; }
    form.reset();
    // The socket echoes our own insert back; this only covers a dropped socket.
    setLive((prev) => (prev.some((m) => m.id === body.data.id) ? prev : [...prev, body.data]));
    router.refresh();
  }, [active, router]);

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <aside className="card flex flex-col p-3">
        <form className="flex gap-2" onSubmit={async (e) => {
          e.preventDefault();
          const term = String(new FormData(e.currentTarget).get('search') ?? '');
          if (!term.trim()) { setFinding([]); return; }
          const res = await fetch('/api/proxy/messages/contacts?search='
            + encodeURIComponent(term));
          setFinding(res.ok ? ((await res.json()).data as Contact[]) : []);
        }}>
          <input name="search" placeholder="Find someone"
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          <button className="btn-ghost px-2 text-sm" type="submit">Go</button>
        </form>

        {finding.length > 0 && (
          <ul className="mt-2 rounded-md border border-slate-200 text-sm">
            {finding.map((u) => (
              <li key={u.id}>
                <button className="w-full px-2 py-1.5 text-left hover:bg-slate-50"
                  onClick={async () => {
                    const res = await fetch('/api/proxy/messages/threads', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ user_id: u.id }),
                    });
                    if (!res.ok) { setError('Could not open that conversation.'); return; }
                    const thread = (await res.json()).data as Thread;
                    setFinding([]);
                    router.push(basePath + '?inbox=' + thread.code);
                  }}>
                  {u.name ?? u.email}
                  <span className="ml-1 text-xs text-slate-400">{u.role}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <ul className="mt-3 space-y-1 overflow-y-auto">
          {threads.length === 0 && (
            <li className="px-2 py-6 text-center text-sm text-slate-500">No conversations yet.</li>
          )}
          {threads.map((t) => (
            <li key={t.id}>
              <a href={basePath + '?inbox=' + t.code}
                className={'flex items-center justify-between rounded-md px-2 py-2 text-sm '
                  + (active?.id === t.id ? 'bg-brand-50 font-medium' : 'hover:bg-slate-50')}>
                <span className="truncate">
                  {t.contact?.name ?? t.contact?.email ?? 'Unknown'}
                  {t.last_message && (
                    <span className="block truncate text-xs text-slate-500">
                      {t.last_message.message}
                    </span>
                  )}
                </span>
                {t.unread > 0 && (
                  <span className="ml-2 shrink-0 rounded-full bg-brand-600 px-2 text-xs text-white">
                    {t.unread}
                  </span>
                )}
              </a>
            </li>
          ))}
        </ul>
      </aside>

      <section className="card flex min-h-[28rem] flex-col p-4">
        {!active ? (
          <p className="m-auto text-sm text-slate-500">
            Pick a conversation, or search for someone to message.
          </p>
        ) : (
          <>
            <header className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h2 className="font-medium">
                {active.contact?.name ?? active.contact?.email ?? 'Conversation'}
              </h2>
              <span className={connected ? 'text-xs text-green-600' : 'text-xs text-slate-400'}>
                {connected ? 'Live' : 'Connecting...'}
              </span>
            </header>

            <ul className="flex-1 space-y-3 overflow-y-auto py-4">
              {live.map((m) => {
                const mine = m.sender_id === viewerId;
                return (
                  <li key={m.id} className={mine ? 'text-right' : ''}>
                    <div className={'inline-block max-w-[80%] rounded-lg px-3 py-2 text-sm '
                      + (mine ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-800')}>
                      <p className="whitespace-pre-line">{m.message}</p>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">
                      {time(m.created_at)}
                      {mine && (m.read ? ' - read' : ' - sent')}
                      {mine && (
                        <button className="ml-2 text-red-500 hover:underline"
                          onClick={async () => {
                            if (!confirm('Delete this message?')) return;
                            const res = await fetch('/api/proxy/messages/' + m.id,
                              { method: 'DELETE' });
                            if (res.ok) setLive((prev) => prev.filter((x) => x.id !== m.id));
                          }}>
                          Delete
                        </button>
                      )}
                    </p>
                  </li>
                );
              })}
              <div ref={bottom} />
            </ul>

            {error && <p className="pb-2 text-sm text-red-600">{error}</p>}

            <form className="flex gap-2 border-t border-slate-200 pt-3"
              onSubmit={(e) => { e.preventDefault(); void send(e.currentTarget); }}>
              <input name="message" required autoComplete="off" placeholder="Write a message"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              <button className="btn-primary" disabled={busy} type="submit">Send</button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
