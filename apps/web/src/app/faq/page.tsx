import { StaticPage, staticPageMetadata } from '@/lib/static-pages';

export const revalidate = 300;
export const generateMetadata = () => staticPageMetadata('faq');

export default function Page() {
  return <StaticPage slug="faq" />;
}
