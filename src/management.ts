import { App, Modal, Notice } from 'obsidian';
import type WallosCompanionPlugin from './main';
import type { BudgetInfo, Currency, DashboardData, MetadataKind, NamedOption, WallosPreferences } from './model';
import { todayYmd, validYmd } from './model';

type Resource = NamedOption & Partial<Currency>;
const labelByKind: Record<MetadataKind, string> = {
  categories: '分类',
  paymentMethods: '支付方式',
  household: '家庭成员',
  currencies: '币种',
};
const kinds: MetadataKind[] = ['categories', 'paymentMethods', 'household', 'currencies'];
function requiredText(parent: HTMLElement, label: string, value = ''): HTMLInputElement {
  const row = parent.createDiv({ cls: 'wallos-field' });
  const lab = row.createEl('label', { text: label });
  const field = row.createEl('input', { cls: 'wallos-input', attr: { type: 'text' } });
  lab.addEventListener('click', () => field.focus());
  field.value = value;
  field.maxLength = 255;
  return field;
}
function numberField(parent: HTMLElement, label: string, value: number | string, step = '0.01'): HTMLInputElement {
  const field = requiredText(parent, label, String(value));
  field.type = 'number';
  field.min = '0';
  field.step = step;
  field.inputMode = 'decimal';
  return field;
}
function simpleButton(parent: HTMLElement, text: string, action: () => void, cta = false): HTMLButtonElement {
  const button = parent.createEl('button', { text, cls: 'wallos-button' + (cta ? ' mod-cta' : ''), attr: { type: 'button' } });
  button.addEventListener('click', action);
  return button;
}
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Wallos 请求失败';
}

/** All four resource types are managed through Wallos's own add/edit/delete APIs. */
export class ResourceManagerModal extends Modal {
  private kind: MetadataKind = 'categories';
  private selected: number | null = null;
  private busy = false;
  private message = '';
  constructor(app: App, private readonly plugin: WallosCompanionPlugin, private data: DashboardData,
    private readonly refreshed: () => Promise<DashboardData | null>) { super(app); }

