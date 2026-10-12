import { safeHttpsUrl } from './model';

export type LogoSearchSource = 'selfhst' | 'dashboardicons' | 'brave' | 'duckduckgo';

export interface LogoSearchResult {
  image: string;
  thumbnail: string;
  source: LogoSearchSource;
}

export interface LogoUpload {
  name: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface MultipartBody {
  body: ArrayBuffer;
  contentType: string;
}

export const MAX_LOGO_UPLOAD_BYTES = 8 * 1024 * 1024;
const extensions: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
};

/** Wallos stores an uploaded logo file name, not an arbitrary URL. */
export function wallosLogoUrl(baseUrl: string, logo: unknown): string | null {
  const base = safeHttpsUrl(baseUrl);
  if (!base || typeof logo !== 'string' || !logo || logo.length > 240 ||
      logo.includes('/') || logo.includes('\\') || logo.includes('..') ||
      /[%?#:\u0000-\u001f]/.test(logo) ||
      !/\.(png|jpe?g|gif|webp)$/i.test(logo)) return null;
  return base + '/images/uploads/logos/' + encodeURIComponent(logo);
}

/** Wallos fetches the remote image and stores its own copy (no hotlinking). */
export function safeLogoSource(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 2048 || !raw.trim()) return null;
  try {
    const value = new URL(raw);
    if (!['https:', 'http:'].includes(value.protocol) || value.username || value.password) return null;
    if (value.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(value.hostname)) return null;
    return value.href;
  } catch { return null; }
}

export function logoSearchPath(source: LogoSearchSource, term: string): string {
  const q = term.trim();
  if (!q || q.length > 100) throw new Error('搜索词不能为空且不能超过 100 字');
  const endpoint = source === 'selfhst' || source === 'dashboardicons' ?
    '/endpoints/logos/icon_search.php' : '/endpoints/logos/search.php';
  return endpoint + '?search=' + encodeURIComponent(q) + '&source=' + encodeURIComponent(source);
}

export function parseLogoSearchResponse(value: unknown, source: LogoSearchSource): LogoSearchResult[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('图标搜索返回格式无效');
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.results)) {
    if (typeof record.error === 'string') throw new Error('图标搜索失败：' + record.error.slice(0, 160));
    throw new Error('图标搜索没有返回结果');
  }
  const urls = new Set<string>();
  const results: LogoSearchResult[] = [];
  for (const item of record.results.slice(0, 60)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const image = safeLogoSource(row.image);
    if (!image || urls.has(image)) continue;
    const thumbnail = safeLogoSource(row.thumbnail) || image;
    results.push({ image, thumbnail, source });
    urls.add(image);
    if (results.length >= 30) break;
  }
  return results;
}

export function identifyImageType(bytes: Uint8Array): keyof typeof extensions | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 &&
      bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  const ascii = (offset: number, count: number) => String.fromCharCode(...bytes.slice(offset, offset + count));
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp';
  return null;
}

/**
 * Wallos PHP accepts image files via multipart POST in logo, not base64 or
 * application/x-www-form-urlencoded. Validate signature and keep under 8 MiB.
 */
export async function makeLogoMultipart(
  fields: Record<string, string | number | boolean | null | undefined>,
  file: LogoUpload,
): Promise<MultipartBody> {
  if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_LOGO_UPLOAD_BYTES) {
    throw new Error('图标文件必须在 8 MiB 以内');
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length !== file.size) throw new Error('图标文件大小不一致');
  const type = identifyImageType(bytes);
  if (!type) throw new Error('Wallos 只支持 PNG、JPEG、GIF、WebP 格式的图片文件');
  if (file.type && file.type !== 'application/octet-stream' && file.type !== type) {
    throw new Error('图片格式与文件内容不一致');
  }
  const boundary = 'WallosLogo' + crypto.randomUUID().replace(/-/g, '');
  const encoder = new TextEncoder();
  const blocks: Uint8Array[] = [];
  const add = (data: string) => blocks.push(encoder.encode(data));
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined) continue;
    // The API provides field names, never use untrusted keys as headers.
    if (!/^[a-z][a-z0-9_]*$/i.test(key)) throw new Error('非法表单字段');
    add('--' + boundary + '\r\nContent-Disposition: form-data; name="' + key + '"\r\n\r\n' +
        String(value) + '\r\n');
  }
  const filename = 'wallos-logo.' + extensions[type];
  add('--' + boundary + '\r\nContent-Disposition: form-data; name="logo"; filename="' +
      filename + '"\r\nContent-Type: ' + type + '\r\n\r\n');
  blocks.push(bytes);
  add('\r\n--' + boundary + '--\r\n');

  const total = blocks.reduce((size, block) => size + block.byteLength, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const block of blocks) { joined.set(block, offset); offset += block.byteLength; }
  return { body: joined.buffer, contentType: 'multipart/form-data; boundary=' + boundary };
}
