import Link from 'next/link';
import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { OnyxWorkspace } from '@/components/onyx-workspace';
import { Icon } from '@/components/onyx-ui';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxSession, onyxApi, type Me } from '@/lib/onyx-session';
import type { WorkspaceDetail } from '@/lib/onyx-codelab';

export const metadata: Metadata = { title: 'Workspace' };

const plural = (n: number, one: string, many: string) => n + ' ' + (n === 1 ? one : many);

/** LAB-05 -- one project: its tree, its snapshots and its review. */
export default async function OnyxWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const claims = await requireOnyxSession();
  const { id } = await params;
  const [me, workspace] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApi<WorkspaceDetail>('/api/onyx/workspaces/' + id),
  ]);

  const open = workspace.comments.filter((c) => !c.resolved_at).length;

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title={workspace.title}
      subtitle={workspace.language + ', entry ' + workspace.entry_path
        + ' · ' + plural(workspace.files.length, 'file', 'files')
        + ' · ' + plural(workspace.snapshots.length, 'snapshot', 'snapshots')
        + (open ? ' · ' + plural(open, 'comment open', 'comments open') : '')}
    >
      <nav aria-label="Breadcrumb"
        className="mb-4 flex items-center gap-1.5 text-[13px] text-muted">
        <Link href="/onyx/workspaces"
          className="font-semibold text-brand-600 hover:underline">Workspaces</Link>
        <Icon name="chevron" className="h-3.5 w-3.5 text-faint" />
        <span className="truncate">{workspace.title}</span>
      </nav>

      <OnyxWorkspace
        workspace={workspace}
        isOwner={String(workspace.user_id) === claims.user_id}
        canReview={workspace.can_review}
      />
    </OnyxShell>
  );
}
