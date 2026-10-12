import type { DashboardData, Subscription } from './model';
import { averageMonthlyCost, dayDifference, todayYmd, validYmd } from './model';

export const OVERVIEW_KINDS = [
  'monthlyAverage', 'monthlyEstimate', 'annualAverage', 'activeCount', 'inactiveCount',
  'due7', 'due30', 'nextRenewal', 'monthlyBudget', 'custom',
] as const;
export type OverviewKind = typeof OVERVIEW_KINDS[number];

export interface OverviewCard {
  id: string;
  kind: OverviewKind;
  title: string;
  note: string;
  tooltip: string;
  valueTemplate: string;
  visible: boolean;
  showNote: boolean;
  showIcon: boolean;
}

interface OverviewPreset { title: string; note: string; icon: string; token: string }
export const OVERVIEW_PRESETS: Record<OverviewKind, OverviewPreset> = {
  monthlyAverage: { title: '平均每月成本', note: '按订阅周期分摊', icon: 'wallet', token: 'monthly_average' },
  monthlyEstimate: { title: '本月预计支出', note: 'Wallos 计划付款金额', icon: 'calendar-days', token: 'monthly_estimate' },
  annualAverage: { title: '平均每年成本', note: '按当前活跃订阅分摊', icon: 'chart-column', token: 'annual_average' },
  activeCount: { title: '活跃订阅', note: '正在使用的服务', icon: 'layers', token: 'active_count' },
  inactiveCount: { title: '停用订阅', note: '已经停止使用的服务', icon: 'archive', token: 'inactive_count' },
  due7: { title: '未来 7 天续费', note: '未来一周的计划付款', icon: 'clock-3', token: 'due_7' },
  due30: { title: '未来 30 天续费', note: '未来一个月的计划付款', icon: 'calendar-clock', token: 'due_30' },
  nextRenewal: { title: '下一笔续费', note: '按照 Wallos 下次付款日期排序', icon: 'calendar-check', token: 'next_renewal' },
  monthlyBudget: { title: '月度预算', note: 'Wallos 服务端预算', icon: 'target', token: 'monthly_budget' },
  custom: { title: '自定义', note: '可填写静态文本或使用 {{active_count}} 等变量', icon: 'pencil', token: '' },
};

const defaultKinds: OverviewKind[] = ['monthlyAverage', 'monthlyEstimate', 'activeCount', 'due7'];

export function makeOverviewCard(kind: OverviewKind, id: string): OverviewCard {
  const p = OVERVIEW_PRESETS[kind];
  return { id, kind, title: p.title, note: p.note, tooltip: '', valueTemplate: '', visible: true, showNote: true, showIcon: true };
}

export function defaultOverviewCards(): OverviewCard[] {
  return defaultKinds.map((kind, index) => makeOverviewCard(kind, 'default-' + index));
}

/** Strictly normalize synced configuration; preserve user-defined order and hidden cards. */
export function normalizeOverviewCards(value: unknown): OverviewCard[] {
  if (!Array.isArray(value)) return defaultOverviewCards();
  const result: OverviewCard[] = [];
  const ids = new Set<string>();
  for (const item of value.slice(0, 16)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const kind = OVERVIEW_KINDS.includes(row.kind as OverviewKind) ? row.kind as OverviewKind : 'custom';
    const fallback = makeOverviewCard(kind, 'item-' + result.length);
    const possible = typeof row.id === 'string' && /^[a-z0-9-]{1,70}$/i.test(row.id) ? row.id : fallback.id;
    const id = ids.has(possible) ? 'item-' + result.length : possible;
    ids.add(id);
    const field = (key: 'title' | 'note' | 'tooltip' | 'valueTemplate', limit: number) =>
      typeof row[key] === 'string' ? row[key].slice(0, limit) : fallback[key];
    result.push({
      id, kind, title: field('title', 80), note: field('note', 250), tooltip: field('tooltip', 250),
      valueTemplate: field('valueTemplate', 250),
      visible: typeof row.visible === 'boolean' ? row.visible : true,
      showNote: typeof row.showNote === 'boolean' ? row.showNote : true,
      showIcon: typeof row.showIcon === 'boolean' ? row.showIcon : true,
    });
  }
  return result;
}

function money(amount: number, code: string): string {
  const normalized = new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 0, maximumFractionDigits: 2,
  }).format(amount);
  return code ? code + ' ' + normalized : normalized;
}

function formatAverage(
  subscriptions: Subscription[], data: DashboardData, canConvert: boolean, annual: boolean,
): string {
  const average = averageMonthlyCost(subscriptions, data.currencies, data.mainCurrencyId, canConvert);
  const scale = annual ? 12 : 1;
  if (average.convertedTotal !== null) return money(average.convertedTotal * scale, average.convertedCode ?? '');
  return average.byCurrency.map(c => money(c.amount * scale, c.code)).join(' / ') || '—';
}

export function overviewValues(
  data: DashboardData, canConvert: boolean, now = new Date(),
): Record<string, string> {
  const active = data.subscriptions.filter(s => Number(s.inactive) !== 1);
  const inactive = data.subscriptions.filter(s => Number(s.inactive) === 1);
  const today = todayYmd(now);
  const next = active.filter(s => validYmd(s.next_payment) && s.next_payment >= today)
    .sort((a, b) => a.next_payment.localeCompare(b.next_payment) || a.name.localeCompare(b.name))[0];
  const due = (days: number) => active.filter(s => {
    const delta = dayDifference(s.next_payment, today);
    return delta !== null && delta >= 0 && delta <= days;
  }).length;
  const budget = data.budget?.monthly_budget;
  const budgetCurrency = data.monthly?.currency_code ||
    data.currencies.find(c => Number(c.id) === data.mainCurrencyId)?.code || '';
  return {
    monthly_average: formatAverage(active, data, canConvert, false),
    monthly_estimate: data.monthly?.localized_monthly_cost || '—',
    annual_average: formatAverage(active, data, canConvert, true),
    active_count: String(active.length),
    inactive_count: String(inactive.length),
    total_count: String(data.subscriptions.length),
    due_7: String(due(7)),
    due_30: String(due(30)),
    next_renewal: next ? next.name + ' · ' + next.next_payment : '—',
    monthly_budget: typeof budget === 'number' && Number.isFinite(budget) ? money(budget, budgetCurrency) : '—',
    month: now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' }),
    today,
  };
}

/** No HTML or expression execution, only a fixed allowlist of text substitutions. */
export function renderOverviewText(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi,
    (match, key: string) => Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match);
}

export function overviewCardContent(card: OverviewCard, values: Record<string, string>): {
  title: string; value: string; note: string; tooltip: string; icon: string;
} {
  const preset = OVERVIEW_PRESETS[card.kind];
  const template = card.valueTemplate.trim() || (preset.token ? '{{' + preset.token + '}}' : '');
  return {
    title: renderOverviewText(card.title, values),
    value: renderOverviewText(template, values) || '—',
    note: card.showNote ? renderOverviewText(card.note, values) : '',
    tooltip: renderOverviewText(card.tooltip, values),
    icon: card.showIcon ? preset.icon : '',
  };
}
