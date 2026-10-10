import { Notice, Platform, Plugin, WorkspaceLeaf, requestUrl } from 'obsidian';
import { WallosApi } from './api';
import { PairingClient, randomVerifier } from './pairing';
import { safeHttpsUrl } from './model';
import { DEFAULT_SETTINGS, WallosPluginSettings, WallosSettingTab } from './settings';
import { VIEW_TYPE_WALLOS, WallosView } from './view';

export default class WallosCompanionPlugin extends Plugin {
  settings: WallosPluginSettings = { ...DEFAULT_SETTINGS };
  api!: WallosApi;
  pairing!: PairingClient;
  private activePair: { id: string; verifier: string; expiresAt: number } | null = null;

  async onload(): Promise<void> {
    const saved = await this.loadData() as Partial<WallosPluginSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...saved };
    this.api = new WallosApi(() => ({
      baseUrl: this.settings.baseUrl,
      apiKey: this.getSecret(this.settings.apiKeySecretId),
      accessClientId: this.getSecret(this.settings.accessClientIdSecretId),
      accessClientSecret: this.getSecret(this.settings.accessClientSecretSecretId),
    }), requestUrl);

    this.pairing = new PairingClient(() => this.settings.baseUrl, requestUrl);
    this.registerView(VIEW_TYPE_WALLOS, (leaf: WorkspaceLeaf) => new WallosView(leaf, this));
    this.addRibbonIcon('wallet-cards', 'Wallos 订阅', () => { void this.activateView(); });
    this.addCommand({ id: 'open-wallos', name: '打开 Wallos 订阅面板', callback: () => { void this.activateView(); } });
    this.addCommand({ id: 'refresh-wallos', name: '刷新 Wallos 订阅', callback: () => {
      void this.activateView().then(async () => {
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_WALLOS)) {
          if (leaf.view instanceof WallosView) await leaf.view.refresh();
        }
      });
    } });
    this.addSettingTab(new WallosSettingTab(this.app, this));
    this.registerInterval(window.setInterval(() => {
      if (this.settings.refreshMinutes <= 0) return;
      const now = Date.now();
      if (this.nextRefreshAt > now) return;
      this.nextRefreshAt = now + this.settings.refreshMinutes * 60_000;
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_WALLOS)) {
        if (leaf.view instanceof WallosView) void leaf.view.refresh();
      }
    }, 30_000));
  }

  private nextRefreshAt = 0;

  async startLogin(): Promise<void> {
    const verifier = randomVerifier();
    const pair = await this.pairing.start(verifier);
    this.activePair = { id: pair.id, verifier, expiresAt: Date.now() + pair.expires_in * 1000 };
    const url = this.normalizedBaseUrl();
    if (!url) throw new Error('Wallos 地址无效');
    // First open the SSO login page. On mobile, the browser cannot give an Obsidian
    // plugin its cookies. The user returns to Obsidian and clicks Authorize.
    window.open(`${url}/login.php`, '_blank', 'noopener,noreferrer');
    new Notice('请在浏览器完成统一登录，再回到 Obsidian 点击「授权此设备」');
  }

  async authorizeLogin(): Promise<void> {
    if (!this.activePair || Date.now() >= this.activePair.expiresAt) throw new Error('配对已过期，请重新开始登录');
    const url = this.normalizedBaseUrl();
    if (!url) throw new Error('Wallos 地址无效');
    window.open(`${url}/obsidian-pair.php?id=${encodeURIComponent(this.activePair.id)}`, '_blank', 'noopener,noreferrer');
    new Notice('请在浏览器确认授权，然后回到 Obsidian 点击「完成连接」');
  }

  async finishLogin(): Promise<void> {
    const pair = this.activePair;
    if (!pair || Date.now() >= pair.expiresAt) throw new Error('配对已过期，请重新开始登录');
    const reply = await this.pairing.claim(pair.id, pair.verifier);
    if (reply.status === 'pending') throw new Error('尚未收到授权，请在浏览器确认后重试');
    if (reply.status !== 'approved' || !reply.api_key) throw new Error('授权已过期，请重新登录');
    const id = `wallos-companion-${crypto.randomUUID()}`;
    this.app.secretStorage.setSecret(id, reply.api_key);
    this.settings.apiKeySecretId = id;
    await this.saveSettings();
    this.activePair = null;
    new Notice('Wallos 已连接');
    this.notifyViewSettingsChanged();
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_WALLOS)) {
      if (leaf.view instanceof WallosView) void leaf.view.refresh();
    }
  }

  async logout(): Promise<void> {
    this.settings.apiKeySecretId = '';
    this.activePair = null;
    await this.saveSettings();
    this.notifyViewSettingsChanged();
  }

  hasPendingPair(): boolean { return this.activePair !== null && Date.now() < this.activePair.expiresAt; }
  isConnected(): boolean { return Boolean(this.getSecret(this.settings.apiKeySecretId)); }


  async onunload(): Promise<void> {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_WALLOS);
  }

  getSecret(secretId: string): string {
    return secretId ? this.app.secretStorage.getSecret(secretId) ?? '' : '';
  }

  normalizedBaseUrl(): string | null {
    return safeHttpsUrl(this.settings.baseUrl);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.nextRefreshAt = Date.now() + this.settings.refreshMinutes * 60_000;
  }

  notifyViewSettingsChanged(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_WALLOS)) {
      if (leaf.view instanceof WallosView) leaf.view.handleSettingsChanged();
    }
  }

  async activateView(): Promise<void> {
    try {
      const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_WALLOS)[0];
      const leaf = existing || (Platform.isMobile
        ? this.app.workspace.getLeaf(true)
        : this.app.workspace.getRightLeaf(false) || this.app.workspace.getLeaf(true));
      if (!existing) await leaf.setViewState({ type: VIEW_TYPE_WALLOS, active: true });
      await this.app.workspace.revealLeaf(leaf);
    } catch {
      new Notice('无法打开 Wallos 面板，请检查 Obsidian 版本或插件状态');
    }
  }
}
