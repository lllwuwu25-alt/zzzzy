# 飞书权限与接口核实

核实日期：2026-10-25。对象：企业自建应用、用户身份访问、单实例测试网关。

本记录区分“官方文档契约已核实”和“真实租户调用通过”。当前没有应用凭证、授权回调部署或真实设备证据，因此所有真实授权、建库、附件、管理权限、刷新与跨设备验收均未执行。下面的权限与接口依据官方 Markdown 文档读取核实，不等同于平台联调通过。

## 最小申请范围

网关默认请求 `offline_access bitable:app`，不申请全量通讯录、手机号、邮箱或消息权限。

| Scope ID | 用途 | 用户身份支持与边界 |
| --- | --- | --- |
| `offline_access` | 获得刷新凭证，允许授权到期前续期 | 用户必须实际授予；只在响应返回刷新凭证及其有效期时启用。申请此 scope 不代表一定获得长期授权。 |
| `bitable:app` | 创建专用多维表格、创建五张业务表与字段、查询/创建/更新记录、上传/下载附件、核实当前用户管理权限 | 以下官方接口均将此 ID 列为可选权限之一，并支持 `user_access_token`。这是覆盖完整多维表格管理能力的现有聚合权限，不是只读权限。 |

可进一步细分为 `base:app:create`、`base:table:create`、`base:record:create`、`base:record:retrieve` 等权限，但本版没有混用一组未经完整联调的细粒度授权方案。客户端不持有飞书凭证，也不能将 `app_token`、`record_id` 或 `file_token` 作为产品访问授权。

飞书资源权限、应用权限、应用可用范围是独立条件。管理员批准 API 权限并不赋予任意已有题库访问权；用户仍须对题库具有相应文档权限。资源由用户身份创建于其可访问云空间，禁止改用开发者应用身份作为降级。

## 当前 OAuth 契约

2026-10-25 读取的官方说明已将 `authen/v2/oauth/token` 标为历史版本，并要求新接入采用 v3。本版据此使用最新 v3，而不是照抄需求参考链接中的旧端点。OAuth 仍是授权码流程，不代表切换成另一种登录产品。

| 步骤 | 方法与地址 | 本版采用的参数/返回 |
| --- | --- | --- |
| 授权页 | `GET https://accounts.feishu.cn/open-apis/authen/v1/authorize` | `client_id`、`response_type=code`、固定 `redirect_uri`、空格分隔 `scope`、一次性 `state`；恢复流程额外使用官方支持的 `prompt=consent`。 |
| 换取访问凭证 | `POST https://accounts.feishu.cn/oauth/v3/token` | `grant_type=authorization_code`、`client_id`、网关 `client_secret`、`code`、同一 `redirect_uri`。v3 推荐表单编码，但官方同时明确兼容 JSON；本版使用 JSON。 |
| 刷新 | 同上 | `grant_type=refresh_token`、`client_id`、`client_secret`、`refresh_token`。有效期来自响应，不写死；刷新凭证单次使用，成功后替换。网络未知结果不盲目重放。 |
| 用户信息 | `GET https://open.feishu.cn/open-apis/authen/v1/user_info` | 用户 Bearer，仅读取 `open_id`、`tenant_key`、`name`。官方该接口无额外 API scope 要求；邮箱、手机号、工号等敏感字段另需权限，本版不使用。 |

`prompt=consent` 表示显示授权确认，不代表强制重新输入密码或额外多因素认证。本版为能安全保存 Secret 的服务端机密客户端；没有假设本地客户端是飞书 Public Client，也未拼接未经端到端验证的 PKCE 参数。

身份键包含 `provider + app_id + tenant_key + open_id`，产品账号另有自己的 UUID；名称不参与账号合并。

官方来源：

