import { ItemView, Notice, Platform, setIcon, WorkspaceLeaf } from 'obsidian';
import type WallosCompanionPlugin from './main';
import { scheduleRefreshAfterLayout } from './workspace';
import { DeleteConfirmationModal, SubscriptionModal } from './modals';
import { FinanceSettingsModal, ResourceManagerModal } from './management';
import type { AdvancedFilters, CalendarOccurrence, DashboardData, MonthlyCost, Subscription, ViewFilter } from './model';
import {
  averageMonthlyCost, calendarOccurrences, currencyDisplay, dayDifference, dueLabel,
  filterSubscriptions, periodLabel, todayYmd,
} from './model';

export const VIEW_TYPE_WALLOS = 'wallos-companion-view';
type Page = 'subscriptions' | 'calendar' | 'statistics' | 'manage';

function iconButton(parent: HTMLElement, icon: string, title: string, onClick: () => void, extra = ''): HTMLButtonElement {
  const b = parent.createEl('button', { cls: 'wallos-icon-button ' + extra, attr: { type: 'button', title, 'aria-label': title } });
  setIcon(b, icon);
  b.addEventListener('click', onClick);
  return b;
}
function actionButton(parent: HTMLElement, icon: string, title: string, onClick: () => void, extra = ''): HTMLButtonElement {
  const b = parent.createEl('button', { cls: 'wallos-button ' + extra, attr: { type: 'button' } });
  setIcon(b.createSpan({ cls: 'wallos-button-icon' }), icon);
  b.createSpan({ text: title });
  b.addEventListener('click', onClick);
  return b;
}
function choose(parent: HTMLElement, label: string, values: {id: string; name: string}[], selected: string,
  changed: (value: string) => void): HTMLSelectElement {
  const field = parent.createEl('label', { cls: 'wallos-filter-field' });
  field.createSpan({ cls: 'wallos-filter-caption', text: label });
  const select = field.createEl('select', { cls: 'wallos-input wallos-filter-select', attr: { 'aria-label': label, title: label } });
  for (const {id, name} of values) {
    const opt = select.createEl('option', { text: name }); opt.value = id;
  }
  select.value = selected;
  select.addEventListener('change', () => changed(select.value));
  return select;
}
function money(amount: number, code: string): string {
  return code + ' ' + new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount);
}
function monthKey(year: number, month: number): string {
  return String(year) + '-' + String(month).padStart(2, '0');
}
function localError(error: unknown): string { return error instanceof Error ? error.message : '请求失败'; }

