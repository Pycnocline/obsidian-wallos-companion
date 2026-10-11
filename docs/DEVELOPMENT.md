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

仅 data.json 保存非敏感设置与 SecretStorage 引用 ID。API Key 保留在设备本地 SecretStorage。订阅、分类、预算等仅用于会话内存显示，不写入笔记仓库。server/obsidian-pair.php 是用户独立部署的桥接，不能把生产 SQLite 与密钥提交到仓库。
