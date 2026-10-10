/** Wallos v5.8.1 response fields. Unknown fields are not copied to local storage. */
export interface Subscription {
  id: number;
  name: string;
  price: number;
  currency_id: number;
  start_date: string | null;
  next_payment: string;
  cycle: number;
  frequency: number;
  auto_renew: number;
  notes: string | null;
  payment_method_id: number | null;
  payer_user_id: number | null;
  category_id: number | null;
  notify: number;
  notify_days_before: number | null;
  url: string | null;
  inactive: number;
  cancellation_date: string | null;
  category_name?: string | null;
  payment_method_name?: string | null;
  payer_user_name?: string | null;
}

export interface NamedOption { id: number; name: string }
export interface Currency extends NamedOption { code: string; symbol: string }
export interface MonthlyCost {
  monthly_cost: string | number;
  localized_monthly_cost: string;
  currency_code: string;
  currency_symbol: string;
  notes?: string[];
}
export interface DashboardData {
  subscriptions: Subscription[];
  monthly: MonthlyCost | null;
  currencies: Currency[];
  categories: NamedOption[];
  paymentMethods: NamedOption[];
  household: NamedOption[];
  metadataWarnings: string[];
}

export type ViewFilter = 'upcoming' | 'all' | 'inactive';

export function validYmd(raw: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const [year, month, day] = raw.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
}

export function todayYmd(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Calendar-day difference; unaffected by DST and local timezone offset. */
export function dayDifference(date: string, today = todayYmd()): number | null {
  if (!validYmd(date) || !validYmd(today)) return null;
  const utc = (raw: string): number => {
    const [year, month, day] = raw.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((utc(date) - utc(today)) / 86_400_000);
}

export function dueLabel(nextPayment: string, today = todayYmd()): string {
  const days = dayDifference(nextPayment, today);
  if (days === null) return nextPayment || '未设置日期';
  if (days < 0) return `日期已过 ${-days} 天`;
  if (days === 0) return '今天';
  if (days === 1) return '明天';
  return `${days} 天后`;
}

export function periodLabel(subscription: Pick<Subscription, 'frequency' | 'cycle'>): string {
  const unit: Record<number, string> = { 1: '天', 2: '周', 3: '个月', 4: '年' };
  const frequency = Number(subscription.frequency);
  const label = unit[Number(subscription.cycle)];
  if (!label || !Number.isInteger(frequency) || frequency <= 0) return '周期未设置';
  return `每 ${frequency} ${label}`;
}

export function currencyDisplay(subscription: Subscription, currencies: Currency[]): string {
  const currency = currencies.find((item) => Number(item.id) === Number(subscription.currency_id));
  const numeric = Number(subscription.price);
  const amount = Number.isFinite(numeric) ? new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(numeric) : String(subscription.price);
  return `${currency?.code ?? `币种 #${subscription.currency_id}`} ${amount}`;
}

export function subscriptionsForFilter(
  subscriptions: Subscription[], filter: ViewFilter, search: string, soonDays: number,
  today = todayYmd(),
): Subscription[] {
  const term = search.trim().toLocaleLowerCase();
  return subscriptions.filter((s) => {
    if (term && !`${s.name} ${s.category_name ?? ''} ${s.notes ?? ''}`.toLocaleLowerCase().includes(term)) return false;
    if (filter === 'inactive') return Number(s.inactive) === 1;
    if (Number(s.inactive) === 1) return false;
    if (filter !== 'upcoming') return true;
    const days = dayDifference(s.next_payment, today);
    return days !== null && days >= 0 && days <= soonDays;
  }).sort((a, b) => {
    const aDate = validYmd(a.next_payment) ? a.next_payment : '9999-12-31';
    const bDate = validYmd(b.next_payment) ? b.next_payment : '9999-12-31';
    return aDate.localeCompare(bDate) || a.name.localeCompare(b.name);
  });
}

export function safeHttpsUrl(value: string): string | null {
  try {
    const u = new URL(value.trim());
    if (!['https:', 'http:'].includes(u.protocol)) return null;
    if (u.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) return null;
    if (u.username || u.password || u.search || u.hash) return null;
    return u.href.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export function validateSubscriptionForm(input: {
  name: string; price: string; currencyId: string; frequency: string;
  cycle: string; nextPayment: string; startDate: string; notifyDays: string;
}): string | null {
  if (!input.name.trim()) return '请填写订阅名称';
  if (input.name.length > 255) return '订阅名称过长';
  if (!/^(?:\d+)(?:\.\d{1,2})?$/.test(input.price) || !Number.isFinite(Number(input.price))) return '价格需为非负数字，最多两位小数';
  if (!Number.isSafeInteger(Number(input.currencyId)) || Number(input.currencyId) <= 0) return '请选择币种';
  if (!/^[1-9]\d*$/.test(input.frequency) || Number(input.frequency) > 10000) return '续费间隔应为 1–10000 的整数';
  if (![1, 2, 3, 4].includes(Number(input.cycle))) return '请选择续费周期';
  if (!validYmd(input.nextPayment)) return '下次续费日期无效';
  if (input.startDate && !validYmd(input.startDate)) return '开始日期无效';
  if (!/^\d+$/.test(input.notifyDays) || Number(input.notifyDays) > 365) return '提醒提前天数须为 0–365';
  return null;
}
