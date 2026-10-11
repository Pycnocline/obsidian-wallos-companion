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
  replacement_subscription_id?: number | null;
  logo?: string | null;
  category_name?: string | null;
  payment_method_name?: string | null;
  payer_user_name?: string | null;
}

export interface NamedOption { id: number; name: string; in_use?: boolean; email?: string; enabled?: number; order?: number }
export interface Currency extends NamedOption { code: string; symbol: string; rate?: number | string }
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
  mainCurrencyId?: number | null;
  preferences?: WallosPreferences | null;
  budget?: BudgetInfo | null;
  notificationChannels?: { name: string; enabled: boolean }[] | null;
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

/** Optional settings and metadata supported by Wallos 5.8.1. */
export interface WallosPreferences {
  week_starts_sunday?: number;
  convert_currency?: number;
  hide_disabled?: number;
  disabled_to_bottom?: number;
  show_original_price?: number;
  monthly_price?: number;
  upcoming_payments_limit?: number;
}
export interface PeriodBudget {
  period_budget: number;
  amount_needed_this_period: number;
  amount_needed_full_period: number;
  amount_remaining_this_period: number;
  amount_over_budget: number;
  is_over_budget: boolean;
  budget_period_type: 'weekly' | 'fortnightly' | 'monthly';
  budget_period_anchor_date: string;
  period_start: string;
  period_end: string;
  period_label: string;
  currency_code?: string;
  currency_symbol?: string;
}
export interface BudgetInfo {
  monthly_budget: number;
  period: PeriodBudget | null;
}
export type MetadataKind = 'categories' | 'paymentMethods' | 'household' | 'currencies';
export type SortKind = 'next_payment' | 'name' | 'price' | 'category';
export interface AdvancedFilters {
  categoryId?: string;
  paymentId?: string;
  payerId?: string;
  sort?: SortKind;
}
export interface CalendarOccurrence {
  date: string;
  subscription: Subscription;
}
function utcDate(raw: string): number {
  const [y, m, d] = raw.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
function toYmd(time: number): string { return new Date(time).toISOString().slice(0, 10); }

/** Anchor month/year recurrence to original due day to avoid Jan 31 -> Feb 28 -> Mar 28 drift. */
export function advanceRenewal(base: string, cycle: number, frequency: number, intervals: number): string | null {
  if (!validYmd(base) || !Number.isSafeInteger(intervals) || intervals < 0 ||
      !Number.isSafeInteger(frequency) || frequency <= 0 || ![1, 2, 3, 4].includes(cycle)) return null;
  const stride = intervals * frequency;
  if (!Number.isSafeInteger(stride)) return null;
  if (cycle === 1 || cycle === 2) return toYmd(utcDate(base) + stride * (cycle === 1 ? 1 : 7) * 86400000);
  const [y, m, d] = base.split('-').map(Number);
  const targetMonth = y * 12 + m - 1 + stride * (cycle === 4 ? 12 : 1);
  const targetYear = Math.floor(targetMonth / 12);
  if (targetYear > 9999 || targetYear < 1) return null;
  const monthIndex = targetMonth % 12;
  const lastDay = new Date(Date.UTC(targetYear, monthIndex + 1, 0)).getUTCDate();
  return toYmd(Date.UTC(targetYear, monthIndex, Math.min(d, lastDay)));
}

/** Generates projected renewals within one displayed month; never writes to the Vault. */
export function calendarOccurrences(subscriptions: Subscription[], year: number, month: number): CalendarOccurrence[] {
  if (!Number.isInteger(year) || year < 1970 || year > 9998 || !Number.isInteger(month) || month < 1 || month > 12) return [];
  const first = toYmd(Date.UTC(year, month - 1, 1));
  const after = toYmd(Date.UTC(year, month, 1));
  const found: CalendarOccurrence[] = [];
  for (const sub of subscriptions) {
    if (Number(sub.inactive) !== 0 || !validYmd(sub.next_payment)) continue;
    const cycle = Number(sub.cycle), frequency = Number(sub.frequency);
    if (![1, 2, 3, 4].includes(cycle) || !Number.isSafeInteger(frequency) || frequency < 1) continue;
    if (sub.next_payment >= after) continue;
    const isOneOff = Number(sub.auto_renew) === 0;
    let n = 0;
    if (!isOneOff && sub.next_payment < first) {
      if (cycle === 1 || cycle === 2) {
        const daysPer = (cycle === 1 ? 1 : 7) * frequency;
        n = Math.max(0, Math.floor((utcDate(first) - utcDate(sub.next_payment)) / 86400000 / daysPer));
      } else {
        const [baseYear, baseMonth] = sub.next_payment.split('-').map(Number);
        const monthsPer = (cycle === 3 ? 1 : 12) * frequency;
        n = Math.max(0, Math.floor(((year - baseYear) * 12 + month - baseMonth) / monthsPer) - 1);
      }
    }
    for (let count = 0; count < 64; count++, n++) {
      if (isOneOff && n > 0) break;
      const date = advanceRenewal(sub.next_payment, cycle, frequency, n);
      if (!date || date >= after) break;
      if (date < first) continue;
      if (validYmd(sub.start_date ?? '') && date < (sub.start_date ?? '')) continue;
      if (validYmd(sub.cancellation_date ?? '') && date > (sub.cancellation_date ?? '')) break;
      found.push({ date, subscription: sub });
    }
  }
  return found.sort((a, b) => a.date.localeCompare(b.date) || a.subscription.name.localeCompare(b.subscription.name));
}

export interface MonthlyAverage {
  byCurrency: { currencyId: number; code: string; amount: number }[];
  convertedTotal: number | null;
  convertedCode: string | null;
}

/** Equivalent monthly recurring cost, not the actual cash outflow in a calendar month. */
export function averageMonthlyCost(
  subscriptions: Subscription[], currencies: (Currency & { rate?: number | string })[],
  mainCurrencyId: number | null = null, canConvert = false,
): MonthlyAverage {
  const sums = new Map<number, number>();
  for (const s of subscriptions) {
    if (Number(s.inactive) === 1) continue;
    const frequency = Number(s.frequency), price = Number(s.price), cycle = Number(s.cycle);
    if (!Number.isSafeInteger(frequency) || frequency <= 0 || !Number.isFinite(price) || price < 0) continue;
    const months = cycle === 1 ? frequency * 12 / 365.2425 :
      cycle === 2 ? frequency * 12 / (365.2425 / 7) :
      cycle === 3 ? frequency : cycle === 4 ? frequency * 12 : NaN;
    if (!Number.isFinite(months) || months <= 0) continue;
    const id = Number(s.currency_id);
    sums.set(id, (sums.get(id) || 0) + price / months);
  }
  const byCurrency = [...sums].map(([id, amount]) => ({
    currencyId: id, code: currencies.find(c => Number(c.id) === id)?.code ?? '#' + id, amount,
  })).sort((a, b) => a.code.localeCompare(b.code));
  if (byCurrency.length === 0) return { byCurrency, convertedTotal: 0, convertedCode: mainCurrencyId == null ? null : (currencies.find(c => Number(c.id) === mainCurrencyId)?.code ?? null) };
  if (byCurrency.length === 1) return { byCurrency, convertedTotal: byCurrency[0].amount, convertedCode: byCurrency[0].code };
  const main = currencies.find(c => Number(c.id) === mainCurrencyId);
  if (!canConvert || !main || !(Number(main.rate) > 0)) return { byCurrency, convertedTotal: null, convertedCode: null };
  let total = 0;
  for (const c of byCurrency) {
    const rate = Number(currencies.find(x => Number(x.id) === c.currencyId)?.rate);
    if (!(rate > 0)) return { byCurrency, convertedTotal: null, convertedCode: null };
    total += c.amount * Number(main.rate) / rate;
  }
  return { byCurrency, convertedTotal: total, convertedCode: main.code };
}

export function filterSubscriptions(
  subscriptions: Subscription[], filter: ViewFilter, search: string, soonDays: number,
  advanced: AdvancedFilters = {}, today = todayYmd(),
): Subscription[] {
  const matches = subscriptionsForFilter(subscriptions, filter, search, soonDays, today);
  return matches.filter(s =>
    (!advanced.categoryId || String(s.category_id ?? 'none') === advanced.categoryId) &&
    (!advanced.paymentId || String(s.payment_method_id ?? 'none') === advanced.paymentId) &&
    (!advanced.payerId || String(s.payer_user_id ?? 'none') === advanced.payerId)
  ).sort((a, b) => {
    if (advanced.sort === 'name') return a.name.localeCompare(b.name);
    if (advanced.sort === 'price') return Number(b.price) - Number(a.price);
    if (advanced.sort === 'category') return (a.category_name ?? '').localeCompare(b.category_name ?? '');
    return (a.next_payment ?? '').localeCompare(b.next_payment ?? '') || a.name.localeCompare(b.name);
  });
}
