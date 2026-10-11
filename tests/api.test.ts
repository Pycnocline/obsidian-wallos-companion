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

describe('Wallos resource, budget and forecast APIs', () => {
  it('sends the verified Wallos parameter names for metadata CRUD', async () => {
    const transport = vi.fn(async (_req: RequestUrlParam) => mockReply({success:true}));
    const api = new WallosApi(cred, transport);
    await api.modifyMetadata('categories','add',{name:'Video'});
    await api.modifyMetadata('paymentMethods','edit',{name:'Card',enabled:0},8);
    await api.modifyMetadata('household','delete',{},3);
    await api.modifyMetadata('currencies','add',{name:'Euro',code:'EUR',symbol:'€',rate:1});
    const reqs=transport.mock.calls.map(([req])=>({url:req.url,body:new URLSearchParams(String(req.body))}));
    expect(reqs[0].url).toMatch(/categories\/set_categories.php$/);
    expect(reqs[0].body.get('action')).toBe('add');
    expect(reqs[1].url).toMatch(/payment_methods\/set_payment_methods.php$/);
    expect(reqs[1].body.get('id')).toBe('8');
    expect(reqs[1].body.get('enabled')).toBe('0');
    expect(reqs[2].body.get('action')).toBe('delete');
    expect(reqs[2].body.get('id')).toBe('3');
    expect(reqs[3].body.get('code')).toBe('EUR');
    expect(reqs.every(x=>x.url.indexOf('api_key=')<0)).toBe(true);
  });
  it('reads currency rates and main currency separately', async () => {
    const api=new WallosApi(cred,async()=>mockReply({success:true,main_currency:2,currencies:[
      {id:2,name:'Euro',code:'EUR',symbol:'€',rate:'1.0000'}]}));
    const bundle=await api.getCurrencyBundle();
    expect(bundle.mainCurrencyId).toBe(2);
    expect(bundle.currencies[0].rate).toBe('1.0000');
  });
  it('reads only a nonsecret budget field from the profile and period budget', async () => {
    const api=new WallosApi(cred,async(req)=>{
      if(req.url.endsWith('get_user.php'))return mockReply({success:true,user:{budget:100,api_key:'sensitive',email:'private@example.com'}});
      return mockReply({success:true,period_budget:400,amount_needed_this_period:50,period_start:'2026-10-01',period_end:'2026-10-31'});
    });
    const value=await api.getBudget();
    expect(value.monthly_budget).toBe(100);
    expect(value.period?.period_budget).toBe(400);
    expect(JSON.stringify(value)).not.toMatch(/sensitive|private@example/);
  });
  it('saves preference and budget with bounded options',async()=>{
    const transport=vi.fn(async(_req: RequestUrlParam)=>mockReply({success:true}));
    const api=new WallosApi(cred,transport);
    await api.savePreferences({week_starts_sunday:1,monthly_price:0});
    await api.saveBudget({monthly_budget:100,period_budget:300,budget_period_type:'monthly',budget_period_anchor_date:'2026-10-01'});
    const prefs=new URLSearchParams(String(transport.mock.calls[0][0].body));
    const budget=new URLSearchParams(String(transport.mock.calls[1][0].body));
    expect(prefs.get('week_starts_sunday')).toBe('1');
    expect(budget.get('period_budget')).toBe('300');
    await expect(api.savePreferences({week_starts_sunday:9})).rejects.toThrow('无效');
    await expect(api.saveBudget({monthly_budget:-1})).rejects.toThrow('负数');
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it('gets six month forecasts including year boundaries',async()=>{
    const transport=vi.fn(async(_req: RequestUrlParam)=>mockReply({success:true,monthly_cost:'25.00',localized_monthly_cost:'€25',currency_code:'EUR'}));
    const api=new WallosApi(cred,transport);
    const values=await api.getMonthlyTrend(new Date(2026,0,11));
    expect(values.map(v=>v.month)).toEqual(['2025-11','2025-12','2026-01','2026-02','2026-03','2026-04']);
    const first=new URLSearchParams(String(transport.mock.calls[0][0].body));
    expect(first.get('month')).toBe('11');
    expect(first.get('year')).toBe('2025');
  });
});



describe('notification secret redaction', () => {
  it('treats Wallos 5.8.1 empty-array notification settings as unconfigured, not a failure', async () => {
    const api = new WallosApi(cred, async () => mockReply({
      success: true, title: 'notification_settings', notification_settings: [], notes: [],
    }));
    const channels = await api.getNotificationSummary();
    expect(channels).toHaveLength(8);
    expect(channels.every(channel => channel.configured === false && channel.enabled === false)).toBe(true);
    expect(channels.some(channel => channel.name === 'ntfy')).toBe(true);
  });

  it('accepts empty-object notifications but rejects malformed nonempty arrays', async () => {
    const empty = new WallosApi(cred, async () => mockReply({success: true, notification_settings: {}}));
    expect((await empty.getNotificationSummary()).every(item => !item.configured)).toBe(true);
    const invalid = new WallosApi(cred, async () => mockReply({success: true, notification_settings: [{enabled: 1}]}));
    await expect(invalid.getNotificationSummary()).rejects.toThrow('通知设置返回格式无效');
  });

  it('keeps the dashboard healthy with an empty notifications response', async () => {
    const api = new WallosApi(cred, async req => {
      if (req.url.endsWith('get_subscriptions.php')) return mockReply({success: true, subscriptions: []});
      if (req.url.endsWith('get_monthly_cost.php')) return mockReply({success: true, localized_monthly_cost: '$0.00', currency_code: 'USD'});
      if (req.url.endsWith('get_currencies.php')) return mockReply({success: true, currencies: [{id: 1, name: 'USD', code: 'USD', symbol: '$'}], main_currency: 1});
      if (req.url.endsWith('get_categories.php')) return mockReply({success: true, categories: []});
      if (req.url.endsWith('get_payment_methods.php')) return mockReply({success: true, payment_methods: []});
      if (req.url.endsWith('get_household.php')) return mockReply({success: true, household: []});
      if (req.url.endsWith('get_settings.php')) return mockReply({success: true, settings: {}});
      if (req.url.endsWith('get_user.php')) return mockReply({success: true, user: {budget: 0}});
      if (req.url.endsWith('get_period_budget.php')) return mockReply({success: true, period_budget: 0});
      if (req.url.endsWith('get_notification_settings.php')) return mockReply({success: true, notification_settings: [], notes: []});
      throw new Error('Unexpected endpoint ' + req.url);
    });
    const data = await api.loadDashboard(new Date(2026, 9, 11));
    expect(data.metadataWarnings).not.toContain('通知渠道读取失败');
    expect(data.notificationChannels).toHaveLength(8);
    expect(data.notificationChannels?.every(ch => !ch.configured)).toBe(true);
  });

  it('only returns enabled flags, not server credentials', async () => {
    const api = new WallosApi(cred, async () => mockReply({success:true,notification_settings:{
      ntfy_notifications: {enabled: 1, headers: 'DO_NOT_LEAK'},
      email_notifications: {enabled: 0, smtp_password: 'DO_NOT_LEAK'},
      discord_notifications: {enabled: 1, webhook_url: 'DO_NOT_LEAK'},
    }}));
    const result = await api.getNotificationSummary();
    expect(result.find(x=>x.name==='ntfy')?.enabled).toBe(true);
    expect(result.find(x=>x.name==='ntfy')?.configured).toBe(true);
    expect(result.find(x=>x.name==='Email')?.enabled).toBe(false);
    expect(result.find(x=>x.name==='Email')?.configured).toBe(true);
    expect(result.find(x=>x.name==='Gotify')?.configured).toBe(false);
    expect(JSON.stringify(result)).not.toContain('DO_NOT_LEAK');
  });
});
