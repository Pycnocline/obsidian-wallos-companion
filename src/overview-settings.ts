import { App, Modal, Notice, setIcon } from 'obsidian';
import type WallosCompanionPlugin from './main';
import {
  OverviewCard, OVERVIEW_KINDS, OVERVIEW_PRESETS, defaultOverviewCards,
  makeOverviewCard, normalizeOverviewCards,
} from './overview';

const placeholders: [string, string][] = [
  ['monthly_average', '平均月费'],
  ['monthly_estimate', '本月预计支出'],
  ['annual_average', '平均年费'],
  ['active_count', '活跃数量'],
  ['inactive_count', '停用数量'],
  ['total_count', '全部订阅数量'],
  ['due_7', '未来 7 天数量'],
  ['due_30', '未来 30 天数量'],
  ['next_renewal', '下一笔续费'],
  ['monthly_budget', '月度预算'],
  ['month', '当前年月'],
  ['today', '今日日期'],
];

function field(parent: HTMLElement, label: string, initial: string, changed: (next: string) => void): HTMLInputElement {
  const wrap = parent.createEl('label', { cls: 'wallos-card-setting-field' });
  wrap.createSpan({ text: label });
  const input = wrap.createEl('input', { cls: 'wallos-input', attr: { type: 'text' } }) as HTMLInputElement;
  input.value = initial;
  input.addEventListener('input', () => changed(input.value));
  return input;
}
function toggle(parent: HTMLElement, label: string, initial: boolean, changed: (next: boolean) => void): void {
  const wrap = parent.createEl('label', { cls: 'wallos-check' });
  const input = wrap.createEl('input', { attr: { type: 'checkbox' } }) as HTMLInputElement;
  input.checked = initial;
  input.addEventListener('change', () => changed(input.checked));
  wrap.createSpan({ text: label });
}

export class OverviewSettingsModal extends Modal {
  private draft: OverviewCard[];
  private saving = false;

  constructor(app: App, private readonly plugin: WallosCompanionPlugin) {
    super(app);
    this.draft = normalizeOverviewCards(plugin.settings.overviewCards);
  }

  onOpen(): void {
    this.modalEl.addClass('wallos-dialog', 'wallos-overview-editor');
    this.titleEl.setText('自定义财务概览');
    this.render();
  }

  private move(index: number, offset: number): void {
    const other = index + offset;
    if (other < 0 || other >= this.draft.length) return;
    [this.draft[index], this.draft[other]] = [this.draft[other], this.draft[index]];
    this.render();
  }

