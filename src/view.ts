import { ItemView, Notice, Platform, setIcon, WorkspaceLeaf } from 'obsidian';
import type WallosCompanionPlugin from './main';
import { DeleteConfirmationModal, SubscriptionModal } from './modals';
import type { DashboardData, Subscription, ViewFilter } from './model';
import { currencyDisplay, dayDifference, dueLabel, periodLabel, subscriptionsForFilter, todayYmd } from './model';

export const VIEW_TYPE_WALLOS = 'wallos-companion-view';

function iconButton(parent: HTMLElement, icon: string, title: string, onClick: () => void, extraClass = ''): HTMLButtonElement {
  const btn = parent.createEl('button', {
    cls: `wallos-icon-button ${extraClass}`.trim(),
    attr: { type: 'button', title, 'aria-label': title },
  });
  setIcon(btn, icon);
  btn.addEventListener('click', onClick);
  return btn;
}

function labelButton(parent: HTMLElement, icon: string, title: string, onClick: () => void, extraClass = ''): HTMLButtonElement {
  const btn = parent.createEl('button', { cls: `wallos-button ${extraClass}`.trim(), attr: { type: 'button' } });
  setIcon(btn.createSpan({ cls: 'wallos-button-icon' }), icon);
  btn.createSpan({ text: title });
  btn.addEventListener('click', onClick);
  return btn;
}

