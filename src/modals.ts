import { App, Modal, Notice, setIcon } from 'obsidian';
import type WallosCompanionPlugin from './main';
import type { DashboardData, NamedOption, Subscription, Currency } from './model';
import { todayYmd, validateSubscriptionForm } from './model';

function textField(parent: HTMLElement, labelText: string, value: string, type = 'text', required = false): HTMLInputElement {
  const wrapper = parent.createDiv({ cls: 'wallos-field' });
  wrapper.createEl('label', { text: labelText });
  const input = wrapper.createEl('input', { cls: 'wallos-input' }) as HTMLInputElement;
  input.type = type;
  input.value = value;
  input.required = required;
  if (type === 'number') input.inputMode = 'decimal';
  wrapper.querySelector('label')?.setAttribute('for', `wallos-${labelText}`);
  input.id = `wallos-${labelText}`;
  return input;
}

function selectField(parent: HTMLElement, labelText: string, options: { value: string; label: string }[], value: string): HTMLSelectElement {
  const wrapper = parent.createDiv({ cls: 'wallos-field' });
  const label = wrapper.createEl('label', { text: labelText });
  const select = wrapper.createEl('select', { cls: 'wallos-input' }) as HTMLSelectElement;
  select.id = `wallos-${labelText}`;
  label.setAttribute('for', select.id);
  for (const option of options) {
    const el = select.createEl('option');
    el.value = option.value;
    el.textContent = option.label;
  }
  if (value && !options.some((option) => option.value === value)) {
    const fallback = select.createEl('option', { text: `保留当前项 (#${value})` });
    fallback.value = value;
  }
  select.value = value;
  return select;
}

function namedOptions(items: NamedOption[], optional: boolean): { value: string; label: string }[] {
  return [
    ...(optional ? [{ value: '', label: '未设置' }] : []),
    ...items.map((item) => ({ value: String(item.id), label: item.name })),
  ];
}

function checkField(parent: HTMLElement, labelText: string, checked: boolean): HTMLInputElement {
  const wrapper = parent.createEl('label', { cls: 'wallos-check' });
  const input = wrapper.createEl('input') as HTMLInputElement;
  input.type = 'checkbox';
  input.checked = checked;
  wrapper.createSpan({ text: labelText });
  return input;
}

export class SubscriptionModal extends Modal {
  private sending = false;

