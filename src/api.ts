import type { RequestUrlParam, RequestUrlResponse } from 'obsidian';
import type { BudgetInfo, Currency, DashboardData, MetadataKind, MonthlyCost, NamedOption, PeriodBudget, Subscription, WallosPreferences } from './model';
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

  async getCurrencyBundle(): Promise<{ currencies: Currency[]; mainCurrencyId: number | null }> {
    const result = await this.post<ApiResponse>(readPath.currencies);
    if (!Array.isArray(result.currencies)) throw new Error('币种接口返回格式无效');
    const mainId = Number(result.main_currency);
    return { currencies: result.currencies as Currency[], mainCurrencyId: Number.isSafeInteger(mainId) && mainId > 0 ? mainId : null };
  }

  async getPreferences(): Promise<WallosPreferences> {
    const result = await this.post<ApiResponse>('/api/settings/get_settings.php');
    if (!result.settings || typeof result.settings !== 'object' || Array.isArray(result.settings)) throw new Error('偏好设置返回格式无效');
    return result.settings as WallosPreferences;
  }

  /** Strip secrets from Wallos's notification settings response before returning anything to the view. */
  async getNotificationSummary(): Promise<{ name: string; enabled: boolean; configured: boolean }[]> {
    const result = await this.post<ApiResponse>('/api/notifications/get_notification_settings.php');
    const raw = result.notification_settings;
    // Wallos 5.8.1 returns [] (not {}) when notification_settings has no DB row.
    // An empty array is a valid unconfigured state, not a failed API request.
    const isUnconfigured = Array.isArray(raw) && raw.length === 0;
    if (!isUnconfigured && (!raw || typeof raw !== 'object' || Array.isArray(raw))) {
      throw new Error('通知设置返回格式无效');
    }
    const source = isUnconfigured ? {} : raw as Record<string, unknown>;
    const names: [string, string][] = [
      ['email_notifications', 'Email'], ['discord_notifications', 'Discord'],
      ['gotify_notifications', 'Gotify'], ['ntfy_notifications', 'ntfy'],
      ['pushover_notifications', 'Pushover'], ['telegram_notifications', 'Telegram'],
      ['webhook_notifications', 'Webhooks'], ['serverchan_notifications', 'Server酱'],
    ];
    return names.map(([key, name]) => {
      const value = source[key];
      const configured = Boolean(value && typeof value === 'object' && !Array.isArray(value));
      const enabled = configured && Number((value as Record<string, unknown>).enabled) === 1;
      return { name, enabled, configured };
    });
  }

  async getBudget(): Promise<BudgetInfo> {
    const [user, period] = await Promise.all([
      this.post<ApiResponse>('/api/users/get_user.php'),
      this.post<ApiResponse>('/api/subscriptions/get_period_budget.php').catch(() => null),
    ]);
    const raw = user.user && typeof user.user === 'object' ? user.user as Record<string, unknown> : {};
    // Only retain the budget number. Never retain the returned profile or API credentials.
    return { monthly_budget: Number(raw.budget) || 0, period: period as PeriodBudget | null };
  }

  /** Read 6 calendar-month cash-flow forecasts directly from Wallos. */
  async getMonthlyTrend(now: Date): Promise<{ month: string; cost: MonthlyCost }[]> {
    const dates = Array.from({length: 6}, (_, i) => new Date(now.getFullYear(), now.getMonth() + i - 2, 1));
    return Promise.all(dates.map(async (date) => ({
      month: date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0'),
      cost: await this.getMonthlyCost(date),
    })));
  }

  async loadDashboard(now = new Date()): Promise<DashboardData> {
    const [subscriptions, monthly, currencyBundle, categoriesResult, paymentResult, householdResult, preferences, budget, notificationChannels] = await Promise.all([
      this.getSubscriptions(),
      this.getMonthlyCost(now).catch(() => null),
      this.getCurrencyBundle().catch(() => null),
      this.getOptions<NamedOption>(readPath.categories, 'categories'),
      this.getOptions<NamedOption>(readPath.paymentMethods, 'payment_methods'),
      this.getOptions<NamedOption>(readPath.household, 'household'),
      this.getPreferences().catch(() => null),
      this.getBudget().catch(() => null),
      this.getNotificationSummary().catch(() => null),
    ]);
    const metadataWarnings: string[] = [];
    if (!monthly) metadataWarnings.push('本月费用获取失败');
    if (!currencyBundle) metadataWarnings.push('币种列表获取失败，暂时无法创建或编辑订阅');
    if (!categoriesResult) metadataWarnings.push('分类列表获取失败');
    if (!paymentResult) metadataWarnings.push('支付方式列表获取失败');
    if (!householdResult) metadataWarnings.push('家庭成员列表获取失败');
    if (!preferences) metadataWarnings.push('Wallos 偏好设置读取失败');
    if (!budget) metadataWarnings.push('预算信息读取失败');
    if (!notificationChannels) metadataWarnings.push('通知渠道读取失败');
    return {
      subscriptions, monthly,
      currencies: currencyBundle?.currencies ?? [],
      mainCurrencyId: currencyBundle?.mainCurrencyId ?? null,
      categories: categoriesResult ?? [],
      paymentMethods: paymentResult ?? [],
      household: householdResult ?? [],
      preferences, budget, notificationChannels,
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

  async modifyMetadata(
    kind: MetadataKind, action: 'add' | 'edit' | 'delete',
    fields: Record<string, string | number | null> = {}, id?: number,
  ): Promise<void> {
    const path: Record<MetadataKind, string> = {
      categories: '/api/categories/set_categories.php',
      paymentMethods: '/api/payment_methods/set_payment_methods.php',
      household: '/api/household/set_household.php',
      currencies: '/api/currencies/set_currencies.php',
    };
    if (action !== 'add' && (!Number.isSafeInteger(id) || (id ?? 0) <= 0)) throw new Error('请选择有效的项目');
    if (action !== 'delete' && (!fields.name || !String(fields.name).trim())) throw new Error('名称不能为空');
    await this.post<ApiResponse>(path[kind], { ...fields, action, ...(id == null ? {} : { id }) });
  }

  async savePreferences(fields: Partial<WallosPreferences>): Promise<void> {
    const allowed = ['week_starts_sunday', 'convert_currency', 'hide_disabled', 'disabled_to_bottom', 'show_original_price', 'monthly_price', 'upcoming_payments_limit'] as const;
    const values: Record<string, number> = {};
    for (const key of allowed) {
      const val = fields[key];
      if (val !== undefined) {
        if (!Number.isInteger(val) || val < 0 || (key !== 'upcoming_payments_limit' && val > 1)) throw new Error('偏好设置的值无效');
        values[key] = val;
      }
    }
    if (!Object.keys(values).length) return;
    await this.post<ApiResponse>('/api/settings/set_settings.php', values);
  }

  async saveBudget(fields: { monthly_budget?: number; period_budget?: number; budget_period_type?: string; budget_period_anchor_date?: string }): Promise<void> {
    if (fields.monthly_budget !== undefined && (!Number.isFinite(fields.monthly_budget) || fields.monthly_budget < 0)) throw new Error('月度预算不能为负数');
    if (fields.period_budget !== undefined && (!Number.isFinite(fields.period_budget) || fields.period_budget < 0)) throw new Error('周期预算不能为负数');
    if (fields.budget_period_type && !['weekly', 'fortnightly', 'monthly'].includes(fields.budget_period_type)) throw new Error('预算周期无效');
    await this.post<ApiResponse>('/api/users/set_budget.php', fields);
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
