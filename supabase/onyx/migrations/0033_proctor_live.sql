-- Onyx 0033_proctor_live.sql -- an invigilator watching a candidate's camera.
--
-- ASS-02 stores EVENTS: a tab lost focus, a camera stopped, a paste happened.
-- It deliberately stores no video, and the consent screen said so in as many
-- words -- "no video is recorded or uploaded". This adds live viewing, which
-- makes that sentence false, so the sentence changes with it. Consent for
-- being watched has to be informed and specific or it is not consent.
--
-- Two things are added and neither is a recording.
--
-- `onyx_assessments.watch_camera` -- OFF by default, and it has to be. Every
-- paper that exists today was consented to under wording that promised nobody
-- would be watching; a column that defaulted to true would start streaming
-- somebody's room on the strength of a promise that they would not be.
--
-- `onyx_proctor_signals` -- the offer/answer/ICE exchange that lets two
-- browsers find each other. This is signalling, not media: each row is a few
-- hundred bytes of SDP or an ICE candidate, the rows are consumed and deleted
-- within seconds, and the video itself never touches this database or this
-- server. It goes directly between the two browsers.
--
-- **Why signalling goes through the API rather than Supabase Realtime.**
-- Realtime broadcast would work and is one fewer table. It is also a channel
-- anybody holding the anon key can join, so authorising it means a second
-- system of rules alongside the guards every other route in this product
-- already goes through. A row in a table is checked by assertCanRunExam and
-- attempt ownership like everything else, and the exchange is a handful of
-- messages over a few seconds -- a poll is a fair price for having exactly one
-- place where "may this person watch this candidate" is answered.
--
-- **What this cannot do**, recorded here because the limits are structural
-- rather than unfinished work:
--
--   * One candidate at a time. Media is peer-to-peer, so watching forty people
--     means forty inbound streams in one browser tab, and a browser will not
--     do that. A whole-hall wall needs an SFU, which is a server that does not
--     exist in a serverless deployment.
--   * Some networks will not connect without a TURN relay. STUN alone gets
--     most pairs through; symmetric NATs and strict corporate firewalls need
--     a relay, which is paid infrastructure and is configured per deployment.
--     Where it is absent the viewer says so rather than showing a black box.
--   * Video only. Audio was not asked for and is markedly more invasive.

ALTER TABLE public."onyx_assessments"
  ADD COLUMN IF NOT EXISTS "watch_camera" boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public."onyx_assessments"."watch_camera" IS
  'May an invigilator watch this candidate''s camera live during the attempt? '
  'Off by default: existing papers were consented to under wording that said '
  'nobody would be watching.';

CREATE TABLE IF NOT EXISTS public."onyx_proctor_signals" (
  "id"         bigserial PRIMARY KEY,
  "tenant_id"  bigint NOT NULL REFERENCES public."onyx_tenants"("id") ON DELETE CASCADE,
  "attempt_id" bigint NOT NULL
    REFERENCES public."onyx_assessment_attempts"("id") ON DELETE CASCADE,
  -- One watching session. A second invigilator opening the same candidate is a
  -- separate negotiation and must not read the first one's messages.
  "session_id" uuid NOT NULL,
  -- Who put this here, so each side reads only what the other sent.
  "sender"     varchar(10) NOT NULL,
  "kind"       varchar(10) NOT NULL,
  "payload"    jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public."onyx_proctor_signals" IS
  'WebRTC offer/answer/ICE, consumed within seconds. Never media -- the video '
  'goes directly between the two browsers and never reaches this database.';

-- Dropped then added so the file re-runs, the same way 0024 handles its own.
ALTER TABLE public."onyx_proctor_signals"
  DROP CONSTRAINT IF EXISTS "onyx_proctor_signals_sender_check";
ALTER TABLE public."onyx_proctor_signals"
  ADD CONSTRAINT "onyx_proctor_signals_sender_check"
  CHECK ("sender" IN ('watcher', 'candidate'));

ALTER TABLE public."onyx_proctor_signals"
  DROP CONSTRAINT IF EXISTS "onyx_proctor_signals_kind_check";
ALTER TABLE public."onyx_proctor_signals"
  ADD CONSTRAINT "onyx_proctor_signals_kind_check"
  CHECK ("kind" IN ('offer', 'answer', 'ice', 'bye'));

-- The only read either side makes: everything the other sent on this session
-- after the last id I saw.
CREATE INDEX IF NOT EXISTS "onyx_proctor_signals_poll"
  ON public."onyx_proctor_signals" ("tenant_id", "attempt_id", "session_id", "id");

-- Sweeping stale rows. A negotiation that never completed -- a candidate who
-- closed the tab mid-offer -- would otherwise sit here for ever.
CREATE INDEX IF NOT EXISTS "onyx_proctor_signals_age"
  ON public."onyx_proctor_signals" ("created_at");

ALTER TABLE public."onyx_proctor_signals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."onyx_proctor_signals" FORCE ROW LEVEL SECURITY;

-- No policy, the same as every other Onyx table: every read goes through the
-- service-role client with tenant_id as the filter (see 0003_rls.sql and the
-- audit in tools/db/verify-rls.mjs). RLS is on and forced so a stray anon key
-- cannot read it at all.