export class WallosView extends ItemView {
  private data: DashboardData | null = null;
  private refreshError: string | null = null;
  private panel: Page = 'subscriptions';
  private filter: ViewFilter = 'upcoming';
  private advanced: AdvancedFilters = {};
  private search = '';
  private loading = false;
  private requestGeneration = 0;
  private lastSynced: Date | null = null;
  private listContainer: HTMLElement | null = null;
  private monthYear = new Date().getFullYear();
  private monthNumber = new Date().getMonth() + 1;
  private selectedDay: string | null = null;
  private monthCosts = new Map<string, MonthlyCost | null>();
  private trend: { month: string; cost: MonthlyCost }[] | null = null;
  private trendError: string | null = null;
  private trendLoading = false;
  private isClosed = true;
  private cancelInitialRefresh: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: WallosCompanionPlugin) { super(leaf); }
  getViewType(): string { return VIEW_TYPE_WALLOS; }
  getDisplayText(): string { return 'Wallos 订阅'; }
  getIcon(): string { return 'wallet-cards'; }

  async onOpen(): Promise<void> {
    this.isClosed = false;
    this.render();
    // An Obsidian layout restore can open Wallos while Notebook Navigator is
    // still rebuilding its index. Avoid competing with initial workspace setup.
    this.cancelInitialRefresh = scheduleRefreshAfterLayout(this.app.workspace, () => {
      if (!this.isClosed && this.plugin.isConnected() && !this.lastSynced && !this.loading) {
        void this.refresh();
      }
    });
  }
  async onClose(): Promise<void> {
    this.isClosed = true;
    this.cancelInitialRefresh?.();
    this.cancelInitialRefresh = null;
    this.requestGeneration++;
    this.listContainer = null;
  }

  async refresh(): Promise<void> {
    if (this.loading) return;
    const generation = ++this.requestGeneration;
    this.loading = true;
    this.refreshError = null;
    this.render();
    try {
      const fresh = await this.plugin.api.loadDashboard();
      if (generation !== this.requestGeneration) return;
      this.data = fresh;
      this.lastSynced = new Date();
      this.trend = null;
      this.monthCosts.clear();
    } catch (err) {
      if (generation !== this.requestGeneration) return;
      this.refreshError = localError(err);
    } finally {
      if (generation === this.requestGeneration) { this.loading = false; this.render(); }
    }
  }
  handleSettingsChanged(): void { this.render(); }
  private async reloadData(): Promise<DashboardData | null> { await this.refresh(); return this.data; }
  private openEditor(subscription: Subscription | null): void {
    if (!this.data?.currencies.length) { new Notice('币种列表不可用，请刷新后再试'); return; }
    new SubscriptionModal(this.app, this.plugin, this.data, subscription, () => this.refresh()).open();
  }
  private openWallos(): void {
    const url = this.plugin.normalizedBaseUrl();
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  }
  private changePage(page: Page): void {
    this.panel = page;
    this.render();
    if (page === 'statistics' && !this.trend && !this.trendLoading) void this.loadTrend();
    if (page === 'calendar') void this.loadCalendarMonthCost();
  }
  private changeMonth(delta: number): void {
    const date = new Date(this.monthYear, this.monthNumber - 1 + delta, 1);
    this.monthYear = date.getFullYear();
    this.monthNumber = date.getMonth() + 1;
    this.selectedDay = null;
    this.render();
    void this.loadCalendarMonthCost();
  }
  private async loadCalendarMonthCost(): Promise<void> {
    const key = monthKey(this.monthYear, this.monthNumber);
    if (!this.data || this.monthCosts.has(key)) return;
    // Mark the request as underway so re-renders do not start duplicate requests.
    this.monthCosts.set(key, null);
    try {
      const result = await this.plugin.api.getMonthlyCost(new Date(this.monthYear, this.monthNumber - 1, 1));
      this.monthCosts.set(key, result);
    } catch { this.monthCosts.set(key, null); }
    if (this.panel === 'calendar' && monthKey(this.monthYear, this.monthNumber) === key) this.render();
  }
  private async loadTrend(): Promise<void> {
    this.trendLoading = true; this.trendError = null; this.render();
    try { this.trend = await this.plugin.api.getMonthlyTrend(new Date()); }
    catch (e) { this.trendError = localError(e); }
    finally { this.trendLoading = false; if (this.panel === 'statistics') this.render(); }
  }
  private render(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass('wallos-root');
    const surface = container.createDiv({ cls: 'wallos-surface' });
    const header = surface.createDiv({ cls: 'wallos-header' });
    const brand = header.createDiv({ cls: 'wallos-brand' });
    setIcon(brand.createSpan({ cls: 'wallos-brand-mark' }), 'wallet-cards');
    const title = brand.createDiv({ cls: 'wallos-header-name' });
    title.createEl('h2', { text: 'Wallos' });
    title.createEl('p', { text: 'Companion · 订阅管理' });
    const actions = header.createDiv({ cls: 'wallos-header-actions' });
    const refreshButton = iconButton(actions, 'refresh-cw', '刷新数据', () => { void this.refresh(); });
    refreshButton.disabled = this.loading;
    iconButton(actions, 'external-link', '打开 Wallos 网页', () => this.openWallos());
    if (!this.plugin.isConnected()) actionButton(actions, 'settings', '连接', () => this.openPluginSettings());

    if (this.refreshError) {
      const box = surface.createDiv({ cls: 'wallos-alert wallos-error', attr: { role: 'alert' } });
      setIcon(box.createSpan(), 'alert-triangle');
      box.createSpan({ text: this.data ? '刷新失败，显示上次获取的内容：' + this.refreshError : this.refreshError });
    }
    if (!this.data) {
      if (this.loading || (this.plugin.isConnected() && !this.refreshError)) {
        surface.createEl('p', { cls: 'wallos-empty', text: this.loading ?
          '正在读取 Wallos 数据…' : '等待工作区就绪，随后同步 Wallos 数据…' });
      } else if (this.plugin.isConnected()) {
        const empty = surface.createDiv({ cls: 'wallos-empty' });
        empty.createEl('h3', { text: '暂时无法读取订阅' });
        empty.createEl('p', { text: '连接信息已保留，可稍后重试。' });
        actionButton(empty, 'refresh-cw', '重新读取', () => { void this.refresh(); });
      } else {
        const empty = surface.createDiv({ cls: 'wallos-empty' });
        empty.createEl('h3', { text: '连接 Wallos' });
        empty.createEl('p', { text: '在设置中完成 Someday SSO 设备授权，或者指定已有 API Key。' });
        actionButton(empty, 'settings', '打开连接设置', () => this.openPluginSettings(), 'mod-cta');
      }
      return;
    }

    const syncLine = surface.createDiv({ cls: 'wallos-sync-line' });
    syncLine.createSpan({ cls: 'wallos-sync-dot' + (this.refreshError ? ' has-error' : '') });
    syncLine.createSpan({ text: this.lastSynced ?
      '已同步 · ' + this.lastSynced.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) + (this.loading ? ' · 更新中' : '') : '等待首次同步' });
    if (this.data.metadataWarnings.length) {
      const warning = surface.createDiv({ cls: 'wallos-alert wallos-warning' });
      setIcon(warning.createSpan(), 'info');
      warning.createSpan({ text: this.data.metadataWarnings.join('；') });
    }

    this.renderSummary(surface);
    const nav = surface.createDiv({ cls: 'wallos-page-tabs', attr: { role: 'tablist', 'aria-label': 'Wallos 功能' } });
    const pages: { id: Page; label: string; icon: string }[] = [
      { id: 'subscriptions', label: '订阅', icon: 'list' },
      { id: 'calendar', label: '日历', icon: 'calendar-days' },
      { id: 'statistics', label: '统计', icon: 'chart-column' },
      { id: 'manage', label: '分类与设置', icon: 'sliders-horizontal' },
    ];
    pages.forEach(({id, label, icon}) => {
      const tab = actionButton(nav, icon, label, () => this.changePage(id), id === this.panel ? 'is-active' : '');
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(id === this.panel));
    });
    const page = surface.createDiv({ cls: 'wallos-page', attr: { role: 'tabpanel' } });
    if (this.panel === 'subscriptions') this.renderSubscriptionsPanel(page);
    if (this.panel === 'calendar') this.renderCalendarPanel(page);
    if (this.panel === 'statistics') this.renderStatisticsPanel(page);
    if (this.panel === 'manage') this.renderManagementPanel(page);
    surface.createEl('p', { cls: 'wallos-footnote', text: 'Wallos 仍负责订阅记录、汇率和通知。本插件不会把订阅数据写进笔记仓库。' });
  }
  private openPluginSettings(): void {
    const app = this.app as typeof this.app & { setting: { open(): void; openTabById(id: string): void } };
    app.setting.open(); app.setting.openTabById(this.plugin.manifest.id);
  }
  private canConvert(): boolean {
    const notes = this.data?.monthly?.notes;
    return !!this.data?.monthly && Array.isArray(notes) &&
      !notes.some(x => /exchange rates have not been updated/i.test(x));
  }
  private renderSummary(surface: HTMLElement): void {
    const data = this.data!;
    const active = data.subscriptions.filter(s => Number(s.inactive) !== 1);
    const due7 = active.filter(s => { const days = dayDifference(s.next_payment); return days !== null && days >= 0 && days <= 7; }).length;
    const averages = averageMonthlyCost(active, data.currencies, data.mainCurrencyId, this.canConvert());
    const summaryHeader = surface.createDiv({ cls: 'wallos-summary-heading' });
    summaryHeader.createSpan({ text: '财务概览', cls: 'wallos-section-kicker' });
    summaryHeader.createSpan({
      text: new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' }),
      cls: 'wallos-summary-period',
    });
    const metric = surface.createDiv({ cls: 'wallos-metrics wallos-metrics-wide' });
    const avgLabel = averages.convertedTotal === null ? averages.byCurrency.map(c => money(c.amount, c.code)).join(' / ') : money(averages.convertedTotal, averages.convertedCode || '—');
    this.metric(metric, '平均每月成本', avgLabel || '—',
      averages.byCurrency.length > 1 ? (averages.convertedTotal !== null ? '按 Wallos 汇率估算' : '多币种分别计算') : '已按订阅周期分摊', 'wallet');
    this.metric(metric, '本月预计支出', data.monthly?.localized_monthly_cost || '—', '计划续费金额', 'calendar-days');
    this.metric(metric, '活跃订阅', String(active.length), '正在使用的服务', 'layers');
    this.metric(metric, '未来 7 天续费', String(due7), '近期付款项目', 'clock-3');
  }
  private metric(container: HTMLElement, label: string, value: string, desc: string, icon?: string): void {
    const card = container.createDiv({ cls: 'wallos-metric' });
    const heading = card.createDiv({ cls: 'wallos-metric-heading' });
    heading.createSpan({ cls: 'wallos-metric-label', text: label });
    if (icon) setIcon(heading.createSpan({ cls: 'wallos-metric-icon' }), icon);
    card.createDiv({ cls: 'wallos-metric-value', text: value });
    card.createDiv({ cls: 'wallos-metric-foot', text: desc });
  }
  private renderSubscriptionsPanel(surface: HTMLElement): void {
    const data = this.data!;
    const intro = surface.createDiv({ cls: 'wallos-panel-heading' });
    intro.createEl('h3', { text: '订阅清单' });
    intro.createSpan({ text: '按到期时间管理所有服务' });
    const controls = surface.createDiv({ cls: 'wallos-controls' });
    const find = controls.createDiv({ cls: 'wallos-search-box' });
    setIcon(find.createSpan(), 'search');
    const search = find.createEl('input', { cls: 'wallos-search', attr: { type: 'search', placeholder: '按名称、分类或备注搜索', 'aria-label': '搜索订阅' } });
    search.value = this.search;
    search.addEventListener('input', () => { this.search = search.value; this.renderList(); });
    actionButton(controls, 'plus', '新增订阅', () => this.openEditor(null), 'mod-cta wallos-add');
    const filters = surface.createDiv({ cls: 'wallos-filters', attr: { role: 'group', 'aria-label': '订阅状态' } });
    const statusTabs: { id: ViewFilter; title: string }[] = [
      { id: 'upcoming', title: '即将续费' }, { id: 'all', title: '活跃' }, { id: 'inactive', title: '停用' },
    ];
    statusTabs.forEach(({id, title}) => {
      const b = filters.createEl('button', { cls: 'wallos-filter' + (this.filter === id ? ' is-active' : ''), text: title,
        attr: { type: 'button', 'aria-pressed': String(this.filter === id) } });
      b.addEventListener('click', () => { this.filter = id; this.render(); });
    });
    const advanced = surface.createDiv({ cls: 'wallos-advanced-filters' });
    choose(advanced, '按分类', [
      {id: '', name: '全部分类'}, {id:'none', name:'未分类'}, ...data.categories.map(x => ({id:String(x.id), name:x.name})),
    ], this.advanced.categoryId || '', v => {this.advanced.categoryId=v;this.renderList();});
    choose(advanced, '按支付方式', [
      {id:'',name:'全部支付方式'}, {id:'none',name:'未指定'}, ...data.paymentMethods.map(x=>({id:String(x.id),name:x.name})),
    ], this.advanced.paymentId || '', v=>{this.advanced.paymentId=v;this.renderList();});
    choose(advanced, '按付款人', [
      {id:'',name:'全部付款人'}, {id:'none',name:'未指定'}, ...data.household.map(x=>({id:String(x.id),name:x.name})),
    ], this.advanced.payerId || '', v=>{this.advanced.payerId=v;this.renderList();});
    choose(advanced,'排列方式', [
      {id:'next_payment',name:'续费日期'}, {id:'name',name:'名称'}, {id:'price',name:'原币价格'}, {id:'category',name:'分类'},
    ],this.advanced.sort || 'next_payment',v=>{this.advanced.sort=v as AdvancedFilters['sort'];this.renderList();});
    this.listContainer = surface.createDiv({ cls: 'wallos-list' });
    this.renderList();
  }
  private renderList(): void {
    const holder = this.listContainer;
    if (!holder || !this.data) return;
    holder.empty();
    const subs = filterSubscriptions(this.data.subscriptions, this.filter, this.search, this.plugin.settings.dueSoonDays, this.advanced);
    const line = holder.createDiv({ cls: 'wallos-list-title' });
    line.createSpan({ text: '订阅 ' + subs.length + ' 项' });
    if (this.filter === 'upcoming') line.createSpan({ text: '未来 ' + this.plugin.settings.dueSoonDays + ' 天' });
    if (!subs.length) holder.createDiv({ cls: 'wallos-list-empty', text: '没有符合当前筛选条件的订阅' });
    subs.forEach(sub => this.renderSubscription(holder, sub));
  }
  private renderSubscription(container: HTMLElement, sub: Subscription): void {
    const card = container.createDiv({ cls: 'wallos-subscription' + (Number(sub.inactive) === 1 ? ' is-inactive' : '') });
    const identity = card.createDiv({ cls: 'wallos-subscription-identity' });
    identity.createDiv({ cls: 'wallos-avatar', text: sub.name.charAt(0).toUpperCase() || '?' }).setAttribute('aria-hidden', 'true');
    const detail = identity.createDiv({ cls: 'wallos-subscription-detail' });
    detail.createEl('h3', { text: sub.name });
    const subMeta = detail.createDiv({ cls: 'wallos-subscription-meta' });
    if (sub.category_name) subMeta.createSpan({ cls: 'wallos-category-pill', text: sub.category_name });
    subMeta.createSpan({ text: periodLabel(sub) });
    if (sub.payment_method_name) subMeta.createSpan({ text: sub.payment_method_name });
    if (sub.payer_user_name) subMeta.createSpan({ text: sub.payer_user_name });
    const payment = card.createDiv({ cls: 'wallos-subscription-payment' });
    payment.createDiv({ cls: 'wallos-subscription-price', text: currencyDisplay(sub, this.data!.currencies) });
    const dateLine = payment.createDiv({ cls: 'wallos-subscription-date', text: Number(sub.inactive) === 1 ? '已停用' : sub.next_payment + ' · ' + dueLabel(sub.next_payment) });
    const days = dayDifference(sub.next_payment);
    if (days !== null && days >= 0 && days <= 7) dateLine.addClass('is-soon');
    const actions = card.createDiv({ cls: 'wallos-subscription-actions' });
    iconButton(actions, 'pencil', '编辑 ' + sub.name, () => this.openEditor(sub));
    if (sub.url && /^https?:\/\//i.test(sub.url)) iconButton(actions, 'external-link', '打开订阅网页', () => window.open(sub.url!, '_blank', 'noopener,noreferrer'));
    iconButton(actions, 'trash-2', '永久删除 ' + sub.name, () => {
      new DeleteConfirmationModal(this.app, this.plugin, sub, () => this.refresh()).open();
    }, 'wallos-delete-action');
    if (Number(sub.notify) === 1 && Number(sub.inactive) === 0) {
      const flag = detail.createSpan({ cls: 'wallos-notification-flag' });
      setIcon(flag.createSpan(), 'bell');
      flag.createSpan({ text: '服务器提醒已开启' });
    }
  }
  private renderCalendarPanel(surface: HTMLElement): void {
    const data = this.data!;
    const bar = surface.createDiv({ cls: 'wallos-calendar-bar' });
    iconButton(bar, 'chevron-left', '上个月', () => this.changeMonth(-1));
    bar.createEl('h3', { text: String(this.monthYear) + ' 年 ' + String(this.monthNumber) + ' 月' });
    iconButton(bar, 'chevron-right', '下个月', () => this.changeMonth(1));
    actionButton(bar, 'calendar-check', '本月', () => {
      const d = new Date(); this.monthYear=d.getFullYear();this.monthNumber=d.getMonth()+1;this.selectedDay=null;
      this.render();void this.loadCalendarMonthCost();
    });
    const key = monthKey(this.monthYear, this.monthNumber);
    const currentCost = this.monthCosts.get(key);
    surface.createEl('p', { cls: 'wallos-calendar-summary', text: currentCost ?
      'Wallos 预计本月支出：' + currentCost.localized_monthly_cost : '续费事件为计划日期，金额按原币种列示。' });
    const weekStartSunday = Number(data.preferences?.week_starts_sunday) === 1;
    const headers = weekStartSunday ? ['日','一','二','三','四','五','六'] : ['一','二','三','四','五','六','日'];
    const grid = surface.createDiv({ cls: 'wallos-calendar-grid', attr: { role: 'grid', 'aria-label': key + ' 续费日历' } });
    headers.forEach(text => grid.createDiv({ cls:'wallos-calendar-weekday',text }));
    const first = new Date(Date.UTC(this.monthYear,this.monthNumber-1,1)).getUTCDay();
    const offset = weekStartSunday ? first : (first+6)%7;
    for(let pad=0;pad<offset;pad++)grid.createDiv({cls:'wallos-calendar-blank'});
    const maxDay=new Date(Date.UTC(this.monthYear,this.monthNumber,0)).getUTCDate();
    const occ=calendarOccurrences(data.subscriptions,this.monthYear,this.monthNumber);
    const byDay=new Map<string,CalendarOccurrence[]>();
    occ.forEach(row=>byDay.set(row.date,[...(byDay.get(row.date)||[]),row]));
    for(let d=1;d<=maxDay;d++){
      const day=key+'-'+String(d).padStart(2,'0');
      const entries=byDay.get(day)||[];
      const button=grid.createEl('button',{cls:'wallos-calendar-day'+(day===todayYmd()?' is-today':'')+(day===this.selectedDay?' is-selected':''),
        attr:{type:'button','aria-label':day+' · '+entries.length+' 项续费','aria-pressed':String(day===this.selectedDay)}});
      button.createSpan({cls:'wallos-calendar-daynum',text:String(d)});
      if(entries.length){
        button.createSpan({cls:'wallos-calendar-dots',text:String(entries.length)+' 项'});
        button.createSpan({cls:'wallos-calendar-eventname',text:entries.slice(0,2).map(x=>x.subscription.name).join('、')});
      }
      button.addEventListener('click',()=>{this.selectedDay=day;this.render();});
    }
    surface.createEl('p',{cls:'wallos-footnote',text:'日历仅预测下一次续费及自动续订计划，不表示实际扣款。关闭自动续订的项目仅显示下一次。'});
    const eventList=surface.createDiv({cls:'wallos-calendar-events'});
    const selected=this.selectedDay ? byDay.get(this.selectedDay)||[] : occ;
    eventList.createEl('h3',{text:this.selectedDay ? this.selectedDay+' · '+selected.length+' 项' : '本月续费 · '+occ.length+' 次'});
    if(!selected.length)eventList.createEl('p',{text:'此日期暂无预计续费'});
    for(const {date,subscription} of selected){
      const row=eventList.createDiv({cls:'wallos-calendar-event'});
      row.createSpan({text:date.slice(-2)+' 日 · '+subscription.name});
      row.createSpan({text:currencyDisplay(subscription,data.currencies)});
      iconButton(row,'pencil','编辑 '+subscription.name,()=>this.openEditor(subscription));
    }
  }
  private renderStatisticsPanel(surface: HTMLElement): void {
    const data=this.data!;
    const active=data.subscriptions.filter(s=>Number(s.inactive)!==1);
    surface.createEl('h3',{cls:'wallos-section-heading',text:'月度支出趋势'});
    if(this.trendLoading)surface.createEl('p',{cls:'wallos-empty',text:'正在从 Wallos 读取六个月的预计支出…'});
    else if(this.trendError){
      const msg=surface.createDiv({cls:'wallos-alert wallos-error'});
      msg.setText(this.trendError);
      actionButton(surface,'refresh-cw','重新加载趋势',()=>{void this.loadTrend();});
    }else if(this.trend?.length){
      const max=Math.max(0,...this.trend.map(x=>Number(String(x.cost.monthly_cost).replace(/,/g,''))||0));
      const chart=surface.createDiv({cls:'wallos-chart',attr:{'aria-label':'Wallos 六个月预计支出'}});
      this.trend.forEach(({month,cost})=>{
        const v=Number(String(cost.monthly_cost).replace(/,/g,''))||0;
        const col=chart.createDiv({cls:'wallos-chart-col'});
        col.createDiv({cls:'wallos-chart-amount',text:cost.localized_monthly_cost});
        const track=col.createDiv({cls:'wallos-chart-track'});
        track.createDiv({cls:'wallos-chart-bar',attr:{role:'img','aria-label':month+' '+cost.localized_monthly_cost}}).style.height=(max>0?Math.max(4,100*v/max):0)+'%';
        col.createDiv({cls:'wallos-chart-label',text:month.slice(5)});
      });
      surface.createEl('p',{cls:'wallos-footnote',text:'趋势使用 Wallos 每个月的预计扣款金额，不等于平均月费。'});
    } else if(!this.trendLoading)actionButton(surface,'chart-column','读取月度趋势',()=>{void this.loadTrend();});
    surface.createEl('h3',{cls:'wallos-section-heading',text:'分类平均月费'});
    const grouped=new Map<string,Subscription[]>();
    active.forEach(s=>grouped.set(s.category_name||'未分类',[...(grouped.get(s.category_name||'未分类')||[]),s]));
    const classes=[...grouped].sort((a,b)=>b[1].length-a[1].length);
    const categoryList=surface.createDiv({cls:'wallos-stats-categories'});
    if(!classes.length)categoryList.createEl('p',{text:'暂无活跃订阅'});
    classes.forEach(([category,subs])=>{
      const total=averageMonthlyCost(subs,data.currencies,data.mainCurrencyId,this.canConvert());
      const row=categoryList.createDiv({cls:'wallos-stat-category'});
      row.createSpan({text:category+' ('+subs.length+' 项)'});
      row.createSpan({text:total.convertedTotal===null ?
        total.byCurrency.map(x=>money(x.amount,x.code)).join(' / ') :
        money(total.convertedTotal,total.convertedCode||'—')});
    });
    const budget=data.budget;
    if(budget){
      surface.createEl('h3',{cls:'wallos-section-heading',text:'预算'});
      const cards=surface.createDiv({cls:'wallos-metrics'});
      this.metric(cards,'月度预算',money(budget.monthly_budget,data.monthly?.currency_code||''),'在 Wallos 中管理');
      if(budget.period){
        const code=budget.period.currency_code||'';
        this.metric(cards,'当前周期预计支出',money(budget.period.amount_needed_this_period,code),budget.period.period_start+' 至 '+budget.period.period_end);
        this.metric(cards,'周期剩余额度',money(budget.period.amount_remaining_this_period,code),budget.period.is_over_budget?'已超出预算':'');
      }
      actionButton(surface,'sliders-horizontal','修改预算',()=>this.openFinance());
    }
  }
  private renderManagementPanel(surface: HTMLElement): void {
    const data=this.data!;
    surface.createEl('h3',{cls:'wallos-section-heading',text:'分类与数据管理'});
    const counts: {title:string;count:number}[]=[
      {title:'订阅分类',count:data.categories.length},{title:'支付方式',count:data.paymentMethods.length},
      {title:'家庭成员',count:data.household.length},{title:'币种',count:data.currencies.length},
    ];
    const cards=surface.createDiv({cls:'wallos-manager-summary'});
    counts.forEach(({title,count})=>{
      const item=cards.createDiv({cls:'wallos-metric'});
      item.createDiv({cls:'wallos-metric-label',text:title});
      item.createDiv({cls:'wallos-metric-value',text:String(count)});
    });
    actionButton(surface,'tags','管理分类、支付方式、家庭成员与币种',()=>this.openResources(),'mod-cta');
    surface.createEl('h3',{cls:'wallos-section-heading',text:'预算与偏好'});
    actionButton(surface,'sliders-horizontal','修改服务端预算与显示偏好',()=>this.openFinance());
    surface.createEl('p',{cls:'wallos-footnote',text:'修改保存到 Wallos API；其他设备读取的也是相同设置。'});
    surface.createEl('h3',{cls:'wallos-section-heading',text:'Wallos 通知渠道'});
    const channels=surface.createDiv({cls:'wallos-notifications'});
    if(!data.notificationChannels)channels.createEl('p',{text:'通知渠道状态暂不可用'});
    else for(const channel of data.notificationChannels){
      const row=channels.createDiv({cls:'wallos-notification-row'});
      row.createSpan({text:channel.name});
      row.createSpan({text:!channel.configured?'未配置':channel.enabled?'已启用':'未启用',cls:channel.enabled?'wallos-channel-active':'wallos-channel-inactive'});
    }
    const link=surface.createDiv({cls:'wallos-manager-links'});
    actionButton(link,'bell','打开 Wallos 通知设置',()=>this.openWallos());
    actionButton(link,'external-link','完整 Wallos 网页功能',()=>this.openWallos());
  }
  private openResources(): void {
    if (!this.data) return;
    new ResourceManagerModal(this.app,this.plugin,this.data,()=>this.reloadData()).open();
  }
  private openFinance(): void {
    if (!this.data) return;
    new FinanceSettingsModal(this.app,this.plugin,this.data,()=>this.reloadData()).open();
  }
}
