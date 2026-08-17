import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="container-page py-24 text-center">
      <h1 className="text-4xl font-semibold">Page not found</h1>
      <p className="mt-3 text-slate-600">That page does not exist, or is no longer published.</p>
      <Link href="/courses" className="btn-primary mt-6">Browse courses</Link>
    </div>
  );
}
