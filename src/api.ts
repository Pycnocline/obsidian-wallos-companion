import type { RequestUrlParam, RequestUrlResponse } from 'obsidian';
import type { Currency, DashboardData, MonthlyCost, NamedOption, Subscription } from './model';
import { safeHttpsUrl } from './model';

export interface WallosCredentials {
  baseUrl: string;
  apiKey: string;
  accessClientId?: string;
  accessClientSecret?: string;
}
export type Transport = (options: RequestUrlParam) => Promise<RequestUrlResponse>;

interface ApiResponse {
  success?: boolean;
  title?: string;
  message?: string;
  notes?: unknown;
  [key: string]: unknown;
}

const readPath = {
  subscriptions: '/api/subscriptions/get_subscriptions.php',
  monthly: '/api/subscriptions/get_monthly_cost.php',
  currencies: '/api/currencies/get_currencies.php',
  categories: '/api/categories/get_categories.php',
  paymentMethods: '/api/payment_methods/get_payment_methods.php',
  household: '/api/household/get_household.php',
} as const;

/** Wallos 5.8.1 expects x-www-form-urlencoded POST, not JSON or Bearer auth. */
export class WallosApi {
  constructor(private readonly credentials: () => WallosCredentials, private readonly transport: Transport) {}

  private async post<T extends ApiResponse>(path: string, fields: Record<string, string | number | boolean | null | undefined> = {}): Promise<T> {
    const { baseUrl, apiKey, accessClientId, accessClientSecret } = this.credentials();
    const url = safeHttpsUrl(baseUrl);
    if (!url) throw new Error('Wallos 地址无效：请使用 HTTPS URL（本机环回地址允许 HTTP）');
    if (!apiKey.trim()) throw new Error('尚未配置 Wallos API Key，请到插件设置中选择密钥');
    if (Boolean(accessClientId) !== Boolean(accessClientSecret)) {
      throw new Error('Cloudflare Access Service Token 需要同时配置 Client ID 和 Client Secret');
    }

    const data = new URLSearchParams();
    data.set('api_key', apiKey);
    for (const [key, val] of Object.entries(fields)) {
      if (val !== null && val !== undefined) data.set(key, String(val));
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Accept: 'application/json',
    };
    if (accessClientId && accessClientSecret) {
      headers['CF-Access-Client-Id'] = accessClientId;
      headers['CF-Access-Client-Secret'] = accessClientSecret;
    }

    let response: RequestUrlResponse;
    try {
      response = await this.transport({
        url: `${url}${path}`,
        method: 'POST',
        headers,
        body: data.toString(),
        throw: false,
      });
    } catch {
      // Don't propagate errors which could contain secret-bearing POST body/headers.
      throw new Error('网络请求失败。请检查 Wallos 地址、服务器连接和 Cloudflare Access 策略');
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(`访问被拒绝（HTTP ${response.status}）：检查 Cloudflare Access Service Token 与访问策略`);
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Wallos HTTP ${response.status}：检查服务和 API 路径`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(response.text);
    } catch {
      throw new Error('Wallos 未返回 JSON；可能被重定向到 Cloudflare Access 登录页');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Wallos 返回的数据结构无效');
    }
    const result = parsed as T;
    if (result.success !== true) {
      // Wallos error contents are fixed/trusted only when bounded and stripped of secrets.
      const reason = typeof result.title === 'string' ? result.title : 'API 请求失败';
      if (/invalid api key|unauthorized/i.test(reason)) throw new Error('Wallos API Key 无效或已失效');
      throw new Error(`Wallos API 请求失败：${reason.slice(0, 100)}`);
    }
    return result;
  }

  async getSubscriptions(): Promise<Subscription[]> {
    const data = await this.post<ApiResponse>(readPath.subscriptions, { sort: 'next_payment' });
    if (!Array.isArray(data.subscriptions)) throw new Error('Wallos 返回的订阅列表不是数组');
    return data.subscriptions as Subscription[];
  }

  async getMonthlyCost(now: Date): Promise<MonthlyCost> {
    const data = await this.post<ApiResponse>(readPath.monthly, {
      month: now.getMonth() + 1, year: now.getFullYear(),
    });
    if (typeof data.localized_monthly_cost !== 'string') throw new Error('月度费用数据缺失');
    return data as unknown as MonthlyCost;
  }

  async loadDashboard(now = new Date()): Promise<DashboardData> {
    const [subscriptions, monthlyResult, currenciesResult, categoriesResult, paymentResult, householdResult] = await Promise.all([
      this.getSubscriptions(),
      this.getMonthlyCost(now).then((value) => ({ status: 'fulfilled' as const, value }), () => ({ status: 'rejected' as const })),
      this.getOptions<Currency>(readPath.currencies, 'currencies'),
      this.getOptions<NamedOption>(readPath.categories, 'categories'),
      this.getOptions<NamedOption>(readPath.paymentMethods, 'payment_methods'),
      this.getOptions<NamedOption>(readPath.household, 'household'),
    ]);
    const metadataWarnings: string[] = [];
    if (monthlyResult.status === 'rejected') metadataWarnings.push('本月费用获取失败');
    if (!currenciesResult) metadataWarnings.push('币种列表获取失败，暂时无法创建或编辑订阅');
    if (!categoriesResult) metadataWarnings.push('分类列表获取失败');
    if (!paymentResult) metadataWarnings.push('支付方式列表获取失败');
    if (!householdResult) metadataWarnings.push('家庭成员列表获取失败');
    return {
      subscriptions,
      monthly: monthlyResult.status === 'fulfilled' ? monthlyResult.value : null,
      currencies: currenciesResult ?? [],
      categories: categoriesResult ?? [],
      paymentMethods: paymentResult ?? [],
      household: householdResult ?? [],
      metadataWarnings,
    };
  }

  private async getOptions<T>(path: string, prop: string): Promise<T[] | null> {
    try {
      const data = await this.post<ApiResponse>(path);
      return Array.isArray(data[prop]) ? data[prop] as T[] : null;
    } catch {
      return null;
    }
  }

  async saveSubscription(input: Record<string, string | number | boolean | null | undefined>, id?: number): Promise<void> {
    const fields = id ? { ...input, action: 'edit', id } : { ...input, action: 'add' };
    await this.post<ApiResponse>('/api/subscriptions/set_subscriptions.php', fields);
  }

  async deleteSubscription(id: number): Promise<void> {
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('订阅 ID 无效');
    await this.post<ApiResponse>('/api/subscriptions/set_subscriptions.php', { action: 'delete', id });
  }
}
