# 开发与发布

## 运行

    npm ci
    npm run typecheck
    npm run test
    npm run build

也可以运行 npm run check。测试覆盖日期与周期、闰年/月末、筛选、币种和均值、API 参数/错误与配对流程。通过自动化不等于真实手机浏览器 OIDC 已验收。

## 发布

1. 更新 manifest.json、package.json、versions.json、CHANGELOG.md 的版本。
2. 本地执行 npm ci 和 npm run check，检查 git diff 与打包结果。
3. git pull --rebase，再推送 main；新提交遵循中文 Conventional Commits。
4. 等待 GitHub CI 与 Release workflow 完成，确认最新 Release 的 main.js、manifest.json、styles.css 三项附件存在。
5. 发布过的版本不替换附件；任何修复都提升版本号重新发布。

## 数据处理

仅 data.json 保存可同步的非敏感设置；SecretStorage 引用 ID 存在 app.saveLocalStorage 的 Vault 专属设备本地数据中。API Key 保留在设备本地 SecretStorage，旧版同步引用只用于一次性迁移，随后从 data.json 移除。订阅、分类、预算等仅用于会话内存显示，不写入笔记仓库。server/obsidian-pair.php 是用户独立部署的桥接，不能把生产 SQLite 与密钥提交到仓库。

## 工作区及响应式兼容性

- src/workspace.ts 负责创建独立右侧叶子，并将首次 API 读取延后到 workspace.onLayoutReady + requestIdleCallback。旧设备无 requestIdleCallback 时退化为可取消的短延时。
- tests/workspace.test.ts 模拟已有 Notebook Navigator 视图，保证其 setViewState 不会被 Wallos 调用；还覆盖关闭视图、移动端、新旧调度器。
- tests/style-isolation.test.ts 验证 CSS 未重写文件树/工作区全局选择器；styles.css 使用 @container wallos-pane 使响应式以插件面板宽度而非桌面窗口宽度判断。
- Chromium 测试夹具使用无生产数据的模拟订阅；已经在 345 px 侧栏和 880 px 宽视图中检查列数、横向溢出与标签换行。此类夹具不构成真实 Obsidian + Notebook Navigator 同时运行的实机验收。
