import { redirect } from 'next/navigation';
import { getOnyxSession } from '@/lib/onyx-session';

export default async function OnyxIndex() {
  redirect(await getOnyxSession() ? '/onyx/dashboard' : '/onyx/login');
}
