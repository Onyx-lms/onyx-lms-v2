import { StaticPage, staticPageMetadata } from '@/lib/static-pages';

export const revalidate = 300;
export const generateMetadata = () => staticPageMetadata('cookie-policy');

export default function Page() {
  return <StaticPage slug="cookie-policy" />;
}
