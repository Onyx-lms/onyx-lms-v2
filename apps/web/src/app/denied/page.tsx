import Link from 'next/link';

export const metadata = { title: 'Not authorized' };

export default function DeniedPage() {
  return (
    <div className="container-page py-24 text-center">
      <h1 className="text-3xl font-semibold">This action is unauthorized</h1>
      <p className="mt-3 text-slate-600">Your account does not have access to that area.</p>
      <Link href="/" className="btn-primary mt-6">Back to the site</Link>
    </div>
  );
}
