import { Notice, Platform, Plugin, WorkspaceLeaf, requestUrl } from 'obsidian';
import { WallosApi } from './api';
import { CredentialField, CredentialRefs, loadLocalCredentials, persistLocalCredentials, omitCredentialsFromSettings } from './auth-storage';
import { PairingClient, randomVerifier } from './pairing';
import { safeHttpsUrl } from './model';
import { DEFAULT_SETTINGS, WallosPluginSettings, WallosSettingTab } from './settings';
import { VIEW_TYPE_WALLOS, WallosView } from './view';
import { revealWallosLeaf } from './workspace';

export default class WallosCompanionPlugin extends Plugin {
  settings: WallosPluginSettings = { ...DEFAULT_SETTINGS };
  private credentials: CredentialRefs = { apiKeySecretId: '', accessClientIdSecretId: '', accessClientSecretSecretId: '' };
  api!: WallosApi;
  pairing!: PairingClient;
  private activePair: { id: string; verifier: string; expiresAt: number } | null = null;

  async onload(): Promise<void> {
    const saved = await this.loadData() as (Partial<WallosPluginSettings> & Partial<CredentialRefs>) | null;
    // Synced settings must never own the local SecretStorage references.
    this.settings = { ...DEFAULT_SETTINGS, ...omitCredentialsFromSettings(saved ?? {}) };
    this.credentials = loadLocalCredentials(this.app, this.app.secretStorage, saved ?? {});
    // Remove secret IDs from older versions' data.json after local migration.
    if (saved && ['apiKeySecretId', 'accessClientIdSecretId', 'accessClientSecretSecretId']
        .some((key) => Object.prototype.hasOwnProperty.call(saved, key))) {
      await this.saveData(this.settings);
    }
    // Do not trigger a background API refresh just 30 seconds after startup:
    // honor the configured refresh cadence from initial plugin load.
    this.nextRefreshAt = Date.now() + Math.max(0, this.settings.refreshMinutes) * 60_000;
    this.api = new WallosApi(() => ({
      baseUrl: this.settings.baseUrl,
      apiKey: this.getSecret(this.credentials.apiKeySecretId),
      accessClientId: this.getSecret(this.credentials.accessClientIdSecretId),
      accessClientSecret: this.getSecret(this.credentials.accessClientSecretSecretId),
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
    // SecretStorage is local to this device; never persist API keys in synced plugin data.
    this.app.secretStorage.setSecret(id, reply.api_key);
    this.setCredentialSecretId('apiKeySecretId', id);
    this.activePair = null;
    new Notice('Wallos 已连接');
    this.notifyViewSettingsChanged();
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_WALLOS)) {
      if (leaf.view instanceof WallosView) void leaf.view.refresh();
    }
  }

  async logout(): Promise<void> {
    this.setCredentialSecretId('apiKeySecretId', '');
    this.activePair = null;
    this.notifyViewSettingsChanged();
  }

  hasPendingPair(): boolean { return this.activePair !== null && Date.now() < this.activePair.expiresAt; }
  isConnected(): boolean { return Boolean(this.getSecret(this.credentials.apiKeySecretId)); }

  getCredentialSecretId(field: CredentialField): string {
    return this.credentials[field];
  }

  setCredentialSecretId(field: CredentialField, id: string): void {
    this.credentials[field] = id;
    persistLocalCredentials(this.app, this.credentials);
    this.notifyViewSettingsChanged();
  }


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
      await revealWallosLeaf(this.app.workspace, VIEW_TYPE_WALLOS, Platform.isMobile);
    } catch {
      new Notice('无法打开 Wallos 面板，请检查 Obsidian 版本或插件状态');
    }
  }
}