  onOpen(): void {
    this.modalEl.addClass('wallos-dialog', 'wallos-manager');
    this.render();
  }
  private entries(): Resource[] { return this.data[this.kind] as Resource[]; }
  private render(): void {
    this.titleEl.setText('Wallos 数据管理');
    this.contentEl.empty();
    const tabs = this.contentEl.createDiv({ cls: 'wallos-manager-tabs' });
    kinds.forEach(kind => {
      const button = simpleButton(tabs, labelByKind[kind], () => {
        if (this.busy) return;
        this.kind = kind; this.selected = null; this.message = ''; this.render();
      });
      if (kind === this.kind) button.addClass('is-active');
    });
    const info = this.contentEl.createEl('p', {
      cls: 'wallos-footnote',
      text: '直接管理 Wallos 数据。正在使用的项目不能删除；订阅关联不会因重命名而改变。',
    });
    info.style.marginTop = '8px';
    if (this.message) this.contentEl.createEl('p', { cls: 'wallos-alert wallos-error', text: this.message });
    const entries = this.entries();
    const list = this.contentEl.createDiv({ cls: 'wallos-resource-list' });
    for (const item of entries) {
      const row = list.createDiv({ cls: 'wallos-resource-row' });
      const title = row.createDiv({ cls: 'wallos-resource-name' });
      title.createEl('strong', { text: item.name });
      if (this.kind === 'currencies') title.createSpan({ text: ' · ' + (item.code || '') + ' ' + (item.symbol || '') });
      if (this.kind === 'paymentMethods' && Number(item.enabled) === 0) title.createSpan({ text: ' · 已禁用' });
      if (item.in_use) title.createSpan({ cls: 'wallos-resource-used', text: '使用中' });
      const acts = row.createDiv({ cls: 'wallos-resource-actions' });
      simpleButton(acts, '编辑', () => { this.selected = item.id; this.message = ''; this.render(); });
      const del = simpleButton(acts, '删除', () => {
        if (item.in_use || this.busy) return;
        this.showDeleteConfirmation(item);
      });
      del.disabled = Boolean(item.in_use) || this.busy || (this.kind === 'currencies' && item.id === this.data.mainCurrencyId);
      del.title = del.disabled ? '默认币种或已被订阅使用，不能删除' : '永久删除该项目';
    }
    const item = entries.find(x => x.id === this.selected);
    const editor = this.contentEl.createEl('form', { cls: 'wallos-form wallos-manager-form' });
    editor.createEl('h3', { text: (item ? '编辑' : '新增') + labelByKind[this.kind] });
    const fields = editor.createDiv({ cls: 'wallos-fields' });
    const name = requiredText(fields, '名称', item?.name || '');
    name.required = true;
    const extras: Record<string, HTMLInputElement> = {};
    if (this.kind === 'household') extras.email = requiredText(fields, '邮箱（可选）', item?.email || '');
    if (this.kind === 'currencies') {
      extras.code = requiredText(fields, 'ISO 币种代码', item?.code || '');
      extras.symbol = requiredText(fields, '币种符号', item?.symbol || '');
      extras.rate = numberField(fields, '兑换率（相对基准）', item?.rate ?? 1, 'any');
      extras.code.required = true; extras.symbol.required = true; extras.rate.required = true;
    }
    if (this.kind === 'paymentMethods') {
      const row = fields.createEl('label', { cls: 'wallos-check' });
      extras.enabled = row.createEl('input', { attr: { type: 'checkbox' } });
      extras.enabled.checked = item ? Number(item.enabled) !== 0 : true;
      row.createSpan({ text: '启用此支付方式' });
    }
    const actions = editor.createDiv({ cls: 'wallos-form-actions' });
    if (item) simpleButton(actions, '取消编辑', () => { this.selected = null; this.render(); });
    const save = editor.createEl('button', { text: item ? '保存修改' : '添加', cls: 'wallos-button mod-cta', attr: { type: 'submit' } });
    actions.appendChild(save);
    editor.addEventListener('submit', ev => {
      ev.preventDefault();
      if (this.busy) return;
      const payload: Record<string, string | number | null> = { name: name.value.trim() };
      if (!payload.name) { this.message = '名称不能为空'; this.render(); return; }
      if (this.kind === 'household') {
        const email = extras.email.value.trim();
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { this.message = '邮箱地址格式无效'; this.render(); return; }
        payload.email = email;
      }
      if (this.kind === 'currencies') {
        const code = extras.code.value.trim().toUpperCase();
        const symbol = extras.symbol.value.trim();
        const rate = Number(extras.rate.value);
        if (!/^[A-Z]{3}$/.test(code) || !symbol || !Number.isFinite(rate) || rate <= 0) {
          this.message = '请填写三位币种代码、符号及有效的正数汇率'; this.render(); return;
        }
        Object.assign(payload, { code, symbol, rate });
      }
      if (this.kind === 'paymentMethods') payload.enabled = extras.enabled.checked ? 1 : 0;
      void this.mutate(item ? 'edit' : 'add', payload, item?.id);
    });
  }
  private showDeleteConfirmation(item: Resource): void {
    this.contentEl.empty();
    this.titleEl.setText('确认删除' + labelByKind[this.kind]);
    this.contentEl.createEl('p', { text: '将从 Wallos 永久删除「' + item.name + '」。此操作无法撤销。' });
    const actions = this.contentEl.createDiv({ cls: 'wallos-form-actions' });
    simpleButton(actions, '取消', () => this.render());
    simpleButton(actions, '确认删除', () => { void this.mutate('delete', {}, item.id); }, true);
  }
  private async mutate(action: 'add' | 'edit' | 'delete', payload: Record<string, string | number | null>, id?: number): Promise<void> {
    this.busy = true;
    try {
      await this.plugin.api.modifyMetadata(this.kind, action, payload, id);
      new Notice('Wallos ' + labelByKind[this.kind] + '已更新');
      this.selected = null;
      this.message = '';
      const latest = await this.refreshed();
      if (latest) this.data = latest;
    } catch (e) {
      this.message = errorText(e);
    } finally { this.busy = false; this.render(); }
  }
}

