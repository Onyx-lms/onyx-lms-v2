'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/onyx-ui';
import { Modal } from '@/components/onyx-modal';

/**
 * LRN-02 -- putting content into a module.
 *
 * This is not a `CreatePanel` because of one thing that component cannot do:
 * take a file. The lesson form it replaced offered three kinds -- Text, Video
 * and "PDF" -- and asked for a "Source path" as free text, meaning
 * `uploads/lesson.mp4` typed from memory. Two things were wrong with that.
 * "PDF" was not a kind the API accepts (`video | document | image | text |
 * link`), so choosing it produced a 422 every time; and there was nowhere in
 * the product to put a file, so any path typed here pointed at nothing unless
 * it had been uploaded as a course *resource* first and its key copied out.
 *
 * So: the kinds now match what the API actually takes, and the source is
 * whatever that kind needs -- a file picker for media, a URL box for a link, a
 * textarea for text. Nothing has to be typed from memory.
 *
 * Uploads go **straight from the browser to storage**. The app mints a
 * one-shot ticket, the file goes to Supabase, and only the resulting key is
 * posted here. That is not an optimisation: a request body through this app is
 * capped at 4.5 MB on Vercel, which no lecture recording respects.
 */

const input = 'mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm '
  + 'focus:border-brand-600 focus:outline-none';
const label = 'block text-[13px] font-semibold text-slate-700';

type Kind = 'text' | 'video' | 'document' | 'image' | 'link';

/**
 * `accept` is a courtesy to the file picker, not a check -- the browser filter
 * is trivially bypassed and the real limits live in storage. It is here
 * because opening a picker onto every file on a laptop when you want a slide
 * deck is its own small cruelty.
 */
const KINDS: { value: Kind; label: string; hint: string; accept?: string }[] = [
  { value: 'text', label: 'Text', hint: 'Written straight into the lesson — notes, instructions, a worked example.' },
  { value: 'video', label: 'Video', hint: 'A recording learners play in the lesson.', accept: 'video/*' },
  { value: 'document', label: 'Document', hint: 'PDF, slides or a word-processor file.', accept: '.pdf,.doc,.docx,.ppt,.pptx,.odt,.odp,application/pdf' },
  { value: 'image', label: 'Image', hint: 'A diagram, scan or worksheet, shown inline.', accept: 'image/*' },
  { value: 'link', label: 'Link', hint: 'Something hosted elsewhere. The address is stored as-is.' },
];

const IS_FILE = (k: Kind) => k === 'video' || k === 'document' || k === 'image';

