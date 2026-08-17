import { StaticPage, staticPageMetadata } from '@/lib/static-pages';

export const revalidate = 300;
export const generateMetadata = () => staticPageMetadata('about-us');

export default function Page() {
  return <StaticPage slug="about-us" />;
}
