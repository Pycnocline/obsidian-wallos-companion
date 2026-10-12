import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Wallos stylesheet isolation', () => {
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  it('does not override Obsidian or Notebook Navigator global selectors', () => {
    // Wallos styles must not mutate the tree, leaves, or explorer of another plugin.
    expect(css).not.toMatch(/(^|[,{])\s*(?:html|body|\.workspace(?:-leaf)?|\.nav-folder|\.tree-item|\.notebook-navigator|\.view-content)(?:\s|[{.#:]|$)/m);
  });
  it('uses pane-width queries for narrow desktop sidebars', () => {
    expect(css).toContain('container: wallos-pane / inline-size');
    expect(css).toContain('@container wallos-pane (max-width: 790px)');
    expect(css).toContain('@container wallos-pane (max-width: 390px)');
  });
  it('keeps the redesigned native ledger theme-aware and plugin-scoped', () => {
    const marker = '/* v0.3.5 | Native Obsidian ledger layout.';
    expect(css).toContain(marker);
    const layer = css.slice(css.indexOf(marker));
    expect(layer).toContain('var(--background-primary)');
    expect(layer).toContain('var(--interactive-accent)');
    expect(layer).toContain('@container wallos-pane (max-width: 480px)');
    expect(layer).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(layer).not.toMatch(/(^|[,{])\s*(?:html|body|\.workspace|\.view-content)\b/m);
  });
});
