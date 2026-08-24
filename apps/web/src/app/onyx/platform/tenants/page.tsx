import { redirect } from 'next/navigation';
import { requirePlatformSession } from '@/lib/onyx-platform-session';

/**
 * `/onyx/platform/tenants` with no institution after it.
 *
 * There was no page here, so trimming the URL back from
 * `/onyx/platform/tenants/1/fees` -- which is how anybody gets from one section
 * of a customer's console to "show me the list again" -- produced a bare 404.
 * Worse, it produced that 404 for a signed-OUT visitor too: every other
 * `/onyx/platform/*` path sends them to the operator sign-in, and this one
 * answered from the framework before any guard ran, so the one route in the
 * console that behaved differently was the one nobody had written.
 *
 * The institutions list already lives at `/onyx/platform`, so this is a
 * redirect rather than a second copy of it -- behind the same session check as
 * everything else here, which is what makes the signed-out case answer like
 * its neighbours instead of like a missing file.
 */
export default async function OnyxPlatformTenantsIndex() {
  await requirePlatformSession();
  redirect('/onyx/platform');
}