export class WallosView extends ItemView {
  private data: DashboardData | null = null;
  private refreshError: string | null = null;
  private filter: ViewFilter = 'upcoming';
  private search = '';
  private loading = false;
  private requestGeneration = 0;
  private lastSynced: Date | null = null;
  private listContainer: HTMLElement | null = null;
  private refreshButton: HTMLButtonElement | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: WallosCompanionPlugin) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE_WALLOS; }
  getDisplayText(): string { return 'Wallos 订阅'; }
  getIcon(): string { return 'wallet-cards'; }

  async onOpen(): Promise<void> {
    this.render();
    await this.refresh();
  }

  async onClose(): Promise<void> {
    this.requestGeneration++;
    this.listContainer = null;
    this.refreshButton = null;
  }

  async refresh(): Promise<void> {
    if (this.loading) return;
    const generation = ++this.requestGeneration;
    this.loading = true;
    this.refreshError = null;
    this.render();
    try {
      const data = await this.plugin.api.loadDashboard(new Date());
      if (generation !== this.requestGeneration) return;
      this.data = data;
      this.lastSynced = new Date();
    } catch (error) {
      if (generation !== this.requestGeneration) return;
      this.refreshError = error instanceof Error ? error.message : '获取 Wallos 数据失败';
    } finally {
      if (generation === this.requestGeneration) {
        this.loading = false;
        this.render();
      }
    }
  }

  handleSettingsChanged(): void {
    this.render();
  }

  private openEditor(subscription: Subscription | null): void {
    if (!this.data?.currencies.length) {
      new Notice('无法获取币种列表，请先刷新 Wallos 数据');
      return;
    }
    new SubscriptionModal(this.app, this.plugin, this.data, subscription, () => this.refresh()).open();
  }

  private openWallos(): void {
    const url = this.plugin.normalizedBaseUrl();
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  private render(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass('wallos-root');
    const surface = container.createDiv({ cls: 'wallos-surface' });
    const header = surface.createDiv({ cls: 'wallos-header' });
    const name = header.createDiv({ cls: 'wallos-header-name' });
    name.createEl('h2', { text: '订阅管理' });
    name.createEl('p', { text: 'Wallos · 服务端订阅与到期提醒' });
    const headerActions = header.createDiv({ cls: 'wallos-header-actions' });
    this.refreshButton = iconButton(headerActions, 'refresh-cw', '刷新订阅', () => { void this.refresh(); });
    this.refreshButton.disabled = this.loading;
    iconButton(headerActions, 'external-link', '打开 Wallos 网页', () => this.openWallos());
    if (!this.plugin.isConnected()) labelButton(headerActions, 'log-in', '登录', () => { void this.plugin.startLogin().catch(e => new Notice(e.message)); });

    if (this.loading && !this.data) {
      const message = surface.createDiv({ cls: 'wallos-empty' });
      message.createEl('p', { text: '正在从 Wallos 读取订阅…' });
      return;
    }
    if (this.refreshError) {
      const error = surface.createDiv({ cls: 'wallos-alert wallos-error', attr: { role: 'alert' } });
      setIcon(error.createSpan(), 'alert-triangle');
      error.createSpan({ text: this.data ? `刷新失败，以下为上次成功读取的数据：${this.refreshError}` : this.refreshError });
    }
    if (!this.data) {
      const setup = surface.createDiv({ cls: 'wallos-empty' });
      setIcon(setup.createDiv({ cls: 'wallos-empty-icon' }), 'wallet-cards');
      setup.createEl('h3', { text: '连接 Wallos' });
      setup.createEl('p', { text: '在插件设置中选择 Wallos API Key，然后返回刷新。网页 OIDC 登录不会自动授权 API。' });
      labelButton(setup, 'settings', '打开插件设置', () => {
        (this.app as typeof this.app & { setting: { open(): void; openTabById(id: string): void } }).setting.open();
        (this.app as typeof this.app & { setting: { open(): void; openTabById(id: string): void } }).setting.openTabById(this.plugin.manifest.id);
      }, 'mod-cta');
      return;
    }

    const meta = surface.createDiv({ cls: 'wallos-sync-line' });
    meta.setText(this.lastSynced ? `最近同步：${this.lastSynced.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : '尚未同步');
    if (this.loading) meta.createSpan({ text: ' · 刷新中…' });
    if (this.data.metadataWarnings.length) {
      const notes = surface.createDiv({ cls: 'wallos-alert wallos-warning' });
      setIcon(notes.createSpan(), 'info');
      notes.createSpan({ text: this.data.metadataWarnings.join('；') });
    }
    if (this.data.monthly?.notes?.length) {
      const notes = surface.createDiv({ cls: 'wallos-alert wallos-warning' });
      setIcon(notes.createSpan(), 'info');
      notes.createSpan({ text: 'Wallos 费用提示：' + this.data.monthly.notes.join('；') });
    }

    const active = this.data.subscriptions.filter((s) => Number(s.inactive) === 0);
    const sevenDays = active.filter((s) => {
      const days = dayDifference(s.next_payment);
      return days !== null && days >= 0 && days <= 7;
    }).length;
    const metrics = surface.createDiv({ cls: 'wallos-metrics' });
    this.metric(metrics, '本月预计费用', this.data.monthly?.localized_monthly_cost || '—', this.data.monthly?.currency_code || 'Wallos 数据');
    this.metric(metrics, '活跃订阅', String(active.length), '项');
    this.metric(metrics, '未来 7 天续费', String(sevenDays), '项');

    const controls = surface.createDiv({ cls: 'wallos-controls' });
    const searchBox = controls.createDiv({ cls: 'wallos-search-box' });
    setIcon(searchBox.createSpan(), 'search');
    const search = searchBox.createEl('input', {
      cls: 'wallos-search',
      attr: { type: 'search', placeholder: '搜索订阅或分类', 'aria-label': '搜索订阅或分类' },
    }) as HTMLInputElement;
    search.value = this.search;
    search.addEventListener('input', () => {
      this.search = search.value;
      this.renderList();
    });
    labelButton(controls, 'plus', '新增', () => this.openEditor(null), 'mod-cta wallos-add');

    const filterGroup = surface.createDiv({ cls: 'wallos-filters', attr: { role: 'group', 'aria-label': '筛选订阅' } });
    const tabs: { key: ViewFilter; label: string }[] = [
      { key: 'upcoming', label: '即将续费' },
      { key: 'all', label: '全部活跃' },
      { key: 'inactive', label: '已停用' },
    ];
    for (const tab of tabs) {
      const button = filterGroup.createEl('button', {
        cls: `wallos-filter ${this.filter === tab.key ? 'is-active' : ''}`.trim(),
        text: tab.label,
        attr: { type: 'button', 'aria-pressed': String(this.filter === tab.key) },
      });
      button.addEventListener('click', () => {
        this.filter = tab.key;
        for (const control of Array.from(filterGroup.querySelectorAll('button'))) {
          control.toggleClass('is-active', control === button);
          control.setAttribute('aria-pressed', String(control === button));
        }
        this.renderList();
      });
    }
    this.listContainer = surface.createDiv({ cls: 'wallos-list' });
    this.renderList();
    surface.createEl('p', {
      cls: 'wallos-footnote',
      text: '订阅记录仅在本次 Obsidian 会话的内存中显示；到期通知始终由 Wallos 服务端负责。',
    });
  }

  private metric(container: HTMLElement, label: string, value: string, small: string): void {
    const card = container.createDiv({ cls: 'wallos-metric' });
    card.createDiv({ cls: 'wallos-metric-label', text: label });
    card.createDiv({ cls: 'wallos-metric-value', text: value });
    card.createDiv({ cls: 'wallos-metric-foot', text: small });
  }

  private renderList(): void {
    const holder = this.listContainer;
    if (!holder || !this.data) return;
    holder.empty();
    const subs = subscriptionsForFilter(
      this.data.subscriptions, this.filter, this.search, this.plugin.settings.dueSoonDays,
    );
    const title = holder.createDiv({ cls: 'wallos-list-title' });
    title.createSpan({ text: `订阅 ${subs.length} 项` });
    if (this.filter === 'upcoming') title.createSpan({ text: `未来 ${this.plugin.settings.dueSoonDays} 天` });

    if (!subs.length) {
      const empty = holder.createDiv({ cls: 'wallos-list-empty' });
      empty.setText(this.search ? '没有匹配的订阅' : this.filter === 'upcoming' ? '这个时间段内没有即将续费的项目' : '暂无订阅');
      return;
    }
    for (const subscription of subs) this.renderSubscription(holder, subscription);
  }

  private renderSubscription(container: HTMLElement, subscription: Subscription): void {
    if (!this.data) return;
    const card = container.createDiv({ cls: 'wallos-subscription' });
    const identity = card.createDiv({ cls: 'wallos-subscription-identity' });
    const avatar = identity.createDiv({ cls: 'wallos-avatar', text: subscription.name.slice(0, 1).toUpperCase() || '?' });
    avatar.setAttribute('aria-hidden', 'true');
    const detail = identity.createDiv({ cls: 'wallos-subscription-detail' });
    detail.createEl('h3', { text: subscription.name });
    detail.createDiv({
      cls: 'wallos-subscription-meta',
      text: [subscription.category_name, periodLabel(subscription)].filter(Boolean).join(' · '),
    });
    const payment = card.createDiv({ cls: 'wallos-subscription-payment' });
    payment.createDiv({ cls: 'wallos-subscription-price', text: currencyDisplay(subscription, this.data.currencies) });
    const dateLine = payment.createDiv({ cls: 'wallos-subscription-date' });
    if (Number(subscription.inactive) === 1) {
      dateLine.setText('已停用');
    } else {
      dateLine.setText(`${subscription.next_payment || '日期未知'} · ${dueLabel(subscription.next_payment)}`);
      const days = dayDifference(subscription.next_payment);
      if (days !== null && days >= 0 && days <= 7) dateLine.addClass('is-soon');
    }
    const actions = card.createDiv({ cls: 'wallos-subscription-actions' });
    iconButton(actions, 'pencil', `编辑 ${subscription.name}`, () => this.openEditor(subscription));
    if (subscription.url && /^https?:\/\//i.test(subscription.url)) {
      iconButton(actions, 'external-link', `打开 ${subscription.name} 订阅网页`, () => {
        window.open(subscription.url!, '_blank', 'noopener,noreferrer');
      });
    }
    iconButton(actions, 'trash-2', `永久删除 ${subscription.name}`, () => {
      new DeleteConfirmationModal(this.app, this.plugin, subscription, () => this.refresh()).open();
    }, 'wallos-delete-action');
    if (Number(subscription.notify) === 1 && Number(subscription.inactive) === 0) {
      const flag = detail.createSpan({ cls: 'wallos-notification-flag' });
      setIcon(flag.createSpan(), 'bell');
      flag.createSpan({ text: 'Wallos 提醒已开启' });
    }
  }
}
