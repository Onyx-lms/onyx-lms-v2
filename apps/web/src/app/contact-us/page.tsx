import type { Metadata } from 'next';
import { ContactForm } from '@/components/contact-form';

export const metadata: Metadata = {
  title: 'Contact us',
  description: 'Get in touch with our team.',
};

export default function ContactPage() {
  return (
    <div className="container-page grid max-w-4xl gap-10 py-12 md:grid-cols-2">
      <div>
        <h1 className="text-3xl font-semibold">Contact us</h1>
        <p className="mt-3 text-slate-600">
          Questions about a course, an invoice or your account? Send us a note and
          we will get back to you.
        </p>
      </div>
      <ContactForm />
    </div>
  );
}
