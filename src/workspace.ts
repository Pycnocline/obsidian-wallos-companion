import type { Workspace, WorkspaceLeaf } from 'obsidian';

type PaneWorkspace = Pick<Workspace,
  'getLeavesOfType' | 'getRightLeaf' | 'getLeaf' | 'revealLeaf'>;

/**
 * A new right-sidebar leaf must be split off, not reused: getRightLeaf(false)
 * may return an existing third-party view (including Notebook Navigator).
 * Never call setViewState on that foreign leaf.
 */
export async function revealWallosLeaf(
  workspace: PaneWorkspace,
  viewType: string,
  mobile: boolean,
): Promise<WorkspaceLeaf> {
  const existing = workspace.getLeavesOfType(viewType)[0];
  if (existing) {
    await workspace.revealLeaf(existing);
    return existing;
  }
  const leaf = mobile
    ? workspace.getLeaf(true)
    : workspace.getRightLeaf(true) ?? workspace.getLeaf(true);
  await leaf.setViewState({ type: viewType, active: true });
  await workspace.revealLeaf(leaf);
  return leaf;
}

/**
 * An open Wallos view can be restored during plugin startup alongside
 * Notebook Navigator. Its remote API burst should start only after workspace
 * layout restoration, preferably at browser idle, and never after close.
 */
export function scheduleRefreshAfterLayout(
  workspace: Pick<Workspace, 'onLayoutReady'>,
  refresh: () => void,
  scheduler: Pick<Window, 'requestIdleCallback' | 'cancelIdleCallback' | 'setTimeout' | 'clearTimeout'> = window,
): () => void {
  let cancelled = false;
  let cancelScheduled: (() => void) | null = null;

  workspace.onLayoutReady(() => {
    if (cancelled) return;
    const run = () => { cancelScheduled = null; if (!cancelled) refresh(); };
    if (typeof scheduler.requestIdleCallback === 'function') {
      const id = scheduler.requestIdleCallback(run, { timeout: 1200 });
      cancelScheduled = () => scheduler.cancelIdleCallback(id);
    } else {
      const id = scheduler.setTimeout(run, 350);
      cancelScheduled = () => scheduler.clearTimeout(id);
    }
  });

  return () => {
    cancelled = true;
    cancelScheduled?.();
    cancelScheduled = null;
  };
}

