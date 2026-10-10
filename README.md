# Wallos Companion for Obsidian

Wallos v5.8.1 订阅管理 Obsidian 插件，支持桌面与 iOS/Android。当前开发版本 **0.2.0**。

## 功能

- 阅读月度费用、订阅列表、到期提醒与分类；新增、编辑、删除订阅
- 响应式窄屏触控界面；Wallos 是唯一的数据来源，服务器负责持续通知
- **网页统一登录**：在 Obsidian 启动登录 → 浏览器完成 Someday SSO / Cloudflare 登录 → 回到 Obsidian 点击“授权此设备” → 浏览器确认 → 回到 Obsidian 点击“完成连接”
- 登录密钥存放在 Obsidian SecretStorage，不会写入 Vault 的 data.json
- 可在设置中退出插件；已有 API Key / Cloudflare Access Service Token 仍可作为高级备用配置

## 重要：一键登录需要服务端配对接口

**仅安装 Obsidian 插件不能启用一键登录。** 需要把仓库 `server/obsidian-pair.php` 挂载到 Wallos Web 根目录的 `/var/www/html/obsidian-pair.php`。该文件与当前 Wallos 部署的 `/login.php`、`/sso.php` 配合使用，且需要 Wallos 用户已有 API Key。不要覆盖现有登录补丁。

配对接口必须：
1. 与 Wallos 同源，通过 HTTPS 访问，不允许绕过 Cloudflare 已存在的保护策略
2. 使用现有 Wallos 会话进行网页授权
3. 使用独立、有效期 180 秒的配对状态和 256 位随机验证器
4. 通过 HTTPS POST 将已有 API Key 交回请求发起设备，领取后删除状态

2026-10-10 已在项目维护者的 Wallos 5.8.1 实例完成挂载和服务端接口验证：健康检查 200、无效配对请求 410、配对创建 200、未授权状态 `pending`、错误验证器 403、未登录确认 401、`/db/obsidian_pairing.db` HTTP 403。**浏览器真实登录确认与 Obsidian 手机实机仍需验证**；其他 Wallos 实例仍需自行部署此接口。

Compose 在当前 Wallos 镜像中不能给该 PHP 文件挂载加 `:ro`：启动脚本会对应用目录运行 `chown`，只读挂载会导致启动失败。源文件应仅在主机中通过受控方式维护。配对 SQLite 数据库存放于 Web 访问受限的 Wallos `db` 目录。

## 安装开发版

将 `main.js`、`manifest.json`、`styles.css` 放入 Vault 的 `.obsidian/plugins/wallos-companion/`，然后在 Obsidian 设置 → 第三方插件启用。

要求 Obsidian 1.11.4+。移动设备上的 SecretStorage 独立于 Vault，需要分别完成登录。

## 开发 / 验证

```sh
npm ci
npm run check
```

目前通过 TypeScript 静态检查、12 项单元测试、esbuild 生产构建；**尚未完成真实 Wallos 登录和手机实机测试**。

## 目录

- `src/api.ts`：Wallos 官方订阅 API
- `src/pairing.ts`：配对客户端
- `src/main.ts`：登录动作、SecretStorage、插件入口
- `src/settings.ts`：登录及连接设置
- `src/view.ts`：订阅面板
- `server/obsidian-pair.php`：可选的 Wallos 登录桥接
- `tests/`：单元测试

## License

MIT。Wallos 为独立的 GPL-3.0 项目。
