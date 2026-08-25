import Link from 'next/link';
import type { SiteSettings } from '@/lib/api';
import { NewsletterForm } from './newsletter-form';

const POLICY_LINKS = [
  ['/about-us', 'About us'],
  ['/contact-us', 'Contact'],
  ['/faq', 'FAQ'],
  ['/privacy-policy', 'Privacy policy'],
  ['/terms-and-condition', 'Terms'],
  ['/refund-policy', 'Refund policy'],
  ['/cookie-policy', 'Cookie policy'],
] as const;

export function SiteFooter({ settings }: { settings: SiteSettings | null }) {
  return (
    <footer className="mt-16 border-t border-slate-200 bg-slate-50">
      <div className="container-page grid gap-8 py-10 md:grid-cols-3">
        <div>
          <div className="text-base font-semibold text-brand-700">
            {settings?.system_title ?? 'Onyx EduTech'}
          </div>
          <p className="mt-2 text-sm text-slate-600">
            {settings?.meta_description ?? 'Learn from expert instructors.'}
          </p>
        </div>

        <nav className="grid grid-cols-2 gap-2 text-sm">
          {POLICY_LINKS.map(([href, label]) => (
            <Link key={href} href={href} className="text-slate-600 hover:text-brand-600">
              {label}
            </Link>
          ))}
        </nav>

        <div>
          <div className="text-sm font-medium text-slate-700">Newsletter</div>
          <NewsletterForm />
        </div>
      </div>

      <div className="border-t border-slate-200 py-4 text-center text-xs text-slate-500">
        <Link href={settings?.footer_link ?? '/'}>
          {settings?.footer_text ?? 'Onyx EduTech'}
        </Link>
      </div>
    </footer>
  );
}