  constructor(
    app: App,
    private readonly plugin: WallosCompanionPlugin,
    private readonly data: DashboardData,
    private readonly subscription: Subscription | null,
    private readonly saved: () => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    const editing = this.subscription !== null;
    this.modalEl.addClass('wallos-dialog');
    this.contentEl.empty();
    this.titleEl.setText(editing ? '编辑订阅' : '新增订阅');
    const current = this.subscription;
    if (!this.data.currencies.length) {
      this.contentEl.createEl('p', { text: '无法获取 Wallos 币种列表，请检查 API 连接后重试。' });
      return;
    }

    const form = this.contentEl.createEl('form', { cls: 'wallos-form' });
    const fields = form.createDiv({ cls: 'wallos-fields' });
    const name = textField(fields, '名称', current?.name ?? '', 'text', true);
    name.maxLength = 255;
    const price = textField(fields, '单次价格', current ? String(current.price) : '', 'number', true);
    price.min = '0';
    price.step = '0.01';
    const currency = selectField(fields, '币种', this.data.currencies.map((item: Currency) => ({
      value: String(item.id), label: `${item.code} · ${item.name}`,
    })), String(current?.currency_id ?? this.data.currencies[0].id));
    const frequency = textField(fields, '每隔多少个周期', String(current?.frequency ?? 1), 'number', true);
    frequency.min = '1';
    frequency.max = '10000';
    frequency.step = '1';
    const cycle = selectField(fields, '周期单位', [
      { value: '1', label: '天' }, { value: '2', label: '周' },
      { value: '3', label: '月' }, { value: '4', label: '年' },
    ], String(current?.cycle ?? 3));
    const nextPayment = textField(fields, '下次续费日期', current?.next_payment ?? todayYmd(), 'date', true);
    const startDate = textField(fields, '订阅开始日期', current?.start_date || todayYmd(), 'date');
    const category = selectField(fields, '分类', namedOptions(this.data.categories, true), String(current?.category_id ?? ''));
    const paymentMethod = selectField(fields, '支付方式', namedOptions(this.data.paymentMethods, true), String(current?.payment_method_id ?? ''));
    const payer = selectField(fields, '付款人', namedOptions(this.data.household, true), String(current?.payer_user_id ?? ''));
    const url = textField(fields, '订阅网页（可选）', current?.url ?? '', 'url');

    const noteField = fields.createDiv({ cls: 'wallos-field wallos-field-wide' });
    const noteLabel = noteField.createEl('label', { text: '备注' });
    const notes = noteField.createEl('textarea', { cls: 'wallos-input wallos-textarea' }) as HTMLTextAreaElement;
    notes.value = current?.notes ?? '';
    noteLabel.setAttribute('for', 'wallos-notes');
    notes.id = 'wallos-notes';

    const optionRow = form.createDiv({ cls: 'wallos-option-row' });
    const autoRenew = checkField(optionRow, '自动续订', (current?.auto_renew ?? 1) === 1);
    const notify = checkField(optionRow, '启用 Wallos 到期提醒', (current?.notify ?? 1) === 1);
    const inactive = checkField(optionRow, '已停用', (current?.inactive ?? 0) === 1);
    const notifyDays = textField(form, '提前提醒天数', String(current?.notify_days_before ?? 3), 'number', true);
    notifyDays.min = '0';
    notifyDays.max = '365';
    notifyDays.step = '1';

    const message = form.createDiv({ cls: 'wallos-form-error', attr: { role: 'alert' } });
    const buttons = form.createDiv({ cls: 'wallos-form-actions' });
    const cancel = buttons.createEl('button', { text: '取消', cls: 'wallos-button' });
    cancel.type = 'button';
    cancel.addEventListener('click', () => this.close());
    const save = buttons.createEl('button', { cls: 'wallos-button mod-cta', text: editing ? '保存修改' : '创建订阅' });
    save.type = 'submit';
    setIcon(save.createSpan({ cls: 'wallos-button-icon' }), 'check');

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (this.sending) return;
      const validation = validateSubscriptionForm({
        name: name.value, price: price.value, currencyId: currency.value,
        frequency: frequency.value, cycle: cycle.value,
        nextPayment: nextPayment.value, startDate: startDate.value,
        notifyDays: notifyDays.value,
      });
      if (validation) {
        message.setText(validation);
        return;
      }
      if (url.value.trim()) {
        try {
          const parsedUrl = new URL(url.value.trim());
          if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error();
        } catch {
          message.setText('订阅网页必须为 HTTP 或 HTTPS 地址');
          return;
        }
      }
      const payload: Record<string, string | number | null | undefined> = {
        name: name.value.trim(),
        price: price.value,
        currency_id: currency.value,
        frequency: frequency.value,
        cycle: cycle.value,
        next_payment: nextPayment.value,
        start_date: startDate.value,
        category_id: category.value || (editing ? '' : undefined),
        payment_method_id: paymentMethod.value || (editing ? '' : undefined),
        payer_user_id: payer.value || (editing ? '' : undefined),
        notes: notes.value,
        url: url.value.trim(),
        auto_renew: autoRenew.checked ? 1 : 0,
        notify: notify.checked ? 1 : 0,
        notify_days_before: notifyDays.value,
        inactive: inactive.checked ? 1 : 0,
      };
      this.sending = true;
      save.disabled = true;
      cancel.disabled = true;
      message.setText('正在保存到 Wallos…');
      void (async () => {
        try {
          await this.plugin.api.saveSubscription(payload, current?.id);
          this.close();
          new Notice(editing ? 'Wallos 订阅已修改' : 'Wallos 订阅已创建');
          await this.saved();
        } catch (error) {
          message.setText(error instanceof Error ? error.message : '保存或刷新失败');
        } finally {
          this.sending = false;
          save.disabled = false;
          cancel.disabled = false;
        }
      })();
    });
  }
}

export class DeleteConfirmationModal extends Modal {
  private sending = false;

  constructor(
    app: App,
    private readonly plugin: WallosCompanionPlugin,
    private readonly subscription: Subscription,
    private readonly deleted: () => Promise<void>,
  ) { super(app); }

  onOpen(): void {
    this.modalEl.addClass('wallos-dialog');
    this.titleEl.setText('永久删除订阅？');
    this.contentEl.createEl('p', {
      text: `将从 Wallos 永久删除「${this.subscription.name}」。这不是停用订阅，且无法通过本插件撤销。`,
    });
    const error = this.contentEl.createDiv({ cls: 'wallos-form-error', attr: { role: 'alert' } });
    const actions = this.contentEl.createDiv({ cls: 'wallos-form-actions' });
    const cancel = actions.createEl('button', { text: '取消', cls: 'wallos-button' });
    const confirm = actions.createEl('button', { text: '确认永久删除', cls: 'wallos-button wallos-danger' });
    cancel.addEventListener('click', () => this.close());
    confirm.addEventListener('click', () => {
      if (this.sending) return;
      this.sending = true;
      confirm.disabled = true;
      cancel.disabled = true;
      error.setText('正在删除…');
      void (async () => {
        try {
          await this.plugin.api.deleteSubscription(this.subscription.id);
          this.close();
          new Notice('已从 Wallos 删除订阅');
          await this.deleted();
        } catch (err) {
          error.setText(err instanceof Error ? err.message : '删除或刷新失败');
        } finally {
          this.sending = false;
          confirm.disabled = false;
          cancel.disabled = false;
        }
      })();
    });
  }
}
