# Wallos 5.8.1 API 兼容性

已对照正在运行的 bellamy/wallos:5.8.1 容器中的接口路径与参数。业务 API 在没有上传图标时通过 HTTPS 的 x-www-form-urlencoded POST 发送 API Key；上传图标时使用原生 multipart/form-data（API Key 作为 POST 字段）；密钥不放在 URL。用于搜索图标的 Wallos 公共 GET 端点不携带 Wallos API Key。

| 业务 | PHP API | 操作 |
| --- | --- | --- |
| 订阅 | subscriptions/get_subscriptions.php、set_subscriptions.php | 增删改查 |
| 本月金额 | subscriptions/get_monthly_cost.php | 只读 |
| 分类 | categories/get_categories.php、set_categories.php | CRUD |
| 支付方式 | payment_methods/get_payment_methods.php、set_payment_methods.php | CRUD |
| 家庭成员 | household/get_household.php、set_household.php | CRUD |
| 币种 | currencies/get_currencies.php、set_currencies.php | CRUD |
| 服务端设置 | settings/get_settings.php、set_settings.php | 受限的显示偏好 |
| 预算 | users/get_user.php、set_budget.php、subscriptions/get_period_budget.php | 读写 |
| 通知 | notifications/get_notification_settings.php | 只显示 enabled |
| 登录 | /obsidian-pair.php | 需额外挂载配对桥接 |
| 图标搜索 | /endpoints/logos/icon_search.php、/endpoints/logos/search.php | GET，分别查询 selfhst/dashboardicons 和 brave/duckduckgo，不携带 Wallos API Key |
| 图标保存 | /api/subscriptions/set_subscriptions.php | POST logo_url 或 multipart 文件字段 logo |

除配对桥接和图标搜索这两个例外，业务 API 均在 Wallos 的 /api/ 路径下。

Wallos 的 get_subscriptions.php 返回 logo 文件名，插件只允许合法图片文件名，并构建 images/uploads/logos 下的图片地址。原生 set_subscriptions.php 对图片保存失败会返回 success:true + logo_warning，此时订阅的其他字段已经提交，但不能声称图标也已保存。服务器具备内网与私网地址拒绝逻辑，插件只接收 HTTP/HTTPS 网络地址。公开 API 不支持独立删除原有图标，不能把空 URL 视为删除操作。

## 日历与金额含义

- 续费日历根据 next_payment、cycle、frequency、auto_renew、inactive、cancellation_date 进行预测；不会推断已完成交易。
- 自动续订的月末日期采用初始到期日锚点，以避免 1 月 31 日 → 2 月 28 日 → 3 月 28 日的日期漂移。
- 本月预计支出直接取 Wallos get_monthly_cost.php 返回值。
- 月均成本按日 365.2425 天/年、周 365.2425/7 周/年、月、年来分摊周期费用。
- 多币种金额仅在具备可用汇率时换算到主币，否则独立按币种显示，不合并数额。
- 最近六个月的预计支出从 Wallos 逐月读取，不创建第二个数据库。
- 自定义财务概览指标由已有订阅、预算、当前月费用字段派生；排序、文本模板、提示和可见性仅保存在非敏感插件配置中。
- 月历按连续周表格生成日期格，包含当月末尾日及前后月占位；周起始日跟随 Wallos 偏好。

## 约束和隐私

正在使用的分类、支付方式、币种和家庭成员不可删除；默认币种不能删除。通知接口含机密字段，插件仅提取渠道名称与 enabled 布尔值。管理员配置、Fixer、通知提供商的凭证及公开 iCalendar 地址不在插件内管理。

公开 API 兼容性依赖 Wallos 版本；升级上游后应重新核对 PHP 接口。
