/**
 * Server-side API client.
 *
 * Every catalog page renders on the server so the HTML ships complete for
 * crawlers -- which is the whole reason C-05 (SEO fields) exists. Nothing here
 * runs in the browser, so the API base can stay private.
 */
import { appOrigin } from '@/lib/app-origin';

const BASE = appOrigin();

export interface ApiOk<T> { ok: true; data: T; message?: string }
export interface ApiErr { ok: false; message: string; errors?: Record<string, string[]> }

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    // Catalog content changes rarely; revalidate rather than refetch per request.
    next: { revalidate: 60 },
  });
  const body = (await res.json()) as ApiOk<T> | ApiErr;
  if (!body.ok) throw new Error(body.message || `Request failed: ${path}`);
  return body.data;
}

/** Returns null instead of throwing, for optional page sections. */
export async function apiSafe<T>(path: string): Promise<T | null> {
  try { return await api<T>(path); } catch { return null; }
}

export interface Paginated<T> {
  data: T[]; total: number; current_page: number; last_page: number;
  per_page: number; from: number | null; to: number | null;
  next_page_url: string | null; prev_page_url: string | null;
}

export interface CourseCard {
  id: number; title: string | null; slug: string | null; short_description: string | null;
  thumbnail: string | null; level: string | null; language: string | null;
  is_paid: number | null; price: number | null; discount_flag: number | null;
  discounted_price: number | null; instructor_name?: string | null;
}

export interface CategoryNode {
  id: number; title: string | null; slug: string | null; icon: string | null;
  course_count: number; children: CategoryNode[];
}

export interface PageMetadata {
  title: string; description: string; keywords: string; robots: string;
  canonical: string | null;
  og: { title: string; description: string; image: string | null };
  jsonLd: unknown | null;
}

export interface SiteSettings {
  system_title: string | null; footer_text: string | null; footer_link: string | null;
  system_currency: string | null; currency_position: string | null;
  meta_title: string | null; meta_description: string | null;
}
