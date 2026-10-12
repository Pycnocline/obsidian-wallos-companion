# Wallos Companion for Obsidian

在 Obsidian 内使用 Wallos 5.8.1 的订阅管理、续费日历、费用统计和数据设置。面向桌面与移动端。

**唯一数据源是 Wallos**：不在 Vault 中复制订阅数据库；提醒与汇率仍在服务器运行。

## 通过 BRAT 安装

1. Obsidian 社区插件中安装并启用 BRAT（https://github.com/TfTHacker/obsidian42-brat）。
2. BRAT → Add Beta Plugin，填入 https://github.com/Pycnocline/obsidian-wallos-companion 。
3. 启用 Wallos Companion，然后到插件设置中连接账户。

或者从 https://github.com/Pycnocline/obsidian-wallos-companion/releases 下载同一版本的 main.js、manifest.json、styles.css，放在 Vault/.obsidian/plugins/wallos-companion/。

要求 Obsidian 1.11.4+。兼容 iOS/Android；自动化测试通过不代表手机登录实机已验收。

## 登录

默认实例：https://wallos.iamin.icu 。

1. 插件设置 → 登录 Cloudflare / Someday，在浏览器完成统一登录。
2. 返回 Obsidian → 授权此设备，在浏览器确认。
3. 返回 Obsidian → 完成连接，打开侧边栏钱包图标。

配对有效期 600 秒，仅限制首次授权流程，并非 API Key 的登录有效期。密钥保存在设备的 Obsidian SecretStorage；**密钥引用保存在该设备、该 Vault 专属的 Obsidian 本地存储**，不会写入同步的 `data.json`。Synchrun 同步插件设置不会覆盖其他设备已经建立的登录；首次使用新设备仍需单独授权。

从 0.3.2 或更早版本升级时，插件会自动迁移当前设备可访问的旧密钥引用；如果同步覆盖过旧引用，且本地仅有一个可辨认的旧版密钥，会自动恢复。存在多个无法区分的旧密钥时不会猜测账户，需要重新授权一次。使用自己的 Wallos 服务时，需要单独部署 server/obsidian-pair.php 桥接；不要覆盖原有登录补丁。

## 现有功能

| 功能 | 支持程度 |
| --- | --- |
| 订阅增删改、取消日期、替代订阅、停用/恢复 | Wallos API 读写 |
| 状态、名称、分类、支付方式、付款人筛选与排序 | 已实现 |
| 续费月历、单日明细、跨月切换 | 客户端预测，不是交易账本 |
| 本月实际计划支出和归一化平均月费 | 单独展示，按币种校验 |
| 六个月预计支出图表、分类月均成本 | 已实现 |
| 分类、支付方式、家庭成员、币种 | Wallos API CRUD |
| 月度/周期预算和服务端显示偏好 | Wallos API 读写 |
| 通知渠道启用、禁用、未配置状态 | 只读 |
| 管理员认证设置、通知提供商凭证、Fixer 凭证 | 仍在 Wallos 网页配置 |

注意年付按 12 个月分摊计算月均；本月预计支出取 Wallos 后端月度金额。多币种汇率没有有效数据时，不直接加总。更多细节参见 docs/API.md 。

## 构建与发布

    npm ci
    npm run check

新版本更新 manifest.json、package.json 和 versions.json 的版本号后，推送 main 触发 GitHub Actions 自动构建 Release；BRAT 从 Release 读取三个插件附件。见 docs/DEVELOPMENT.md。

安全细节见 SECURITY.md。插件 MIT License；Wallos 为独立 GPL-3.0 项目。

## 与其他 Obsidian 插件共存

Wallos 面板使用专用的 WorkspaceLeaf，不覆盖已存在的侧栏视图。恢复工作区布局时，Wallos 会把首次网络请求安排到布局就绪和浏览器空闲之后。插件不读写 Notebook Navigator 的配置、IndexedDB 或 Obsidian Vault 文件。

若 Notebook Navigator 在应用启动后短暂显示空目录，仍需区分布局/缓存启动时序、同步插件传递设置的时间以及第三方插件冲突。Wallos 的测试保证自身不复用其他插件视图，但尚未在实际用户设备中证明目录空白的具体成因。
