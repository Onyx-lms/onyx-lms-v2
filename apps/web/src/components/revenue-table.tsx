import { currency } from '@/lib/format';

export interface RevenueLine {
  source: 'course' | 'bootcamp' | 'team_package' | 'tuition';
  count: number; gross: number; instructor: number; admin: number;
}
export interface Totals {
  lines: RevenueLine[]; gross: number; instructor: number; admin: number; sales: number;
}

const LABEL: Record<RevenueLine['source'], string> = {
  course: 'Courses', bootcamp: 'Workshops',
  team_package: 'Classroom packages', tuition: 'Tuition sessions',
};

/** REV-01 / REV-02 -- the four revenue streams, and what they add up to. */
export function RevenueTable({ totals, position, showAdmin = true }: {
  totals: Totals; position: string; showAdmin?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <thead className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
          <tr>
            <th className="py-2">Stream</th>
            <th>Sales</th>
            <th>Gross</th>
            <th>Instructor</th>
            {showAdmin && <th>Platform</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {totals.lines.map((l) => (
            <tr key={l.source}>
              <td className="py-2 font-medium">{LABEL[l.source]}</td>
              <td>{l.count}</td>
              <td>{currency(l.gross, position)}</td>
              <td>{currency(l.instructor, position)}</td>
              {showAdmin && <td>{currency(l.admin, position)}</td>}
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t border-slate-300 font-medium">
          <tr>
            <td className="py-2">Total</td>
            <td>{totals.sales}</td>
            <td>{currency(totals.gross, position)}</td>
            <td>{currency(totals.instructor, position)}</td>
            {showAdmin && <td>{currency(totals.admin, position)}</td>}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** REV-06 -- a dependency-free bar chart. */
export function RevenueChart({ months, position }: {
  months: { month: string; gross: number }[]; position: string;
}) {
  const peak = Math.max(1, ...months.map((m) => m.gross));
  return (
    <div className="flex h-40 items-end gap-2">
      {months.map((m) => (
        <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
          <div className="w-full rounded-t bg-brand-500"
            style={{ height: Math.max(2, Math.round((m.gross / peak) * 130)) + 'px' }}
            title={m.month + ': ' + currency(m.gross, position)} />
          <span className="text-[10px] text-slate-500">{m.month.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}
