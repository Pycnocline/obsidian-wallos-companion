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
| 订阅图标展示、网络图片 URL、文件上传、四种网络搜索源与预览 | Wallos API 与原生图标搜索接口 |
| 状态、名称、分类、支付方式、付款人筛选与排序 | 已实现 |
| 续费月历、单日明细、跨月切换 | 连续七列日历；客户端预测，不是交易账本 |
| 自定义财务概览卡片及排序、标题、指标、动态内容、说明和提示文本 | 普通插件配置，随 Vault 设置同步 |
| 本月实际计划支出和归一化平均月费 | 单独展示，按币种校验 |
| 六个月预计支出图表、分类月均成本 | 已实现 |
| 分类、支付方式、家庭成员、币种 | Wallos API CRUD |
| 月度/周期预算和服务端显示偏好 | Wallos API 读写 |
| 通知渠道启用、禁用、未配置状态 | 只读 |
| 管理员认证设置、通知提供商凭证、Fixer 凭证 | 仍在 Wallos 网页配置 |

注意年付按 12 个月分摊计算月均；本月预计支出取 Wallos 后端月度金额。多币种汇率没有有效数据时，不直接加总。更多细节参见 docs/API.md 。

## 图标搜索、上传与显示（0.3.4）

在 **订阅 → 新增订阅 / 编辑订阅** 中找到「订阅图标」，支持：

- **显示现有图标**：订阅列表直接从 Wallos 的图片目录显示已有文件，加载失败回退到名称首字。
- **网络图标 URL**：粘贴一个可访问的 HTTPS 图片直链，或使用搜索结果。保存订阅时把 logo_url 交给 Wallos 下载、转码和保存，不会把外部图片地址作为订阅数据源。
- **在线搜索**：选择 selfh.st Icons、Dashboard Icons、Brave 图片或 DuckDuckGo 图片，输入关键词并点击「搜索」；点按结果后点击「保存修改 / 创建订阅」才会真正写入。复用 Wallos 5.8.1 已有图标搜索接口，**不需要 Brave Search API Key**。部分来源有上游限流，搜索结果不保证随时可得。
- **本地上传**：选择 PNG、JPEG、GIF、WebP 图片（插件限制 8 MiB），通过 Wallos 原生 logo multipart 字段上传。插件检查图像文件头与 MIME，Wallos 负责缩放与存储。
- **保留原有图标**：不会因修改其他订阅字段而覆盖现有图标。Wallos 5.8.1 的公开 API 不提供独立清空既有图标的参数，本插件不会伪造“删除图标成功”。

如果 Wallos 在订阅保存成功后单独返回 logo_warning，插件会通知「订阅已保存，但图标未成功处理」，而不是把两者合并为成功。

## 自定义财务概览卡片（0.3.4）

在 Wallos 面板上方「财务概览 → 自定义卡片」，或 **设置 → Wallos Companion → 财务概览卡片** 打开配置窗口。可添加/删除和上下调整排序（最多 16 张）、选择指标、隐藏卡片/图标/说明，自定义卡片标题、主数值内容、下方说明及悬停时显示的提示文本。配置可通过 Synchrun 的插件数据同步，但 **API Key/凭据引用仍然仅保存在每台设备本地**。

主内容为空时，使用所选指标的默认值。文本可嵌入固定变量：{{monthly_average}}、{{monthly_estimate}}、{{annual_average}}、{{active_count}}、{{inactive_count}}、{{total_count}}、{{due_7}}、{{due_30}}、{{next_renewal}}、{{monthly_budget}}、{{month}}、{{today}}。变量只进行文本替换，不运行 JavaScript，也不写入笔记。无法验证汇率时，多币种分别展示，绝不直接相加。

## 月历和窄侧栏

「日历」为连续七列月份表格（周起始日跟随 Wallos 偏好），空白日期展示前后月的淡色日期。点击日期圆圈可以筛选该日的预期续费事件，按「查看整月」恢复整月列表。预测数据来自 Wallos 订阅数据，与已扣款交易不是同一个概念。

布局采用 Obsidian 面板容器宽度响应式约束，对超长订阅名、金额、分类和按钮文字自动折行或截断，避免内容越过按钮与卡片背景。本轮以修复功能与布局问题为主，不重做整体 UI 风格。

## 构建与发布

    npm ci
    npm run check

新版本更新 manifest.json、package.json 和 versions.json 的版本号后，推送 main 触发 GitHub Actions 自动构建 Release；BRAT 从 Release 读取三个插件附件。见 docs/DEVELOPMENT.md。

安全细节见 SECURITY.md。插件 MIT License；Wallos 为独立 GPL-3.0 项目。

## 与其他 Obsidian 插件共存

Wallos 面板使用专用的 WorkspaceLeaf，不覆盖已存在的侧栏视图。恢复工作区布局时，Wallos 会把首次网络请求安排到布局就绪和浏览器空闲之后。插件不读写 Notebook Navigator 的配置、IndexedDB 或 Obsidian Vault 文件。

若 Notebook Navigator 在应用启动后短暂显示空目录，仍需区分布局/缓存启动时序、同步插件传递设置的时间以及第三方插件冲突。Wallos 的测试保证自身不复用其他插件视图，但尚未在实际用户设备中证明目录空白的具体成因。
