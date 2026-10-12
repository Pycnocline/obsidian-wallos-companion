import type WallosCompanionPlugin from './main';
import type { Subscription } from './model';
import { LogoSearchSource, LogoUpload, safeLogoSource, wallosLogoUrl } from './logo';

const sources: { value: LogoSearchSource; name: string }[] = [
  { value: 'selfhst', name: 'selfh.st Icons' },
  { value: 'dashboardicons', name: 'Dashboard Icons' },
  { value: 'brave', name: 'Brave 图片' },
  { value: 'duckduckgo', name: 'DuckDuckGo 图片' },
];

export class IconPicker {
  private choice: 'keep' | 'url' | 'file' = 'keep';
  private urlInput: HTMLInputElement;
  private fileInput: HTMLInputElement;
  private preview: HTMLDivElement;
  private selectedHint: HTMLElement;
  private fileUrl: string | null = null;
  private requestGeneration = 0;
  private disposed = false;
  private selectedResult: HTMLButtonElement | null = null;

  constructor(
    root: HTMLElement,
    private readonly plugin: WallosCompanionPlugin,
    current: Subscription | null,
    defaultTerm: () => string,
  ) {
    const section = root.createDiv({ cls: 'wallos-icon-picker wallos-field-wide' });
    section.createEl('h4', { text: '订阅图标' });
    section.createEl('p', { cls: 'wallos-icon-help', text: '选择网络图标、上传图片或保留现有图标。保存后由 Wallos 服务器下载或存储图片。' });

    const currentUrl = wallosLogoUrl(plugin.settings.baseUrl, current?.logo);
    this.preview = section.createDiv({ cls: 'wallos-logo-preview' });
    this.selectedHint = section.createSpan({ cls: 'wallos-icon-hint' });
    this.renderPreview(currentUrl, currentUrl ? '现有图标' : '暂无图标');

    const field = section.createDiv({ cls: 'wallos-field' });
    field.createEl('label', { text: '直接使用图标 URL（支持 HTTPS 图片）' });
    this.urlInput = field.createEl('input', {
      cls: 'wallos-input', attr: { type: 'url', placeholder: 'https://example.com/icon.png', 'aria-label': '图标 URL' },
    }) as HTMLInputElement;
    this.urlInput.addEventListener('input', () => {
      this.selectedResult?.removeClass('is-selected');
      this.selectedResult = null;
      this.choice = this.urlInput.value.trim() ? 'url' : 'keep';
      const url = safeLogoSource(this.urlInput.value.trim());
      this.renderPreview(url || currentUrl, this.choice === 'url' ? (url ? '待保存的网络图标' : '网络图标 URL 无效') : '现有图标');
    });

    const upload = section.createDiv({ cls: 'wallos-field' });
    upload.createEl('label', { text: '或者上传图片（PNG、JPEG、GIF、WebP，最大 8 MiB）' });
    this.fileInput = upload.createEl('input', {
      cls: 'wallos-input wallos-file-input', attr: {
        type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp',
        'aria-label': '上传本地图标',
      },
    }) as HTMLInputElement;
    this.fileInput.addEventListener('change', () => {
      const file = this.fileInput.files?.[0];
      if (!file) return;
      this.choice = 'file';
      this.urlInput.value = '';
      this.selectedResult?.removeClass('is-selected');
      this.selectedResult = null;
      this.releaseFileUrl();
      this.fileUrl = URL.createObjectURL(file);
      this.renderPreview(this.fileUrl, '待上传：' + file.name);
    });
    const reset = section.createEl('button', { cls: 'wallos-button wallos-logo-keep', text: '保留已有图标', attr: { type: 'button' } });
    reset.addEventListener('click', () => {
      this.choice = 'keep';
      this.urlInput.value = '';
      this.fileInput.value = '';
      this.selectedResult?.removeClass('is-selected');
      this.selectedResult = null;
      this.releaseFileUrl();
      this.renderPreview(currentUrl, currentUrl ? '保留已有图标' : '无图标');
    });

    section.createEl('h4', { text: '在线搜索图标' });
    const searchBar = section.createDiv({ cls: 'wallos-icon-search' });
    const search = searchBar.createEl('input', {
      cls: 'wallos-input', attr: { type: 'search', 'aria-label': '搜索图标', placeholder: '服务名称，例如 Netflix' },
    }) as HTMLInputElement;
    search.value = defaultTerm().trim();
    const sourceSelect = searchBar.createEl('select', { cls: 'wallos-input', attr: { 'aria-label': '图标搜索源' } });
    for (const s of sources) {
      const opt = sourceSelect.createEl('option', { text: s.name });
      opt.value = s.value;
    }
    const button = searchBar.createEl('button', { cls: 'wallos-button', text: '搜索', attr: { type: 'button' } });
    const feedback = section.createDiv({ cls: 'wallos-icon-hint', attr: { role: 'status', 'aria-live': 'polite' } });
    const results = section.createDiv({ cls: 'wallos-icon-results' });
    const doSearch = async () => {
      if (!search.value.trim()) search.value = defaultTerm().trim();
      const generation = ++this.requestGeneration;
      results.empty();
      this.selectedResult = null;
      feedback.setText('正在搜索…');
      button.disabled = true;
      try {
        const matches = await this.plugin.api.searchLogos(search.value, sourceSelect.value as LogoSearchSource);
        if (this.disposed || generation !== this.requestGeneration) return;
        feedback.setText(matches.length ? '点击图片选择图标；找到后还需保存订阅。' : '没有匹配结果，请尝试其他搜索源或填写图片 URL。');
        for (const match of matches) {
          const tile = results.createEl('button', {
            cls: 'wallos-icon-result', attr: { type: 'button', title: match.image, 'aria-label': '选择图标 ' + match.image },
          });
          tile.createEl('img', { attr: { src: match.thumbnail, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' } });
          tile.addEventListener('click', () => {
            this.selectedResult?.removeClass('is-selected');
            this.selectedResult = tile;
            tile.addClass('is-selected');
            this.choice = 'url';
            this.fileInput.value = '';
            this.releaseFileUrl();
            this.urlInput.value = match.image;
            this.renderPreview(match.thumbnail, '待保存的搜索图标');
          });
        }
      } catch (error) {
        if (this.disposed || generation !== this.requestGeneration) return;
        feedback.setText(error instanceof Error ? error.message : '图标搜索失败');
      } finally {
        if (!this.disposed && generation === this.requestGeneration) button.disabled = false;
      }
    };
    button.addEventListener('click', () => { void doSearch(); });
    search.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter') { event.preventDefault(); void doSearch(); }
    });
  }

  private renderPreview(url: string | null, caption: string): void {
    this.preview.empty();
    if (url) {
      const img = this.preview.createEl('img', {
        attr: { src: url, alt: '订阅图标预览', referrerpolicy: 'no-referrer' },
      });
      img.addEventListener('error', () => {
        img.remove();
        this.preview.createSpan({ cls: 'wallos-logo-preview-missing', text: '图片无法预览' });
      });
    } else {
      this.preview.createSpan({ cls: 'wallos-logo-preview-missing', text: '无图标' });
    }
    this.selectedHint.setText(caption);
  }

  getRemoteUrl(): string | null {
    if (this.choice !== 'url') return null;
    const raw = this.urlInput.value.trim();
    if (!safeLogoSource(raw)) throw new Error('图标 URL 必须是有效的 HTTPS 地址');
    return raw;
  }

  getFile(): LogoUpload | undefined {
    if (this.choice !== 'file') return undefined;
    const file = this.fileInput.files?.[0];
    if (!file) throw new Error('请重新选择要上传的图标');
    return file;
  }

  private releaseFileUrl(): void {
    if (this.fileUrl) URL.revokeObjectURL(this.fileUrl);
    this.fileUrl = null;
  }

  dispose(): void {
    this.disposed = true;
    this.requestGeneration++;
    this.releaseFileUrl();
  }
}