- [获取授权码](https://open.feishu.cn/document/common-capabilities/sso/api/obtain-oauth-code)
- [获取用户访问凭证 v3](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/authentication-management/access-token/get-user-access-token-v3)
- [刷新用户访问凭证 v3](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/authentication-management/access-token/refresh-user-access-token-v3)
- [用户信息](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/authen-v1/user_info/get)

## 多维表格与附件

业务端点均在 `https://open.feishu.cn/open-apis` 下，网关只使用当前授权用户的 Bearer。

| 能力 | API 路径 | 已核实的约束 |
| --- | --- | --- |
| 创建多维表格 | `POST /bitable/v1/apps` | 可在用户云空间根目录创建，返回 `app_token`、URL、默认空表 ID。创建结果未知时进入核对，不能盲目再建。 |
| 创建数据表 | `POST /bitable/v1/apps/:app_token/tables` | `table` 包含名称、默认视图、初始字段；第一个字段是索引字段。本版加入随机题库归属标记字段，不能只按表名或列表顺序恢复。 |
| 字段 | `GET/POST /bitable/v1/apps/:app_token/tables/:table_id/fields` | 文本类型 `1`、数字 `2`、附件 `17`。存储逻辑字段与物理 ID/名称/类型映射；既有字段被删除、改名、换类型时停止写入。 |
| 查询记录 | `POST /bitable/v1/apps/:app_token/tables/:table_id/records/search` | 用稳定业务 UUID 筛选；支持分页，单页上限 500，本版使用 100。飞书分页标记不是产品增量游标。 |
| 写记录 | `POST /.../records`、`PUT /.../records/:record_id` | 独立记录保存有限的版本化 JSON 和修订元数据；本版每条 JSON 安全上限 16 KiB，不能用单个单元格存整套题库。产品幂等依靠本地意图与 UUID/操作标识/内容哈希核对，不假设跨记录事务。 |
| 上传素材 | `POST /drive/v1/medias/upload_all` | Multipart；`parent_type=bitable_image`、`parent_node=app_token`，并提供 `extra.drive_route_token`。普通上传最大 `20971520` 字节（20 MiB），5 QPS、每天 10000 次；上传不并发。 |
| 下载素材 | `GET /drive/v1/medias/:file_token/download` | 使用自己题库已确认资产的服务端 token；高级权限 `extra` 包含表 ID、附件字段 **ID**、记录 ID、token 列表。请求不跟随外部重定向，下载受大小及 SHA-256 校验。 |
| 管理权限核实 | `GET /drive/v1/permissions/:token/members/auth?type=bitable&action=manage_public` | 必须收到 `data.auth_result === true`；不能凭“能读到表”推断可管理，也不能假设资源所有者一定出现在协作者列表。 |

图片保留 PNG、JPEG、WebP、GIF、BMP 原始字节；网关核对魔数、声明 MIME、长度和哈希，不为同步静默压缩原图。编辑信息随资产版本保存，已发布资产不可原地替换。每个资产记录只绑定一个附件，file token 保留在网关映射及飞书附件字段中，不下发为客户端访问凭证。

活跃客户端每次增量轮询额外轮换核对最多三条已索引记录；五张业务表的已映射字段每五分钟作一次只读结构核验。游标和核验时间持久保存为协调元数据，不保存正文。手工改动被核对到时返回异常并暂停，不重建字段、不删除本地记录；这是有界轮询检测，不是保证即时发现所有飞书网页操作。

大于 20 MiB 的文件必须另走平台分片接口。官方概述支持 4 MiB 分片及一天内恢复，本版没有实现该流程：超过单文件限制明确拒绝；不展示虚假“断点续传”。已知上传成功后的记录阶段可重试，上传结果未知则需核对而非重复上传。

官方来源：

- [创建多维表格](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app/create)
- [创建数据表](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table/create)
- [创建字段](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-field/create)
- [查询记录](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/bitable-v1/app-table-record/search)
- [新增记录与附件格式](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-record/create)
- [上传素材](https://open.feishu.cn/document/server-docs/docs/drive-v1/media/upload_all)
- [素材概述与额外鉴权参数](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/drive-v1/media/introduction)
- [下载素材](https://open.feishu.cn/document/server-docs/docs/drive-v1/media/download)
- [判断用户权限](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/drive-v1/permission-member/auth)

## 审批与可用范围检查

部署人员在飞书开发者后台配置应用凭证、固定回调、API 权限和可用范围，创建并发布版本，并按组织策略完成管理员审批。新增权限或修改安全设置后需要重新发布；测试账号需在应用可用范围，测试租户需在网关允许列表。

如后台显示“刷新 user_access_token”开关，需开启并发版；官方说明看不到该开关时按默认开启处理。无实际刷新凭证时不得假装已开启后台持续同步。

排错顺序：确认正确应用和测试租户 → 权限已开通并发版/获批 → 账号处于应用可用范围 → 回调完全匹配 → 实际授权 scope 满足 → 用户对题库资源有权。拒绝或权限不足时保留本地修改，不切换应用身份。

生产的跨租户安装、管理员授权、卸载/撤销事件与新旧应用迁移尚未完成，网关 production 模式明确阻断；不能把自建应用通过测试视作已获得商店发布资格。

## 核实证据与可复现方法

网页读取最初只返回前端 HTML 壳。随后直接获取同一官方页面的 `.md` 版本，获得接口方法、字段、scope 与限制的正文；没有依赖第三方镜像来确认上述契约。可重现示例：

```sh
curl -sSL --fail 'https://open.feishu.cn/document/server-docs/docs/drive-v1/media/upload_all.md'
curl -sSL --fail 'https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/drive-v1/permission-member/auth.md'
curl -sSL --fail 'https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/authentication-management/access-token/get-user-access-token-v3.md'
```

版本证据：旧 token 文档正文明确标注 v2 历史版并指向 v3；v3 文档明确 JSON 兼容与单次刷新；素材正文列出精确 `20971520` 字节限制；权限判断正文列出 `manage_public` 与 `auth_result`。源码与传输边界测试已按这些契约实现，但服务端响应、实际资源归属与租户限制仍须真实环境逐项验收。
