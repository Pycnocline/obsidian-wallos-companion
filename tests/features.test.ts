import { describe, expect, it } from 'vitest';
import {
  advanceRenewal, averageMonthlyCost, calendarOccurrences, filterSubscriptions,
} from '../src/model';
import type { Currency, Subscription } from '../src/model';
const base: Subscription = {
  id: 1, name: 'Monthly', price: 120, currency_id: 1,
  start_date: '2026-01-01', next_payment: '2026-10-31',
  cycle: 3, frequency: 1, auto_renew: 1, notes: '',
  payment_method_id: 1, payer_user_id: 2, category_id: 1,
  notify: 1, notify_days_before: 3, url: '', inactive: 0, cancellation_date: null,
};
const currencies: Currency[] = [
  {id: 1, name: 'Yuan', code: 'CNY', symbol: '¥', rate: 8},
  {id: 2, name: 'Euro', code: 'EUR', symbol: '€', rate: 1},
];
describe('calendar recurrence anchored to original payment date', () => {
  it('preserves month end on leap and short months', () => {
    expect(advanceRenewal('2024-01-31',3,1,1)).toBe('2024-02-29');
    expect(advanceRenewal('2024-01-31',3,1,2)).toBe('2024-03-31');
    expect(advanceRenewal('2023-01-31',3,1,1)).toBe('2023-02-28');
    expect(advanceRenewal('2024-02-29',4,1,1)).toBe('2025-02-28');
    expect(advanceRenewal('2024-02-29',4,1,4)).toBe('2028-02-29');
  });
  it('supports daily, weekly, annual, multi-month renewals', () => {
    expect(advanceRenewal('2026-10-01',1,3,2)).toBe('2026-10-07');
    expect(advanceRenewal('2026-10-01',2,2,1)).toBe('2026-10-15');
    expect(advanceRenewal('2026-10-01',3,3,1)).toBe('2027-01-01');
    expect(advanceRenewal('2026-10-01',4,2,1)).toBe('2028-10-01');
    expect(advanceRenewal('2026-10-01',0,1,1)).toBeNull();
  });
  it('projects next payments and blocks inactive/cancelled projects', () => {
    const rows = [
      base,
      {...base,id:2,name:'Old',inactive:1},
      {...base,id:3,name:'One off',auto_renew:0},
      {...base,id:4,name:'Cancelled',cancellation_date:'2026-11-15'},
    ];
    const nov=calendarOccurrences(rows,2026,11);
    expect(nov.map(x=>x.subscription.id)).toEqual([1]);
    expect(nov.map(x=>x.date)).toEqual(['2026-11-30']);
    expect(calendarOccurrences(rows,2026,10).map(x=>x.subscription.id)).toEqual([4,1,3]);
  });
  it('does not fabricate historical payments before next known renewal', () => {
    expect(calendarOccurrences([base],2026,9)).toHaveLength(0);
    expect(calendarOccurrences([{...base,next_payment:'2026-01-01',start_date:null,cycle:1}],2026,10)).toHaveLength(31);
  });
  it('does not indefinitely enumerate invalid subscriptions', () => {
    expect(calendarOccurrences([{...base,frequency:0}],2026,10)).toEqual([]);
    expect(calendarOccurrences([],2026,13)).toEqual([]);
  });
});
describe('normalized monthly spend and currency validation', () => {
  it('splits monthly and annual equivalent costs correctly', () => {
    const rows = [
      {...base,price:120,cycle:4,frequency:1},
      {...base,id:2,price:30,cycle:3,frequency:1},
    ];
    const result=averageMonthlyCost(rows,currencies,1,true);
    expect(result.convertedTotal).toBeCloseTo(40,6);
  });
  it('handles daily and weekly charge equivalents', () => {
    const rows = [
      {...base,price:1,cycle:1},
      {...base,id:2,price:7,cycle:2},
    ];
    expect(averageMonthlyCost(rows,currencies).byCurrency[0].amount).toBeCloseTo(365.2425/12*2,5);
  });
  it('keeps currencies separate without verified conversion', () => {
    const rows = [base,{...base,id:2,currency_id:2,price:10}];
    const r=averageMonthlyCost(rows,currencies,1,false);
    expect(r.convertedTotal).toBeNull();
    expect(r.byCurrency).toEqual([
      {currencyId:1,code:'CNY',amount:120},{currencyId:2,code:'EUR',amount:10},
    ]);
    expect(averageMonthlyCost(rows,currencies,1,true).convertedTotal).toBe(200);
    expect(averageMonthlyCost(rows,currencies.map(x=>({...x,rate:undefined})),1,true).convertedTotal).toBeNull();
  });
  it('excludes inactive subscriptions from averages', () => {
    expect(averageMonthlyCost([{...base,inactive:1}],currencies).convertedTotal).toBe(0);
  });
});
describe('category/payment/payer filtering and sorting', () => {
  it('filters by all metadata dimensions including unassigned', () => {
    const rows=[base,{...base,id:2,name:'Else',category_id:null,payment_method_id:null,payer_user_id:null}];
    expect(filterSubscriptions(rows,'all','',30,{categoryId:'1'},'2026-10-01').map(x=>x.id)).toEqual([1]);
    expect(filterSubscriptions(rows,'all','',30,{paymentId:'none',payerId:'none'},'2026-10-01').map(x=>x.id)).toEqual([2]);
  });
  it('supports sorting by name and price without mutating source data', () => {
    const rows=[base,{...base,id:2,name:'Alpha',price:500}];
    expect(filterSubscriptions(rows,'all','',30,{sort:'name'},'2026-10-01')[0].id).toBe(2);
    expect(filterSubscriptions(rows,'all','',30,{sort:'price'},'2026-10-01')[0].id).toBe(2);
    expect(rows[0].id).toBe(1);
  });
});
