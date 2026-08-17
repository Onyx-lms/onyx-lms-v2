import type { Metadata } from 'next';
import { headers } from 'next/headers';
import './globals.css';
import { apiSafe, type CategoryNode, type SiteSettings } from '@/lib/api';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';


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
      <html lang="en">
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
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        <a href="#main" className="skip-link">Skip to the main content</a>
        <SiteHeader settings={settings} categories={categories ?? []} />
        <main id="main" tabIndex={-1} className="flex-1">{children}</main>
        <SiteFooter settings={settings} />
      </body>
    </html>
  );
}
