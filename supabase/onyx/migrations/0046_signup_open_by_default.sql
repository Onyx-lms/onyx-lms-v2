-- ---------------------------------------------------------------------------
-- 0046 -- a new institution starts open to self-signup.
--
-- 0025 defaulted `student_signup` to false and 0031 defaulted `signup_mode`
-- to 'domain': a freshly created institution took no registrations at all
-- until its own administrator turned the setting on. That is the more
-- cautious default, and it is also why the public signup picker at
-- /onyx/signup only ever listed three of the seven institutions on this
-- platform -- the other four had simply never had anybody flip the switch.
--
-- By explicit decision, taken with the consequence stated plainly first (this
-- opens live public self-registration, including on real institutions rather
-- than only demonstration ones), every institution should be reachable from
-- that picker, including ones created after this migration runs. The four
-- that were closed have been opened through the operator console, which is
-- audited; this changes what a NEW institution starts as, so the same
-- decision does not have to be repeated by hand for the next one.
--
-- `signup_mode` defaults to 'open' rather than 'domain', matching what was
-- chosen for the four existing institutions just opened: 'domain' would leave
-- a fresh institution unable to take a single registration until somebody
-- also configured a domain list, which is a second step this decision did not
-- ask for. An institution that wants domain-restricted registration instead
-- can still switch to it from its own Settings; nothing here removes that
-- choice, it only changes which choice a new institution starts with.
-- ---------------------------------------------------------------------------

ALTER TABLE public."onyx_tenants"
  ALTER COLUMN "student_signup" SET DEFAULT true;

ALTER TABLE public."onyx_tenants"
  ALTER COLUMN "signup_mode" SET DEFAULT 'open';
