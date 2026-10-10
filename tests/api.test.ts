import { describe, expect, it, vi } from 'vitest';
import type { RequestUrlParam, RequestUrlResponse } from 'obsidian';
import { WallosApi } from '../src/api';

const cred = () => ({ baseUrl: 'https://wallos.example.com', apiKey: 'not-a-real-secret' });
const mockReply = (body: object, status = 200): RequestUrlResponse => ({
  status, headers: { 'content-type': 'application/json' }, text: JSON.stringify(body), json: body, arrayBuffer: new ArrayBuffer(0),
});

describe('Wallos v5.8.1 protocol', () => {
  it('sends read operations as form POST without leaking API key into URLs', async () => {
    const transport = vi.fn(async (req: RequestUrlParam) => {
      if (req.url.endsWith('get_subscriptions.php')) return mockReply({ success: true, subscriptions: [] });
      throw new Error('unexpected endpoint');
    });
    const api = new WallosApi(cred, transport);
    expect(await api.getSubscriptions()).toEqual([]);
    const req = transport.mock.calls[0][0];
    expect(req.method).toBe('POST');
    expect(req.url).toBe('https://wallos.example.com/api/subscriptions/get_subscriptions.php');
    expect(req.url).not.toContain('not-a-real-secret');
    expect(String(req.body)).toContain('api_key=not-a-real-secret');
  });

  it('maps edit/delete actions to set_subscriptions endpoint, retaining zero/blank values', async () => {
    const transport = vi.fn(async (_req: RequestUrlParam) => mockReply({ success: true }));
    const api = new WallosApi(cred, transport);
    await api.saveSubscription({ name: 'Test', notify: 0, category_id: '' }, 8);
    await api.deleteSubscription(8);
    const first = new URLSearchParams(String(transport.mock.calls[0][0].body));
    const second = new URLSearchParams(String(transport.mock.calls[1][0].body));
    expect(first.get('action')).toBe('edit');
    expect(first.get('id')).toBe('8');
    expect(first.get('notify')).toBe('0');
    expect(first.get('category_id')).toBe('');
    expect(second.get('action')).toBe('delete');
    expect(second.get('id')).toBe('8');
  });

  it('uses Access service headers only if both secrets are present', async () => {
    const transport = vi.fn(async (_req: RequestUrlParam) => mockReply({ success: true, subscriptions: [] }));
    const api = new WallosApi(() => ({ ...cred(), accessClientId: 'id', accessClientSecret: 'secret' }), transport);
    await api.getSubscriptions();
    expect(transport.mock.calls[0][0].headers).toMatchObject({ 'CF-Access-Client-Id': 'id', 'CF-Access-Client-Secret': 'secret' });
    const incomplete = new WallosApi(() => ({ ...cred(), accessClientId: 'id' }), transport);
    await expect(incomplete.getSubscriptions()).rejects.toThrow(/同时配置/);
  });

  it('recognizes Cloudflare HTML challenge, HTTP deny, and Wallos API errors', async () => {
    const html = new WallosApi(cred, async () => ({ ...mockReply({}), text: '<!doctype html><html></html>' }));
    await expect(html.getSubscriptions()).rejects.toThrow(/未返回 JSON/);
    const denied = new WallosApi(cred, async () => mockReply({}, 403));
    await expect(denied.getSubscriptions()).rejects.toThrow(/Access/);
    const invalid = new WallosApi(cred, async () => mockReply({ success: false, title: 'Invalid API key' }));
    await expect(invalid.getSubscriptions()).rejects.toThrow(/API Key 无效/);
  });

  it('keeps the list usable when optional endpoints fail', async () => {
    const transport = vi.fn(async (options: RequestUrlParam) => {
      if (options.url.endsWith('/get_subscriptions.php')) return mockReply({ success: true, subscriptions: [] });
      if (options.url.endsWith('/get_monthly_cost.php')) return mockReply({ success: true, localized_monthly_cost: '¥99', currency_code: 'CNY' });
      return mockReply({ success: false, title: 'Temporary failure' });
    });
    const data = await new WallosApi(cred, transport).loadDashboard(new Date(2026, 9, 10));
    expect(data.subscriptions).toEqual([]);
    expect(data.monthly?.localized_monthly_cost).toBe('¥99');
    expect(data.metadataWarnings).toContain('币种列表获取失败，暂时无法创建或编辑订阅');
  });
});
