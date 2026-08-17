'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function CourseRowActions({ id, status }: { id: number; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState('');

  async function call(path: string, method: string, body?: unknown) {
    setBusy(path);
    const res = await fetch('/api/proxy' + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    setBusy('');
    if (res.ok) router.refresh();
    else {
      const b = await res.json().catch(() => ({}));
      alert(b.message ?? 'Action failed.');
    }
  }

  const nextStatus = status === 'active' ? 'draft' : 'active';

  return (
    <div className="flex justify-end gap-2 text-xs">
      <button className="btn-ghost px-2 py-1" disabled={Boolean(busy)}
        onClick={() => call(`/authoring/courses/${id}/status`, 'POST', { status: nextStatus })}>
        {status === 'active' ? 'Unpublish' : 'Publish'}
      </button>
      <button className="btn-ghost px-2 py-1" disabled={Boolean(busy)}
        onClick={() => call(`/authoring/courses/${id}/duplicate`, 'POST')}>
        Duplicate
      </button>
      <button className="btn-ghost px-2 py-1 text-red-600" disabled={Boolean(busy)}
        onClick={() => {
          // Deleting a course removes its sections, lessons and questions too.
          if (confirm('Delete this course and its entire curriculum?')) {
            call(`/authoring/courses/${id}`, 'DELETE');
          }
        }}>
        Delete
      </button>
    </div>
  );
}
