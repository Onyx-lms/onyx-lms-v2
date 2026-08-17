import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: { default: 'Onyx LMS', template: '%s · Onyx LMS' },
  description: 'From attendance to employability -- one LMS built around student outcomes.',
  // Scoped to this segment's metadata only: the port keeps its own favicon.
  // Metadata on a segment layout only applies to pages under it, so this
  // never touches the tab icon for the port's own routes.
  icons: { icon: '/onyx-mark.png' },
};

/** Onyx is a separate product sharing this deployment (ADR-006). */
export default function OnyxLayout({ children }: { children: React.ReactNode }) {
  return children;
}
