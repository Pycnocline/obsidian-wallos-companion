# 安全说明

- 插件要求 Obsidian 1.11.4+；API Key 与 Access Service Token 保存到 SecretStorage，引用 ID 仅保存到设备本地 Vault 专属存储，不能放入同步的 data.json、笔记、URL 或日志。
- 仅允许 HTTPS 的远程 Wallos 主机；localhost 回环地址可用 HTTP。
- 一次性设备配对使用 256-bit verifier，验证器仅用于 POST；浏览器授权页面仅含随机配对 ID，配对有效期 600 秒。
- 生产服务需 CSRF 防护，凭证领取后立即删除配对状态；已授权 API Key 与账户本身具有同等权限。
- 通知接口响应包含可能敏感的秘密设置，客户端只返回服务名称与 enabled 状态。
- 断开插件只清除密钥引用，不撤销 Wallos 后端 API Key。设备遗失需在 Wallos 端轮换 API Key。
- 图标 URL 仅支持 HTTP/HTTPS，插件限制本地文件至 8 MiB 的 PNG/JPEG/GIF/WebP 且检查文件头；Wallos 服务端下载远程图片时自带私网地址拦截。网络缩略图可能来自 Brave/DuckDuckGo 搜索中出现的第三方地址。
- 搜索图标的 GET 请求不附加 Wallos API Key，保存图标时 API Key 仅随 POST 表单体提交。logo_warning 代表 Wallos 图片处理失败，不能忽略。
- 自定义财务卡片的文本变量来自白名单，页面使用 DOM 文本节点渲染，不允许运行自定义 HTML 或脚本。
- 不提交生产数据、.env、令牌、截图中的个人资料。
