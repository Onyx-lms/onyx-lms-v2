'use client';

import { useRouter } from 'next/navigation';

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      className="btn-ghost w-full"
      onClick={async () => {
        await fetch('/api/auth/logout', { method: 'DELETE' });
        router.push('/login/store');
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}
