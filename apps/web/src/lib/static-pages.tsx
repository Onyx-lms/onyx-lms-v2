import type { Metadata } from 'next';
import { apiSafe, type SiteSettings } from '@/lib/api';

/**
 * C-07 -- the policy and info pages.
 *
 * Laravel rendered these from settings-driven Blade templates. Same idea here:
 * one component, content resolved from settings, so a copy change is a settings
 * change rather than a deploy.
 */
export const STATIC_PAGES = {
  'about-us': { title: 'About us', settingKey: 'about_us' },
  'faq': { title: 'Frequently asked questions', settingKey: 'faq_content' },
  'privacy-policy': { title: 'Privacy policy', settingKey: 'privacy_policy' },
  'terms-and-condition': { title: 'Terms and conditions', settingKey: 'terms_and_condition' },
  'refund-policy': { title: 'Refund policy', settingKey: 'refund_policy' },
  'cookie-policy': { title: 'Cookie policy', settingKey: 'cookie_policy' },
} as const;

export type StaticPageSlug = keyof typeof STATIC_PAGES;

export async function staticPageMetadata(slug: StaticPageSlug): Promise<Metadata> {
  const page = STATIC_PAGES[slug];
  const settings = await apiSafe<SiteSettings>('/api/settings');
  return {
    title: page.title,
    description: settings?.meta_description ?? page.title,
  };
}

export async function StaticPage({ slug }: { slug: StaticPageSlug }) {
  const page = STATIC_PAGES[slug];
  const content = await apiSafe<Record<string, string | null>>(`/api/settings`);
  const body = content?.[page.settingKey] ?? null;

  return (
    <article className="container-page max-w-3xl py-12">
      <h1 className="text-3xl font-semibold">{page.title}</h1>
      {body ? (
        <div className="mt-6 text-slate-700" dangerouslySetInnerHTML={{ __html: body }} />
      ) : (
        <p className="mt-6 rounded-lg border border-dashed border-slate-300 p-6 text-sm text-slate-500">
          This page has no content yet. An administrator can set it under
          Settings, and it will appear here without a redeploy.
        </p>
      )}
    </article>
  );
}
