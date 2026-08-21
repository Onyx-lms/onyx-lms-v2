import type { Metadata } from 'next';
import { Fraunces, Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import { apiSafe, type CategoryNode, type SiteSettings } from '@/lib/api';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { StorefrontChrome } from '@/components/storefront-chrome';


/*
 * The administrator's console wears the EZiL Design Labs pairing: a display
 * serif over a geometric sans. Declared here rather than in the shell because
 * next/font is build-time -- it self-hosts the files and emits one class, so
 * there is no network request to a font CDN at runtime and no layout shift.
 *
 * Both are loaded on every page but USED only inside `[data-skin='ezil']`
 * (globals.css). `display: 'swap'` and the variable form keep them out of the
 * critical path for every other role, who never reference the variables.
 */
const fraunces = Fraunces({
  subsets: ['latin'], display: 'swap', variable: '--font-fraunces', weight: ['600', '700'],
});
const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'], display: 'swap', variable: '--font-jakarta',
});
const FONTS = fraunces.variable + ' ' + jakarta.variable;

/*
 * Runs before the first paint.
 *
 * A theme applied by React lands after hydration, which means a dark-mode user
 * gets a white flash on every cold load -- the one bug that makes people stop
 * using a dark theme. This reads their choice (or the OS setting when they
 * have not made one) and stamps the attribute the CSS keys off, synchronously,
 * before anything is painted.
 *
 * Deliberately inline and tiny: an external file would be a second request in
 * front of the first paint, which is the thing being avoided.
 */
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('onyx-theme');`
  + `if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}`
  + `document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

/** C-05: site-wide defaults, overridden per page by generateMetadata. */
export async function generateMetadata(): Promise<Metadata> {
  const s = await apiSafe<SiteSettings>('/api/settings');
  return {
    title: { default: s?.meta_title ?? s?.system_title ?? 'Onyx LMS', template: `%s | ${s?.system_title ?? 'Onyx LMS'}` },
    description: s?.meta_description ?? '',
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  /*
   * One tree, and StorefrontChrome decides what belongs on it.
   *
   * This used to branch here on `x-pathname` and return a different tree under
   * /onyx -- correct on a fresh load and wrong ever after, because a root
   * layout is not re-rendered on a client-side navigation. Somebody clicking
   * "Sign in" from the marketing page reached the Onyx sign-in screen with the
   * shop's header and footer still wrapped around it, which is the one thing
   * ADR-006 says must not happen. The decision moved to a client component
   * that reads usePathname() and therefore keeps up.
   *
   * Settings and categories are still fetched here, once, for every page that
   * does want the chrome.
   */
  const [settings, categories] = await Promise.all([
    apiSafe<SiteSettings>('/api/settings'),
    apiSafe<CategoryNode[]>('/api/categories'),
  ]);

  return (
    <html lang="en" className={FONTS} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-screen flex-col">
        {/* WCAG 2.4.1: both products repeat the same navigation on every page,
            so a keyboard user gets a way past it. */}
        <a href="#main" className="skip-link">Skip to the main content</a>
        {/* Rendered here on the server, shown or not by the client. Both slots
            are always built, in both directions: render them only for the
            storefront and a soft navigation OUT of Onyx would arrive with no
            header at all -- the same bug facing the other way. */}
        <StorefrontChrome
          header={<SiteHeader settings={settings} categories={categories ?? []} />}
          footer={<SiteFooter settings={settings} />}
        >
          {children}
        </StorefrontChrome>
      </body>
    </html>
  );
}
