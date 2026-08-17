import { redirect } from 'next/navigation';
import { getSession, homeForRole } from '@/lib/session';

/**
 * /login is the institutional door now.
 *
 * Onyx is what this deployment is for, and two sign-in pages one path segment
 * apart -- neither of which said which product it belonged to -- sent people to
 * the wrong one routinely. So the bare /login sends you to Onyx.
 *
 * Two things this deliberately does NOT do:
 *
 *   * It does not strand somebody who is already signed in to the storefront.
 *     A live session still goes to their own home rather than to a sign-in page
 *     they do not need.
 *   * It does not delete the storefront's sign-in. That form is at
 *     /login/store, unchanged, and everything behind it -- the cart, checkout,
 *     purchases, messages -- still works. A storefront nobody can sign in to
 *     would be a removed feature dressed up as a redirect.
 *
 * Reverting is one step: move store/page.tsx back up and delete this file.
 */
export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect(homeForRole(session.app_role));
  redirect('/onyx/login');
}
