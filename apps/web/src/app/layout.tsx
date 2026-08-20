import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Fraunces, Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import { apiSafe, type CategoryNode, type SiteSettings } from '@/lib/api';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';


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
  // Onyx is a separate product on this deployment (ADR-006). The storefront
  // header and footer belong to the port alone -- an institutional platform
  // must not wear another product's branding, so under /onyx neither is
  // rendered at all rather than rendered and hidden.
  const onyx = ((await headers()).get('x-pathname') ?? '').startsWith('/onyx');
  if (onyx) {
    return (
      <html lang="en" className={FONTS} suppressHydrationWarning>
        <head>
          <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        </head>
        <body className="flex min-h-screen flex-col">
          {/* WCAG 2.4.1: the Onyx shell repeats the same sidebar on every
              page, so a keyboard user gets a way past it. tabIndex={-1} is
              load-bearing: <main> is not natively focusable, so without it
              following the link only scrolls -- focus stays on the link (or
              falls back to <body>) and a screen reader never announces the
              jump. -1 keeps it out of the normal Tab order; it is only ever
              focused programmatically, by this link. */}
          <a href="#main" className="skip-link">Skip to the main content</a>
          <main id="main" tabIndex={-1} className="flex-1">{children}</main>
        </body>
      </html>
    );
  }

  // Settings and nav are shared by every page, so they are fetched once here.
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
        <a href="#main" className="skip-link">Skip to the main content</a>
        <SiteHeader settings={settings} categories={categories ?? []} />
        <main id="main" tabIndex={-1} className="flex-1">{children}</main>
        <SiteFooter settings={settings} />
      </body>
    </html>
  );
}