export function LessonComposer({ courseId, moduleId, moduleTitle }: {
  courseId: number; moduleId: number; moduleTitle: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>('text');
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  const chosen = KINDS.find((k) => k.value === kind)!;

  function close() {
    setOpen(false); setError(null); setStage(null); setFile(null);
  }

  /**
   * Ticket, then PUT, then the key. Failures are reported against the step
   * that failed -- "could not be uploaded" and "could not be saved" send an
   * author to different places, and a single "something went wrong" sends
   * them nowhere.
   */
  async function uploadAndGetPath(picked: File): Promise<string> {
    setStage('Preparing…');
    const ticketRes = await fetch('/api/proxy/onyx/courses/' + courseId + '/uploads/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: picked.name }),
    });
    const ticket = await ticketRes.json().catch(() => ({ ok: false }));
    if (!ticket.ok) throw new Error(ticket.message ?? 'Could not start the upload.');

    setStage('Uploading ' + picked.name + '…');
    // Straight to storage, bypassing this app entirely -- see the note above.
    const put = await fetch(ticket.data.signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': picked.type || 'application/octet-stream' },
      body: picked,
    });
    if (!put.ok) throw new Error('The file could not be uploaded. Check your connection.');

    return ticket.data.path as string;
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex w-fit shrink-0 items-center gap-2 self-start justify-self-start
                   rounded-xl bg-brand-600 px-3 py-2 text-[13px] font-semibold text-white
                   hover:bg-brand-700">
        <Icon name="edit" className="h-4 w-4" />
        {'Add a lesson to ' + moduleTitle}
      </button>

      {open ? (
        <Modal title={'New lesson in "' + moduleTitle + '"'} onClose={close}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const data = new FormData(form);
              setError(null);

              start(async () => {
                try {
                  let path: string | null = null;

                  if (IS_FILE(kind)) {
                    if (!file) throw new Error('Choose a file for this lesson.');
                    path = await uploadAndGetPath(file);
                  } else if (kind === 'link') {
                    path = String(data.get('url') ?? '').trim();
                    if (!path) throw new Error('A link lesson needs an address.');
                  }

                  setStage('Saving the lesson…');
                  const res = await fetch(
                    '/api/proxy/onyx/modules/' + moduleId + '/lessons', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        title: String(data.get('title') ?? ''),
                        type: kind,
                        path,
                        body: kind === 'text' ? String(data.get('body') ?? '') : null,
                        duration_seconds: Number(data.get('duration_seconds') ?? 0) || 0,
                        is_preview: Boolean(data.get('is_preview')),
                      }),
                    });
                  const saved = await res.json().catch(() => ({ ok: false }));
                  if (!saved.ok) throw new Error(saved.message ?? 'The lesson could not be saved.');

                  form.reset();
                  close();
                  router.refresh();
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Something went wrong.');
                  setStage(null);
                }
              });
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className={label} htmlFor="lesson-title">Lesson title</label>
                <input id="lesson-title" name="title" required maxLength={255}
                  className={input} placeholder="What this lesson covers" />
              </div>

              <div className="sm:col-span-2">
                <label className={label} htmlFor="lesson-kind">Kind</label>
                <select id="lesson-kind" className={input} value={kind}
                  onChange={(e) => {
                    setKind(e.target.value as Kind);
                    // The picked file belongs to the kind it was picked for --
                    // an mp4 left behind after switching to Document would be
                    // uploaded and then described as a slide deck.
                    setFile(null);
                    if (fileInput.current) fileInput.current.value = '';
                  }}>
                  {KINDS.map((k) => (
                    <option key={k.value} value={k.value}>{k.label}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-muted">{chosen.hint}</p>
              </div>

              {IS_FILE(kind) ? (
                <div className="sm:col-span-2">
                  <label className={label} htmlFor="lesson-file">
                    {chosen.label} file
                  </label>
                  <input
                    ref={fileInput} id="lesson-file" type="file" accept={chosen.accept}
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2
                               text-sm file:mr-3 file:rounded-lg file:border-0
                               file:bg-slate-100 file:px-3 file:py-1.5 file:text-[13px]
                               file:font-semibold"
                  />
                  {file ? (
                    <p className="mt-1 text-xs text-muted">
                      {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB
                    </p>
                  ) : null}
                </div>
              ) : null}

              {kind === 'link' ? (
                <div className="sm:col-span-2">
                  <label className={label} htmlFor="lesson-url">Address</label>
                  <input id="lesson-url" name="url" type="url" required
                    className={input} placeholder="https://…" />
                  <p className="mt-1 text-xs text-muted">
                    Opened as given. Nothing is copied into the institution&apos;s storage.
                  </p>
                </div>
              ) : null}

              {kind === 'text' ? (
                <div className="sm:col-span-2">
                  <label className={label} htmlFor="lesson-body">Lesson text</label>
                  <textarea id="lesson-body" name="body" rows={6} required className={input} />
                </div>
              ) : null}

              {kind === 'video' ? (
                <div>
                  <label className={label} htmlFor="lesson-duration">Length (seconds)</label>
                  <input id="lesson-duration" name="duration_seconds" type="number" min={0}
                    defaultValue={300} className={input} />
                  <p className="mt-1 text-xs text-muted">
                    Shown on the outline so a learner can tell a five-minute clip
                    from an hour.
                  </p>
                </div>
              ) : null}

              <div className={kind === 'video' ? '' : 'sm:col-span-2'}>
                <label className="mt-1 flex items-center gap-2 text-[13px] font-semibold
                                  text-slate-700">
                  <input type="checkbox" name="is_preview"
                    className="h-4 w-4 rounded border-slate-300" />
                  Free preview
                </label>
                <p className="mt-1 text-xs text-muted">
                  Readable without enrolling, so the catalogue can show what the
                  course contains.
                </p>
              </div>
            </div>

            {/* One live region for both, because they are the same channel:
                what is happening now, or why it stopped. */}
            {error ? (
              <p role="alert" className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </p>
            ) : stage ? (
              <p role="status" className="mt-3 flex items-center gap-2 rounded-xl bg-slate-50
                                          px-3 py-2 text-sm font-semibold text-slate-700">
                <Icon name="clock" className="h-4 w-4 animate-pulse" />
                {stage}
              </p>
            ) : null}

            <div className="mt-4 flex gap-2">
              <button type="submit" disabled={pending}
                className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white
                           hover:bg-brand-700 disabled:opacity-60">
                {pending ? 'Saving…' : 'Add lesson'}
              </button>
              <button type="button" onClick={close}
                className="rounded-xl border border-line px-4 py-2.5 text-sm font-semibold">
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}
