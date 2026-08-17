import { StaticPage, staticPageMetadata } from '@/lib/static-pages';

export const revalidate = 300;
export const generateMetadata = () => staticPageMetadata('refund-policy');

export default function Page() {
  return <StaticPage slug="refund-policy" />;
}
