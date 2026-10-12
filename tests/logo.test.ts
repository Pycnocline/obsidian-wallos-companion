import { describe, it, expect } from 'vitest';
import {
  wallosLogoUrl, safeLogoSource, logoSearchPath, parseLogoSearchResponse,
  makeLogoMultipart, MAX_LOGO_UPLOAD_BYTES,
} from '../src/logo';

const png = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0,73,72,68,82]);

describe('Wallos logo file paths', () => {
  it('builds a safe URL for the actual uploaded Wallos filename', () => {
    expect(wallosLogoUrl('https://wallos.example.com/', '1761000000-测试订阅.png'))
      .toBe('https://wallos.example.com/images/uploads/logos/1761000000-%E6%B5%8B%E8%AF%95%E8%AE%A2%E9%98%85.png');
    expect(wallosLogoUrl('https://wallos.example.com', '../secret.png')).toBeNull();
    expect(wallosLogoUrl('https://wallos.example.com', 'https://evil.com/a.png')).toBeNull();
    expect(wallosLogoUrl('https://wallos.example.com', '%2e%2e%2fsecret.png')).toBeNull();
    expect(wallosLogoUrl('https://wallos.example.com', 'javascript:alert(1)')).toBeNull();
    expect(wallosLogoUrl('https://wallos.example.com', '')).toBeNull();
  });

  it('validates untrusted online search URLs', () => {
    expect(safeLogoSource('https://cdn.jsdelivr.net/icon.png')).toBe('https://cdn.jsdelivr.net/icon.png');
    expect(safeLogoSource('http://127.0.0.1/icon.png')).toBe('http://127.0.0.1/icon.png');
    expect(safeLogoSource('http://public.example.com/a.png')).toBeNull();
    expect(safeLogoSource('data:image/svg+xml,<svg>')).toBeNull();
    expect(safeLogoSource('https://u:pass@example.com/icon.png')).toBeNull();
  });
});

describe('Wallos existing icon search integration', () => {
  it('routes to official Wallos indexed icon sources and Brave endpoint', () => {
    expect(logoSearchPath('brave', 'Netflix LOGO')).toBe('/endpoints/logos/search.php?search=Netflix%20LOGO&source=brave');
    expect(logoSearchPath('selfhst', 'Nextcloud')).toBe('/endpoints/logos/icon_search.php?search=Nextcloud&source=selfhst');
    expect(logoSearchPath('dashboardicons', 'plex')).toContain('source=dashboardicons');
    expect(() => logoSearchPath('brave', ' ')).toThrow('搜索词');
  });

  it('filters unsafe/duplicated results and never returns URL credentials', () => {
    const result = parseLogoSearchResponse({ results: [
      { image: 'https://icons.example.com/a.png', thumbnail: 'https://icons.example.com/thumb.png' },
      { image: 'https://icons.example.com/a.png' },
      { image: 'javascript:alert(1)' },
      { image: 'http://internal.invalid/icon' },
      { image: 'https://user:password@elsewhere.invalid/b.png' },
      { image: 'https://icons.example.com/b.png', thumbnail: 'file:///secret' },
    ] }, 'brave');
    expect(result).toEqual([
      { image: 'https://icons.example.com/a.png', thumbnail: 'https://icons.example.com/thumb.png', source: 'brave' },
      { image: 'https://icons.example.com/b.png', thumbnail: 'https://icons.example.com/b.png', source: 'brave' },
    ]);
    expect(() => parseLogoSearchResponse({ error: 'rate limited' }, 'brave')).toThrow('rate limited');
  });
});

describe('native Wallos PHP multipart icon upload', () => {
  it('sends binary image content as a real logo file with valid MIME', async () => {
    const image = { name: 'hi.png', type: 'image/png', size: png.length, arrayBuffer: async () => png.buffer as ArrayBuffer };
    const part = await makeLogoMultipart({ api_key: 'test-secret', action: 'edit', id: 8, notes: '中文文本' }, image);
    expect(part.contentType).toMatch(/^multipart\/form-data; boundary=WallosLogo/);
    const bytes = new Uint8Array(part.body);
    const content = new TextDecoder().decode(bytes);
    expect(content).toContain('name="api_key"');
    expect(content).toContain('test-secret');
    expect(content).toContain('name="logo"; filename="wallos-logo.png"');
    expect(content).toContain('Content-Type: image/png');
    expect(content).toContain('中文文本');
    const marker = new TextEncoder().encode('Content-Type: image/png\r\n\r\n');
    const start = bytes.findIndex((_byte, i) =>
      i + marker.length <= bytes.length && marker.every((value, j) => bytes[i + j] === value));
    expect(start).toBeGreaterThan(-1);
    expect([...bytes.slice(start + marker.length, start + marker.length + png.length)]).toEqual([...png]);
    expect(content.endsWith('--\r\n')).toBe(true);
  });

  it('rejects SVG, fake images, size overflow, or mismatched MIME', async () => {
    const f = (bytes: Uint8Array, type: string, size = bytes.length) => ({
      name: 'invalid.jpg', type, size, arrayBuffer: async () => bytes.buffer as ArrayBuffer,
    });
    await expect(makeLogoMultipart({}, f(new TextEncoder().encode('<svg>icon</svg>'), 'image/svg+xml')))
      .rejects.toThrow('只支持');
    await expect(makeLogoMultipart({}, f(png, 'image/jpeg'))).rejects.toThrow('不一致');
    await expect(makeLogoMultipart({}, f(png, 'image/png', MAX_LOGO_UPLOAD_BYTES + 1))).rejects.toThrow('8 MiB');
  });
});