  private render(): void {
    this.contentEl.empty();
    this.contentEl.createEl('p', {
      cls: 'wallos-icon-help',
      text: '自定义显示顺序、指标、标题、主数值、提示文字及显示状态。设置随 Vault 同步，Wallos 仍是唯一财务数据源。',
    });
    const list = this.contentEl.createDiv({ cls: 'wallos-card-settings' });
    for (const [index, item] of this.draft.entries()) {
      const card = list.createDiv({ cls: 'wallos-card-setting' });
      const header = card.createDiv({ cls: 'wallos-card-setting-head' });
      header.createEl('strong', { text: String(index + 1) + ' · ' + (item.title || OVERVIEW_PRESETS[item.kind].title) });
      const controls = header.createDiv({ cls: 'wallos-card-setting-actions' });
      const action = (icon: string, label: string, handler: () => void, disabled = false) => {
        const button = controls.createEl('button', {
          cls: 'wallos-icon-button', attr: { type: 'button', 'aria-label': label, title: label },
        });
        setIcon(button, icon);
        button.disabled = disabled;
        button.addEventListener('click', handler);
      };
      action('arrow-up', '上移此卡片', () => this.move(index, -1), index === 0);
      action('arrow-down', '下移此卡片', () => this.move(index, 1), index === this.draft.length - 1);
      action('trash-2', '移除此卡片', () => { this.draft.splice(index, 1); this.render(); });

      const kind = card.createEl('label', { cls: 'wallos-card-setting-field' });
      kind.createSpan({ text: '卡片指标' });
      const picker = kind.createEl('select', { cls: 'wallos-input', attr: { 'aria-label': '卡片指标' } });
      for (const key of OVERVIEW_KINDS) {
        const opt = picker.createEl('option', { text: OVERVIEW_PRESETS[key].title });
        opt.value = key;
      }
      picker.value = item.kind;
      picker.addEventListener('change', () => {
        const selected = picker.value as OverviewCard['kind'];
        item.kind = selected;
        const preset = OVERVIEW_PRESETS[selected];
        // When changing metric choose its sensible default label and explanatory note.
        item.title = preset.title;
        item.note = preset.note;
        item.valueTemplate = '';
        this.render();
      });
      field(card, '标题（可包含变量）', item.title, v => { item.title = v; });
      const value = field(card, '主数值内容（留空使用指标默认值）', item.valueTemplate, v => { item.valueTemplate = v; });
      const vars = card.createEl('label', { cls: 'wallos-card-setting-field' });
      vars.createSpan({ text: '向主数值插入动态变量' });
      const select = vars.createEl('select', { cls: 'wallos-input', attr: { 'aria-label': '插入变量' } });
      select.createEl('option', { text: '选择要插入的变量', attr: { value: '' } });
      for (const [token, name] of placeholders) {
        const opt = select.createEl('option', { text: name + ' · {{' + token + '}}' });
        opt.value = token;
      }
      select.addEventListener('change', () => {
        if (!select.value) return;
        item.valueTemplate = value.value + '{{' + select.value + '}}';
        value.value = item.valueTemplate;
        select.value = '';
      });
      field(card, '卡片下方提示文本（可包含变量）', item.note, v => { item.note = v; });
      field(card, '鼠标悬停提示 / 卡片说明', item.tooltip, v => { item.tooltip = v; });
      const checks = card.createDiv({ cls: 'wallos-card-setting-switches' });
      toggle(checks, '显示此卡片', item.visible, v => { item.visible = v; });
      toggle(checks, '显示提示文字', item.showNote, v => { item.showNote = v; });
      toggle(checks, '显示图标', item.showIcon, v => { item.showIcon = v; });
    }

    if (!this.draft.length) this.contentEl.createEl('p', { text: '财务概览当前没有卡片。可以新建卡片，或者恢复默认。' });
    const actions = this.contentEl.createDiv({ cls: 'wallos-form-actions wallos-card-editor-actions' });
    const add = actions.createEl('button', { cls: 'wallos-button', text: '添加卡片', attr: { type: 'button' } });
    add.disabled = this.draft.length >= 16;
    add.addEventListener('click', () => {
      if (this.draft.length >= 16) return;
      this.draft.push(makeOverviewCard('custom', 'custom-' + crypto.randomUUID()));
      this.render();
    });
    const restore = actions.createEl('button', { cls: 'wallos-button', text: '恢复默认', attr: { type: 'button' } });
    restore.addEventListener('click', () => { this.draft = defaultOverviewCards(); this.render(); });
    const cancel = actions.createEl('button', { cls: 'wallos-button', text: '取消', attr: { type: 'button' } });
    cancel.addEventListener('click', () => this.close());
    const save = actions.createEl('button', { cls: 'wallos-button mod-cta', text: '保存概览配置', attr: { type: 'button' } });
    save.disabled = this.saving;
    save.addEventListener('click', () => {
      if (this.saving) return;
      this.saving = true;
      save.disabled = true;
      void (async () => {
        try {
          // Preserve the previous state if the Vault settings write fails.
          const before = this.plugin.settings.overviewCards;
          this.plugin.settings.overviewCards = normalizeOverviewCards(this.draft);
          try { await this.plugin.saveSettings(); }
          catch (error) { this.plugin.settings.overviewCards = before; throw error; }
          this.plugin.notifyViewSettingsChanged();
          this.close();
          new Notice('财务概览配置已保存');
        } catch (error) {
          new Notice(error instanceof Error ? error.message : '概览配置保存失败');
        } finally {
          this.saving = false;
          save.disabled = false;
        }
      })();
    });
  }
}
