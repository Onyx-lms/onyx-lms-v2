/**
 * P-08 -- pagination shaped like Laravel's paginate().
 *
 * Keeping the envelope identical means ported list screens and the mobile API
 * (X-05, which is contract-tested for byte compatibility) can read the same
 * field names they read today.
 */
export interface PageLink { url: string | null; label: string; active: boolean }

export interface Paginated<T> {
  current_page: number;
  data: T[];
  first_page_url: string;
  from: number | null;
  last_page: number;
  last_page_url: string;
  links: PageLink[];
  next_page_url: string | null;
  path: string;
  per_page: number;
  prev_page_url: string | null;
  to: number | null;
  total: number;
}

export interface PageQuery { page: number; perPage: number; from: number; to: number }

export function parsePageQuery(q: Record<string, unknown>, defaultPerPage = 15): PageQuery {
  const page = Math.max(1, Number(q['page'] ?? 1) || 1);
  const perPage = Math.min(100, Math.max(1, Number(q['per_page'] ?? defaultPerPage) || defaultPerPage));
  return { page, perPage, from: (page - 1) * perPage, to: page * perPage - 1 };
}

export function paginate<T>(
  rows: T[], total: number, { page, perPage }: PageQuery, path: string,
): Paginated<T> {
  const lastPage = Math.max(1, Math.ceil(total / perPage));
  const url = (p: number) => `${path}?page=${p}`;
  const links: PageLink[] = [
    { url: page > 1 ? url(page - 1) : null, label: '&laquo; Previous', active: false },
  ];
  for (let p = 1; p <= lastPage; p++) {
    links.push({ url: url(p), label: String(p), active: p === page });
  }
  links.push({ url: page < lastPage ? url(page + 1) : null, label: 'Next &raquo;', active: false });

  return {
    current_page: page,
    data: rows,
    first_page_url: url(1),
    from: rows.length ? (page - 1) * perPage + 1 : null,
    last_page: lastPage,
    last_page_url: url(lastPage),
    links,
    next_page_url: page < lastPage ? url(page + 1) : null,
    path,
    per_page: perPage,
    prev_page_url: page > 1 ? url(page - 1) : null,
    to: rows.length ? (page - 1) * perPage + rows.length : null,
    total,
  };
}
