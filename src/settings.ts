import { App, PluginSettingTab, SecretComponent, Setting } from 'obsidian';
import type WallosCompanionPlugin from './main';
import { safeHttpsUrl } from './model';

export interface WallosPluginSettings {
  baseUrl: string;
  dueSoonDays: number;
  refreshMinutes: number;
}

export const DEFAULT_SETTINGS: WallosPluginSettings = {
  baseUrl: 'https://wallos.iamin.icu',
  dueSoonDays: 30,
  refreshMinutes: 10,
};

export class WallosSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: WallosCompanionPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Wallos Companion' });
    containerEl.createEl('p', {
      text: 'Wallos 负责存储与服务端续费提醒。Obsidian 仅作为管理客户端；API Key、Access Token 和对应的密钥引用均按设备独立保存，不随 Vault 配置同步。',
      cls: 'setting-item-description',
    });

    new Setting(containerEl)
      .setName('Wallos 地址')
      .setDesc('仅允许 HTTPS，http://localhost 和本机环回地址除外。不要填写 API 路径。')
      .addText((text) => text
        .setPlaceholder('https://wallos.example.com')
        .setValue(this.plugin.settings.baseUrl)
        .onChange(async (value) => {
          const normalized = safeHttpsUrl(value);
          if (!normalized) return;
          this.plugin.settings.baseUrl = normalized;
          await this.plugin.saveSettings();
        }));

    containerEl.createEl('h3', { text: '登录 · Someday SSO / Cloudflare' });
    containerEl.createEl('p', { text: '无需手动填写 API Key：先在浏览器登录，再确认允许 Obsidian 读取 Wallos。Cloudflare 身份验证由现有 Someday 统一登录完成。', cls: 'setting-item-description' });
    new Setting(containerEl).setName(this.plugin.isConnected() ? '已连接 Wallos' : '尚未连接')
      .setDesc('配对有效期 10 分钟；API Key 仅保存在本设备 SecretStorage，不写入 Vault。')
      .addButton(b => b.setButtonText('1. 登录 Cloudflare / Someday').onClick(async () => {
        try { await this.plugin.startLogin(); this.display(); } catch (e) { new (await import('obsidian')).Notice(e instanceof Error ? e.message : '登录失败'); }
      }))
      .addButton(b => b.setButtonText('2. 授权此设备').setDisabled(!this.plugin.hasPendingPair()).onClick(async () => {
        try { await this.plugin.authorizeLogin(); } catch (e) { new (await import('obsidian')).Notice(e instanceof Error ? e.message : '授权失败'); }
      }))
      .addButton(b => b.setButtonText('3. 完成连接').setDisabled(!this.plugin.hasPendingPair()).onClick(async () => {
        try { await this.plugin.finishLogin(); this.display(); } catch (e) { new (await import('obsidian')).Notice(e instanceof Error ? e.message : '连接失败'); }
      }));
    new Setting(containerEl).setName('断开连接').addButton(b => b.setButtonText('退出插件').onClick(async () => {
      await this.plugin.logout(); this.display();
    }));

    new Setting(containerEl)
      .setName('Wallos API Key')
      .setDesc('高级备用方式：仅在配对服务不可用时使用。普通用户不需要操作。')
      .addComponent((el) => new SecretComponent(this.app, el)
        .setValue(this.plugin.getCredentialSecretId('apiKeySecretId'))
        .onChange(async (id) => {
          this.plugin.setCredentialSecretId('apiKeySecretId', id ?? '');
        }));

    containerEl.createEl('h3', { text: 'Cloudflare Access（可选）' });
    containerEl.createEl('p', {
      text: '如果 Wallos API 受到 Cloudflare Access 保护，需在 Cloudflare 中配置允许 Service Token 的访问策略，并提供 Client ID 与 Secret。Wallos 的 OIDC 网页登录本身不等于 API 认证。',
      cls: 'setting-item-description',
    });

    new Setting(containerEl)
      .setName('Service Token Client ID')
      .addComponent((el) => new SecretComponent(this.app, el)
        .setValue(this.plugin.getCredentialSecretId('accessClientIdSecretId'))
        .onChange(async (id) => {
          this.plugin.setCredentialSecretId('accessClientIdSecretId', id ?? '');
        }));
    new Setting(containerEl)
      .setName('Service Token Client Secret')
      .addComponent((el) => new SecretComponent(this.app, el)
        .setValue(this.plugin.getCredentialSecretId('accessClientSecretSecretId'))
        .onChange(async (id) => {
          this.plugin.setCredentialSecretId('accessClientSecretSecretId', id ?? '');
        }));

    containerEl.createEl('h3', { text: '界面' });
    new Setting(containerEl)
      .setName('近期到期的时间范围')
      .setDesc('用于“即将续费”筛选，不改变 Wallos 的服务端通知设置。')
      .addDropdown((dropdown) => dropdown
        .addOption('7', '7 天')
        .addOption('14', '14 天')
        .addOption('30', '30 天')
        .addOption('60', '60 天')
        .setValue(String(this.plugin.settings.dueSoonDays))
        .onChange(async (value) => {
          this.plugin.settings.dueSoonDays = Number(value);
          await this.plugin.saveSettings();
          this.plugin.notifyViewSettingsChanged();
        }));

    new Setting(containerEl)
      .setName('自动刷新间隔')
      .setDesc('仅在 Obsidian 打开时生效；不影响 Wallos 后端的持续通知。')
      .addDropdown((dropdown) => dropdown
        .addOption('0', '关闭')
        .addOption('5', '5 分钟')
        .addOption('10', '10 分钟')
        .addOption('30', '30 分钟')
        .setValue(String(this.plugin.settings.refreshMinutes))
        .onChange(async (value) => {
          this.plugin.settings.refreshMinutes = Number(value);
          await this.plugin.saveSettings();
          this.plugin.notifyViewSettingsChanged();
        }));
    new Setting(containerEl)
      .setName('打开订阅管理')
      .setDesc('测试连接后可从左侧钱包图标或命令面板打开。')
      .addButton((button) => button.setButtonText('打开 Wallos 面板').onClick(() => {
        void this.plugin.activateView();
      }));
  }
}
