import { describe, expect, it, vi } from 'vitest';
import type { Workspace, WorkspaceLeaf } from 'obsidian';
import { revealWallosLeaf, scheduleRefreshAfterLayout } from '../src/workspace';

const target = 'wallos-companion-view';

function leaf(type: string): WorkspaceLeaf {
  return {
    view: { getViewType: () => type },
    setViewState: vi.fn(async () => undefined),
  } as unknown as WorkspaceLeaf;
}

describe('Obsidian workspace leaf isolation', () => {
  it('opens a separate right sidebar leaf without replacing Notebook Navigator', async () => {
    const notebook = leaf('notebook-navigator');
    const wallos = leaf('empty');
    const workspace = {
      getLeavesOfType: vi.fn(() => []),
      getRightLeaf: vi.fn((split: boolean) => split ? wallos : notebook),
      getLeaf: vi.fn(() => leaf('root')),
      revealLeaf: vi.fn(async (_: WorkspaceLeaf) => undefined),
    };
    await revealWallosLeaf(workspace as unknown as Workspace, target, false);
    expect(workspace.getRightLeaf).toHaveBeenCalledWith(true);
    expect(wallos.setViewState).toHaveBeenCalledWith({type: target, active: true});
    expect(notebook.setViewState).not.toHaveBeenCalled();
    expect(workspace.revealLeaf).toHaveBeenCalledWith(wallos);
  });

  it('only reveals an existing Wallos view and never replaces other sidebar leaves', async () => {
    const existing = leaf(target);
    const workspace = {
      getLeavesOfType: vi.fn(() => [existing]),
      getRightLeaf: vi.fn(),
      getLeaf: vi.fn(),
      revealLeaf: vi.fn(async (_: WorkspaceLeaf) => undefined),
    };
    await revealWallosLeaf(workspace as unknown as Workspace, target, false);
    expect(workspace.getRightLeaf).not.toHaveBeenCalled();
    expect(existing.setViewState).not.toHaveBeenCalled();
    expect(workspace.revealLeaf).toHaveBeenCalledWith(existing);
  });

  it('uses a new central tab on mobile and falls back if right sidebar is unavailable', async () => {
    const rootLeaf = leaf('empty');
    const workspace = {
      getLeavesOfType: vi.fn(() => []),
      getRightLeaf: vi.fn(() => null),
      getLeaf: vi.fn(() => rootLeaf),
      revealLeaf: vi.fn(async () => undefined),
    };
    await revealWallosLeaf(workspace as unknown as Workspace, target, true);
    expect(workspace.getRightLeaf).not.toHaveBeenCalled();
    await revealWallosLeaf(workspace as unknown as Workspace, target, false);
    expect(workspace.getRightLeaf).toHaveBeenCalledWith(true);
    expect(workspace.getLeaf).toHaveBeenCalledWith(true);
  });
});

describe('non-blocking initial refresh', () => {
  it('waits for layout restoration and browser idle instead of fetching during navigator startup', () => {
    let layoutReady: (() => void) | null = null;
    let idleRun: (() => void) | null = null;
    const ws = {onLayoutReady: vi.fn((cb: () => void) => {layoutReady = cb;})};
    const scheduler = {
      requestIdleCallback: vi.fn((cb: () => void) => {idleRun = cb; return 7;}),
      cancelIdleCallback: vi.fn(),
      setTimeout: vi.fn(),
      clearTimeout: vi.fn(),
    };
    const refresh = vi.fn();
    const cleanup = scheduleRefreshAfterLayout(
      ws as unknown as Workspace, refresh, scheduler as unknown as Window,
    );
    expect(refresh).not.toHaveBeenCalled();
    expect(scheduler.requestIdleCallback).not.toHaveBeenCalled();
    (layoutReady as unknown as () => void)();
    expect(scheduler.requestIdleCallback).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
    (idleRun as unknown as () => void)();
    expect(refresh).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('cancels pending fetch when the Wallos leaf closes or reloads', () => {
    let layoutReady: (() => void) | null = null;
    let idleRun: (() => void) | null = null;
    const ws = {onLayoutReady: vi.fn((cb: () => void) => {layoutReady = cb;})};
    const scheduler = {
      requestIdleCallback: vi.fn((cb: () => void) => {idleRun = cb; return 8;}),
      cancelIdleCallback: vi.fn(),
      setTimeout: vi.fn(),
      clearTimeout: vi.fn(),
    };
    const refresh = vi.fn();
    const cleanup = scheduleRefreshAfterLayout(ws as unknown as Workspace, refresh, scheduler as unknown as Window);
    (layoutReady as unknown as () => void)();
    cleanup();
    expect(scheduler.cancelIdleCallback).toHaveBeenCalledWith(8);
    (idleRun as unknown as () => void)();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('uses a cancellable timeout on browsers without requestIdleCallback', () => {
    let layoutReady: (() => void) | null = null;
    let runTimer: (() => void) | null = null;
    const ws = { onLayoutReady: vi.fn((cb: () => void) => { layoutReady = cb; }) };
    const scheduler = {
      requestIdleCallback: undefined,
      cancelIdleCallback: vi.fn(),
      setTimeout: vi.fn((cb: () => void) => { runTimer = cb; return 11; }),
      clearTimeout: vi.fn(),
    };
    const refresh = vi.fn();
    const cleanup = scheduleRefreshAfterLayout(
      ws as unknown as Workspace, refresh, scheduler as unknown as Window,
    );
    (layoutReady as unknown as () => void)();
    expect(scheduler.setTimeout).toHaveBeenCalledWith(expect.any(Function), 350);
    cleanup();
    expect(scheduler.clearTimeout).toHaveBeenCalledWith(11);
    (runTimer as unknown as () => void)();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('does not schedule a fetch if the Wallos view was closed before layout-ready', () => {
    let layoutReady: (() => void) | null = null;
    const ws = {onLayoutReady: vi.fn((cb: () => void) => {layoutReady = cb;})};
    const scheduler = {
      requestIdleCallback: vi.fn(),
      cancelIdleCallback: vi.fn(),
      setTimeout: vi.fn(),
      clearTimeout: vi.fn(),
    };
    const cleanup = scheduleRefreshAfterLayout(ws as unknown as Workspace, vi.fn(), scheduler as unknown as Window);
    cleanup();
    (layoutReady as unknown as () => void)();
    expect(scheduler.requestIdleCallback).not.toHaveBeenCalled();
  });
});

