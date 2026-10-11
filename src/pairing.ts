import type { RequestUrlParam, RequestUrlResponse } from 'obsidian';
import { safeHttpsUrl } from './model';

export type PairTransport = (req: RequestUrlParam) => Promise<RequestUrlResponse>;
export interface PairStart { id: string; expires_in: number }
export interface PairStatus { status: 'pending' | 'approved' | 'expired'; api_key?: string }

/** Never put the private verifier in any browser URL. */
export class PairingClient {
  constructor(private readonly baseUrl: () => string, private readonly transport: PairTransport) {}

  async call(fields: Record<string, string>): Promise<Record<string, unknown>> {
    const base = safeHttpsUrl(this.baseUrl());
    if (!base) throw new Error('请先配置有效的 Wallos HTTPS 地址');
    const reply = await this.transport({
      url: `${base}/obsidian-pair.php`, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Accept: 'application/json' },
      body: new URLSearchParams(fields).toString(), throw: false,
    });
    if (reply.status === 404) throw new Error('Wallos 尚未安装 Obsidian 配对接口，请先部署 server/obsidian-pair.php');
    if (reply.status !== 200) throw new Error(`配对接口不可用 (HTTP ${reply.status})`);
    let result: Record<string, unknown>;
    try { result = JSON.parse(reply.text) as Record<string, unknown>; }
    catch { throw new Error('认证接口返回了非 JSON 内容；请检查 Cloudflare Access 是否拦截了 API'); }
    if (result.success !== true) throw new Error(typeof result.error === 'string' ? result.error : '配对请求失败');
    return result;
  }

  async start(verifier: string): Promise<PairStart> {
    const r = await this.call({ action: 'start', verifier });
    if (typeof r.id !== 'string' || !/^[0-9a-f]{32}$/.test(r.id)) throw new Error('配对编号无效');
    return { id: r.id, expires_in: Number(r.expires_in) || 600 };
  }
  async claim(id: string, verifier: string): Promise<PairStatus> {
    const r = await this.call({ action: 'claim', id, verifier });
    if (!['pending','approved','expired'].includes(String(r.status))) throw new Error('配对状态无效');
    if (r.status === 'approved' && (typeof r.api_key !== 'string' || !r.api_key)) throw new Error('Wallos 账户缺少 API Key');
    return { status: r.status as PairStatus['status'], api_key: typeof r.api_key === 'string' ? r.api_key : undefined };
  }
}
export function randomVerifier(): string {
  const buffer = new Uint8Array(32);
  crypto.getRandomValues(buffer);
  return Array.from(buffer, (x) => x.toString(16).padStart(2, '0')).join('');
}
