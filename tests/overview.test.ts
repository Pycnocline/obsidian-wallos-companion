import { describe, expect, it } from 'vitest';
import type { DashboardData, Subscription } from '../src/model';
import {
  defaultOverviewCards, makeOverviewCard, normalizeOverviewCards, overviewCardContent,
  overviewValues, renderOverviewText,
} from '../src/overview';

const subscription = (overrides: Partial<Subscription> = {}): Subscription => ({
  id: 1, name: 'A', price: 120, currency_id: 1, start_date: null, next_payment: '2026-10-16',
  cycle: 4, frequency: 1, auto_renew: 1, notes: '', payment_method_id: null,
  payer_user_id: null, category_id: null, notify: 1, notify_days_before: 3,
  url: null, inactive: 0, cancellation_date: null, ...overrides,
});
function dashboard(subs: Subscription[]): DashboardData {
  return {
    subscriptions: subs, monthly: { monthly_cost: '10', localized_monthly_cost: 'CNY 10',
      currency_code: 'CNY', currency_symbol: '¥' },
    categories: [], paymentMethods: [], household: [],
    currencies: [{ id: 1, name: 'Yuan', code: 'CNY', symbol: '¥', rate: 1 }],
    mainCurrencyId: 1, metadataWarnings: [], budget: { monthly_budget: 200, period: null },
  };
}

describe('customizable overview cards', () => {
  it('migrates missing configuration to legacy default 4 and preserves explicit empty state', () => {
    expect(normalizeOverviewCards(undefined)).toHaveLength(4);
    expect(normalizeOverviewCards([])).toEqual([]);
    expect(defaultOverviewCards().map(c => c.kind)).toEqual([
      'monthlyAverage', 'monthlyEstimate', 'activeCount', 'due7',
    ]);
  });
  it('preserves order, visibility, user text and blocks arbitrary executable metric kinds', () => {
    const b = makeOverviewCard('due30', 'second');
    b.visible = false; b.title = '付款 {{month}}'; b.note = '提示 {{due_30}}'; b.valueTemplate = '共 {{due_30}} 项';
    const a = makeOverviewCard('custom', 'first');
    a.valueTemplate = '静态内容';
    expect(normalizeOverviewCards([b, a]).map(c => c.id)).toEqual(['second', 'first']);
    expect(normalizeOverviewCards([b, a])[0]).toMatchObject({ visible: false, note: '提示 {{due_30}}' });
    expect(normalizeOverviewCards([{ id: 'bad', kind: '<script>', title: 'safe' }])[0].kind).toBe('custom');
    expect(normalizeOverviewCards([{ id: 'dupe', kind: 'custom' }, { id: 'dupe', kind: 'custom' }])[1].id).not.toBe('dupe');
  });
  it('computes monthly/annual figures, due windows and next renewal from Wallos fields', () => {
    const data = dashboard([subscription(), subscription({ id: 2, name: 'B', price: 30, cycle: 3, next_payment: '2026-10-19' }),
      subscription({ id: 3, inactive: 1, next_payment: '2026-10-13' })]);
    const values = overviewValues(data, true, new Date(2026, 9, 12));
    expect(values.monthly_average).toContain('CNY 40');
    expect(values.annual_average).toContain('CNY 480');
    expect(values.monthly_estimate).toBe('CNY 10');
    expect(values.active_count).toBe('2');
    expect(values.inactive_count).toBe('1');
    expect(values.due_7).toBe('2');
    expect(values.next_renewal).toContain('A · 2026-10-16');
    expect(values.monthly_budget).toContain('CNY 200');
  });
  it('never silently adds independent currencies without exchange rates', () => {
    const data = dashboard([
      subscription(),
      subscription({ id: 2, currency_id: 2, price: 24, cycle: 4 }),
    ]);
    data.currencies.push({ id: 2, name: 'Dollar', code: 'USD', symbol: '$' });
    const result = overviewValues(data, false, new Date(2026, 9, 12));
    expect(result.monthly_average).toContain('CNY 10');
    expect(result.monthly_average).toContain('USD 2');
    expect(result.monthly_average).toContain(' / ');
  });
  it('interpolates only fixed text variables, without evaluating input as code or HTML', () => {
    const vars = { active_count: '2', due_7: '1' };
    const card = makeOverviewCard('custom', 'id');
    card.title = '共 {{active_count}} 项';
    card.valueTemplate = '未付款 {{due_7}} <img src=x>';
    card.note = '提示 {{active_count}}';
    const content = overviewCardContent(card, vars);
    expect(content.title).toBe('共 2 项');
    expect(content.value).toBe('未付款 1 <img src=x>');
    expect(content.note).toBe('提示 2');
    expect(renderOverviewText('{{constructor}} {{active_count}}', vars)).toBe('{{constructor}} 2');
    card.showNote = false; card.showIcon = false;
    expect(overviewCardContent(card, vars).note).toBe('');
    expect(overviewCardContent(card, vars).icon).toBe('');
  });
});
