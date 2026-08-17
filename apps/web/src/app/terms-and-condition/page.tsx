import { StaticPage, staticPageMetadata } from '@/lib/static-pages';

export const revalidate = 300;
export const generateMetadata = () => staticPageMetadata('terms-and-condition');

export default function Page() {
  return <StaticPage slug="terms-and-condition" />;
}
