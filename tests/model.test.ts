import { describe, expect, it } from 'vitest';
import { currencyDisplay, dayDifference, dueLabel, periodLabel, safeHttpsUrl, subscriptionsForFilter, validYmd, validateSubscriptionForm } from '../src/model';
import type { Subscription } from '../src/model';

const sample: Subscription = {
  id: 1, name: 'Music Pro', price: 10.5, currency_id: 1, start_date: '2026-01-01',
  next_payment: '2026-10-15', cycle: 3, frequency: 1, auto_renew: 1,
  notes: '', payment_method_id: null, payer_user_id: null, category_id: null,
  notify: 1, notify_days_before: 3, url: null, inactive: 0, cancellation_date: null,
};

describe('calendar date handling', () => {
  it('handles year, month, leap day and malformed dates', () => {
    expect(validYmd('2024-02-29')).toBe(true);
    expect(validYmd('2025-02-29')).toBe(false);
    expect(validYmd('2026-10-32')).toBe(false);
    expect(dayDifference('2027-01-01', '2026-12-31')).toBe(1);
    expect(dayDifference('2026-10-09', '2026-10-10')).toBe(-1);
    expect(dueLabel('2026-10-10', '2026-10-10')).toBe('今天');
    expect(dueLabel('2026-10-09', '2026-10-10')).toContain('日期已过');
  });
  it('respects Wallos cycle meaning and currency', () => {
    expect(periodLabel({ cycle: 3, frequency: 1 })).toBe('每 1 个月');
    expect(periodLabel({ cycle: 2, frequency: 2 })).toBe('每 2 周');
    expect(currencyDisplay(sample, [{ id: 1, name: 'USD', code: 'USD', symbol: '$' }])).toBe('USD 10.5');
    expect(currencyDisplay(sample, [])).toContain('币种 #1');
  });
  it('sorts and filters upcoming subscriptions without including inactive ones', () => {
    const list = [sample, { ...sample, id: 2, name: 'Old', inactive: 1 },
      { ...sample, id: 3, name: 'Later', next_payment: '2026-12-01' }];
    expect(subscriptionsForFilter(list, 'upcoming', '', 14, '2026-10-10').map((s) => s.id)).toEqual([1]);
    expect(subscriptionsForFilter(list, 'inactive', 'old', 14, '2026-10-10').map((s) => s.id)).toEqual([2]);
    expect(subscriptionsForFilter(list, 'all', '', 14, '2026-10-10').map((s) => s.id)).toEqual([1, 3]);
  });
});

describe('validation and security', () => {
  it('refuses insecure remote Wallos transport and URL-based credentials', () => {
    expect(safeHttpsUrl('http://wallos.example.com')).toBeNull();
    expect(safeHttpsUrl('https://user:pass@wallos.example.com')).toBeNull();
    expect(safeHttpsUrl('https://wallos.example.com?a=123')).toBeNull();
    expect(safeHttpsUrl('http://127.0.0.1:9135')).toBe('http://127.0.0.1:9135');
    expect(safeHttpsUrl('https://wallos.example.com/')).toBe('https://wallos.example.com');
  });
  it('validates all required fields including zero price', () => {
    const input = { name: 'Cloud', price: '0.00', currencyId: '1', frequency: '1', cycle: '3', nextPayment: '2026-10-10', startDate: '2026-09-10', notifyDays: '3' };
    expect(validateSubscriptionForm(input)).toBeNull();
    expect(validateSubscriptionForm({ ...input, price: '-1' })).not.toBeNull();
    expect(validateSubscriptionForm({ ...input, cycle: '5' })).not.toBeNull();
    expect(validateSubscriptionForm({ ...input, nextPayment: '2026-02-30' })).not.toBeNull();
    expect(validateSubscriptionForm({ ...input, notifyDays: '3.5' })).not.toBeNull();
  });
});