/** Wallos server-side preferences and budget, not Obsidian-only cosmetic settings. */
export class FinanceSettingsModal extends Modal {
  private busy = false;
  constructor(app: App, private readonly plugin: WallosCompanionPlugin, private data: DashboardData,
    private readonly refreshed: () => Promise<DashboardData | null>) { super(app); }
  onOpen(): void { this.modalEl.addClass('wallos-dialog'); this.render(); }
  private render(): void {
    this.contentEl.empty();
    this.titleEl.setText('Wallos 预算与偏好');
    const budget: BudgetInfo = this.data.budget || { monthly_budget: 0, period: null };
    const form = this.contentEl.createEl('form', { cls: 'wallos-form' });
    form.createEl('h3', { text: '预算' });
    const fields = form.createDiv({ cls: 'wallos-fields' });
    const monthly = numberField(fields, '月度预算', budget.monthly_budget);
    const period = numberField(fields, '周期预算', budget.period?.period_budget ?? 0);
    const typeRow = fields.createDiv({ cls: 'wallos-field' });
    typeRow.createEl('label', { text: '预算周期' });
    const periodType = typeRow.createEl('select', { cls: 'wallos-input' });
    for (const [value, title] of [['weekly', '每周'], ['fortnightly', '每两周'], ['monthly', '每月']]) {
      const opt = periodType.createEl('option', { text: title }); opt.value = value;
    }
    periodType.value = budget.period?.budget_period_type || 'monthly';
    const anchor = requiredText(fields, '预算锚点日期', budget.period?.budget_period_anchor_date || todayYmd());
    anchor.type = 'date';
    form.createEl('h3', { text: '服务端显示偏好' });
    const preferences = this.data.preferences || {};
    const switches = form.createDiv({ cls: 'wallos-preference-switches' });
    const options: [keyof WallosPreferences, string][] = [
      ['week_starts_sunday', '日历从周日开始'], ['convert_currency', 'Wallos 换算币种'],
      ['hide_disabled', '在 Wallos 中隐藏停用订阅'], ['disabled_to_bottom', '停用订阅放到底部'],
      ['show_original_price', '显示原币种价格'], ['monthly_price', '显示月均价格'],
    ];
    const checks = options.map(([key, title]) => {
      const row = switches.createEl('label', { cls: 'wallos-check' });
      const check = row.createEl('input', { attr: { type: 'checkbox' } });
      check.checked = Number(preferences[key] ?? 0) === 1;
      row.createSpan({ text: title });
      return { key, check };
    });
    const error = form.createDiv({ cls: 'wallos-form-error', attr: { role: 'alert' } });
    const actions = form.createDiv({ cls: 'wallos-form-actions' });
    const cancel = simpleButton(actions, '取消', () => this.close());
    const submit = form.createEl('button', { cls: 'wallos-button mod-cta', text: '保存到 Wallos', attr: { type: 'submit' } });
    actions.appendChild(submit);
    form.addEventListener('submit', ev => {
      ev.preventDefault();
      if (this.busy) return;
      const mon = Number(monthly.value), per = Number(period.value);
      if (![mon, per].every(n => Number.isFinite(n) && n >= 0) || !validYmd(anchor.value)) {
        error.setText('预算必须是非负数字，锚点日期必须有效'); return;
      }
      this.busy = true; submit.disabled = true; cancel.disabled = true;
      error.setText('正在更新 Wallos…');
      void (async () => {
        try {
          await this.plugin.api.saveBudget({ monthly_budget: mon, period_budget: per, budget_period_type: periodType.value, budget_period_anchor_date: anchor.value });
          const values: Partial<WallosPreferences> = {};
          checks.forEach(({key, check}) => { values[key] = check.checked ? 1 : 0; });
          await this.plugin.api.savePreferences(values);
          const fresh = await this.refreshed();
          if (fresh) this.data = fresh;
          new Notice('Wallos 预算与偏好已保存');
          this.close();
        } catch(e) { error.setText(errorText(e)); }
        finally { this.busy = false; submit.disabled = false; cancel.disabled = false; }
      })();
    });
  }
}
