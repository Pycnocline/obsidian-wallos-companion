# Wallos Companion for Obsidian

一个面向桌面和 iOS/Android Obsidian 的 Wallos 订阅管理插件（独立于 Wallos 官方项目）。

> 开发版 0.1.0。Wallos 依然是订阅唯一事实来源，服务端继续负责续费和提醒。插件不会将订阅数据写入 Vault，也**不会**在 Obsidian 关闭时运行通知任务。

## 功能

- 查看实时订阅列表，支持搜索、按即将续费/活跃/停用筛选。
- 使用 Wallos 官方 `get_monthly_cost.php` 显示当月费用（不自行混算多币种）。
- 查看续费时间、周期、支付方式、分类和提醒是否启用。
- 新增、编辑、删除订阅；操作直接通过 Wallos v5.8.1 `set_subscriptions.php`。
- 可切换自动续订、启用服务端到期通知和通知提前天数。
- 响应式移动端卡片/表单、44px 触控按钮、手机日期输入、深浅主题配色。
- 密钥使用 Obsidian 1.11.4+ 的 SecretStorage；无 API Key 明文配置文件或 URL 查询参数。
- 可选 Cloudflare Access Service Token 头，与 Wallos API Key 分开认证。

## 安装（开发版）

在装有 Obsidian **1.11.4 或更高版本**的设备上：

1. 执行 `npm ci && npm run build`。也可以使用仓库 Release 附带的 `main.js`、`manifest.json` 和 `styles.css`。
2. 将 **这三个文件**放入 Vault 的 `.obsidian/plugins/wallos-companion/`。
3. Obsidian → 设置 → 第三方插件 → 启用 **Wallos Companion**。
4. 在插件设置填写 Wallos 基础地址（示例 `https://wallos.iamin.icu`）。
5. 在 Wallos 的个人设置生成 API Key；在 Obsidian SecretStorage 中新建密钥，然后在插件的「Wallos API Key」下拉框选择它。
6. 如果 Wallos API 被 Cloudflare Access 保护，在 Cloudflare 创建允许 Service Token 的相应访问策略，并分别设置 `Client ID` 和 `Client Secret`。不要求也不建议关闭 Access 保护。
7. 通过左侧钱包图标或命令面板打开订阅面板。

**iOS/Android 注意：** Obsidian 的 SecretStorage 属于每台设备的本地密钥存储，不会依赖 LiveSync 自动将密钥迁移到新设备。新设备需重新导入/创建密钥。Wallos API 地址必须从手机网络可达；仅在服务器本机可访问的 `127.0.0.1` 无法跨设备使用。

**Access 说明：** Cloudflare Access 的网页登录 Cookie/OIDC 与 API Key 是两个独立的认证环节。插件会用表单 POST 发送 Wallos API Key；如配置 Service Token，还将额外发送 `CF-Access-Client-Id` / `CF-Access-Client-Secret` 请求头。Access 应对该 Token 配置授权策略，而不是为解决插件访问直接开放无鉴权接口。若前端收到 Access 的 HTML 登录页面，插件会提示对应错误。

**提醒说明：** 需要在 Wallos 服务端配置通知渠道（例如 ntfy），插件中勾选「启用 Wallos 到期提醒」只是启用当前订阅的服务端提醒标记，不代表 ntfy 自动完成配置。

## 测试

```sh
npm ci
npm run check
```

已实现的测试覆盖日期与夏令时安全计算、周期映射、筛选、表单字段、POST API Key 传输、编辑/删除操作、Cloudflare Access HTTP/HTML 错误和部分元数据接口异常。

尚需在真实用户 Wallos 环境与 iPhone/Android Obsidian 中进行联调；不要把单元测试等同于真实移动端测试。

## 安全与限制

- 插件不存本地订阅数据库，不把账号和费用写入任何 Markdown。
- 所有 API 请求通过 Obsidian `requestUrl`，避免 WebView CORS 限制；API Key 只随 HTTPS 表单体发送，不放 URL。
- 直接 POST Wallos 官方接口，未引入额外的服务器、WebSocket、数据库或代理。
- 此版本不包含 PennyWallet 自动记账：Wallos 预计续费日期不等于真实支付成功，自动入账会导致虚假账目。后续可通过 PennyWallet URI 实现用户确认的手动入账。
- Wallos 的 `get_monthly_cost` 显示当月费用；没有可用汇率时请检查 Wallos 原生的币种与汇率设置。
- 此版本未在公开的 Obsidian 插件商店上架。BRAT 安装需公开仓库或 Release，仓库创建后再处理。

## 项目结构

- `src/api.ts`：Wallos 5.8.1 HTTP 接口适配
- `src/model.ts`：日期、周期、搜索、数据校验
- `src/view.ts`：响应式订阅面板
- `src/modals.ts`：新增、编辑、删除确认
- `src/settings.ts`：SecretStorage 和 Access 设置
- `src/main.ts`：Obsidian 插件生命周期与命令
- `styles.css`：移动端和桌面端视觉样式
- `tests/`：API 和业务规则的单元测试

## License

MIT。Wallos 是独立的 GPL-3.0 项目，本插件通过公开 API 互操作，不包含 Wallos PHP 源码。
