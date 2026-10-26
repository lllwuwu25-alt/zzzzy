# 飞书同步：开发者配置与独立部署

本文件供产品拥有者、管理员和部署人员使用。普通用户仍从现有错题本的“设置 → 云同步”点击连接飞书，不填写 App Secret、表格链接、Table ID 或长期 Token。本次是在现有 React/Tauri 错题本上增加同步，未另建演示产品；桌面端既有离线能力和软件授权不被云登录替代。

当前交付是企业自建应用、单实例、持久 SQLite 的 staging 实现。`APP_ENV=production` 明确返回 `PRODUCTION_NOT_IMPLEMENTED` 并拒绝启动；改应用类型或设置空租户名单不能解除此限制。跨租户安装、管理员授权生命周期、卸载/撤销事件及新旧应用迁移仍需单独实现与平台验收。

代码及本地边界测试不等于飞书联调。目标手机已确认为 HONOR 90 / Android 15，但未连接到本测试环境；当前没有真实凭证或可达 HTTPS 域名。Docker/Caddy 也未安装，所以本文的容器构建、证书签发、真实 OAuth、建库和物理双端验证均待部署执行。已验证的备份/恢复和安全测试见验证报告。

## 1. 先准备独立服务

1. 准备一台不会随电脑关机而停止的服务器，具备可靠持久磁盘、Docker Engine 与 Compose v2、域名和外网出口。不要把 SQLite 放在无状态函数临时目录，不要同时启动多个网关副本共用文件。
2. 将自己的域名（以下示例为 `notebook.example.com`，必须替换）解析到服务器，放通公网 TCP 80/443；如启用 HTTP/3，再放通 UDP 443。不要向公网开放网关 8787。
3. 确认服务器可访问飞书 `accounts.feishu.cn`、`open.feishu.cn`、镜像仓库及 npm 安装源。不要让运行时依赖某台桌面电脑的本地代理。
4. 将本仓库部署分支放到可信服务器。下面命令均从仓库根目录执行。Dockerfile 仅复制构建所需文件，配套 `Dockerfile.dockerignore` 排除凭证、Git 历史和本地题库数据；不要改为 `COPY . .`。

## 2. 创建自建应用并发布权限

按顺序在 [飞书开发者后台](https://open.feishu.cn/app) 操作；组织策略和后台版本可能改变页面文案，需以对应栏目显示为准。

1. 登录测试拥有者所在企业，创建“企业自建应用”，记录应用的 App ID 与 App Secret，仅交给部署人员。
2. 在权限管理申请用户身份所需的 `bitable:app`，授权请求另需 `offline_access` 才可能获得刷新凭证。不要额外开通全量通讯录、邮箱、手机号或消息权限。用途、用户身份支持和官方接口来源见 [权限核实](../feishu-permissions.md)。
3. 在安全设置的重定向 URL/回调地址栏目登记固定值：`https://notebook.example.com/v1/auth/feishu/callback`。必须与网关环境变量完全一致，包含协议、域名、路径，不带通配符、片段或任意客户端回流 URL。
4. 如后台要求启用网页应用能力，将主页设为 `https://notebook.example.com`；无需为同步添加机器人或收发消息能力。
5. 在版本管理/发布中创建版本，将拥有者和第二个隔离测试身份加入应用可用范围，提交并完成组织管理员审批后发布。新加权限或改动配置后再次发布/审批，不能只保存开发态配置就认为已生效。
6. 如果后台展示“刷新 user_access_token”开关，开启并发布；如无该开关，按官方接口说明确认默认行为。只有实际 OAuth 返回刷新凭证和有效期后，持续续期才算可用。
7. 取得测试企业精确的 `tenant_key`。推荐部署人员在飞书**官方 API 调试台**选择此应用和测试拥有者身份，调用 [获取用户信息](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/authen-v1/user_info/get)，读取响应的 `data.tenant_key`。这是开发者配置步骤，不是让普通用户粘贴 Token；不把调试台生成的访问凭证抄进产品、代码、聊天或日志。没有调试台权限时，请管理员协助取得该字段，不能猜测企业名称/企业 ID，也不能用 `*` 或关闭租户检查作为临时绕过。

网关以 `provider + app_id + tenant_key + open_id` 区分身份；同名用户不合并。飞书应用权限、可用范围和用户对具体题库的管理权限是三层独立条件。

## 3. 配置运营者环境

```sh
cp tools/sync-gateway/.env.example tools/sync-gateway/.env
chmod 600 tools/sync-gateway/.env
```

编辑该私有文件，逐项填写：

| 字段 | 实际要求 |
| --- | --- |
| `APP_ENV` / `FEISHU_APP_TYPE` | 当前固定 `staging` / `self_built` |
| `APP_DOMAIN` / `ACME_EMAIL` | 自己的真实域名、证书联系人邮箱 |
| `PUBLIC_APP_URL` / `API_PUBLIC_URL` | 推荐两项均为 `https://自己的域名`，不带额外路径 |
| `FEISHU_REDIRECT_URI` | 同一域名的 `/v1/auth/feishu/callback`，与后台登记值一致 |
| `ALLOWED_ORIGINS` | 精确网页 origin，加所需 Tauri origins；无 `*`，无尾部 `/` |
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | 此应用的真实后台凭证，只在网关 |
| `FEISHU_ALLOWED_TENANT_KEYS` | 上一步确认的测试企业 `tenant_key`；多项逗号分隔，空值拒绝启动 |
| `FEISHU_SCOPES` | `offline_access bitable:app`，以实际发布并获准的权限为前提 |
| `TOKEN_ENCRYPTION_KEY` / `SESSION_SIGNING_KEY` | 两个不同的随机 32 字节 base64 密钥，不能用示意值、口令或相同值 |
| `DATABASE_URL` | 容器保持 `file:/data/sync.db`，该目录使用持久 volume |
| `BINDING_TTL_SECONDS` | 默认 300，允许 30–300 秒；二维码凭证服务端只保存哈希 |
| `VITE_SYNC_GATEWAY_URL` | 仅公开 HTTPS 网关地址，原生客户端构建时也须与网关一致 |

密钥应通过密码管理器/秘密管理服务生成并分别保存。例如部署人员可在受控终端执行下面命令两次，将两个不同结果填入私有环境；不要在屏幕共享或录制日志时执行：

```sh
node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64")+"\n")'
```

不要把任何 Secret、飞书 Token、产品会话、加密密钥写入 `VITE_*`，也不要把 `.env` 传入前端 Docker build args。环境文件已由 Git 忽略，但仍必须自行保护服务器文件与备份。

## 4. 构建并启动 HTTPS 同源部署

```sh
docker compose --env-file tools/sync-gateway/.env -f tools/sync-gateway/deploy/compose.yml config --quiet
docker compose --env-file tools/sync-gateway/.env -f tools/sync-gateway/deploy/compose.yml build
docker compose --env-file tools/sync-gateway/.env -f tools/sync-gateway/deploy/compose.yml up -d
```

不要运行不带 `--quiet` 的 `compose config` 后把输出贴到工单；其完整展开结果可能包含 Secret。

容器均以 UID/GID 10001 运行，根文件系统只读、丢弃所有 Linux capabilities。网关没有第三方运行依赖，使用 Node 24 的 HTTP、crypto、SQLite；前端构建仍正常安装现有 React 项目的依赖。Caddy 在容器内使用 8080/8443，对外映射 80/443，自动申请 HTTPS 证书。该端口转发方式遵循 [Caddy 全局端口选项说明](https://caddyserver.com/docs/caddyfile/options#http-port)。

同一 origin 下 `/v1/*` 仅转给网关，其余路径提供已有应用的构建产物。浏览器使用 HttpOnly、Secure、SameSite=Lax Cookie，写请求另校验 Origin 和 CSRF；原生产品会话/设备证明留在操作系统安全存储。代理与网关限制请求体为 32 MiB，认证请求另限 16 KiB。单文件素材目前限制 20 MiB，base64 封装后仍受整体上限约束；没有伪称支持大图分片续传。

Caddy 没有启用访问日志，并排除带 URI 的 HTTP 请求错误日志；不要开启 debug、请求体日志、完整查询串日志或第三方 APM 的 Authorization/Cookie 捕获。OAuth 回调的 code/state 和绑定片段均属敏感短期凭证。诊断使用脱敏错误码与 `request_id`。

检查：

```sh
curl --fail --silent --show-error https://notebook.example.com/v1/status
docker compose --env-file tools/sync-gateway/.env -f tools/sync-gateway/deploy/compose.yml ps
```

`status=configured` 只说明启动配置通过；`liveVerified=false` 明确不是飞书联调成功证明。若证书不可用，先核实 DNS、公网端口、证书联系人和服务商策略，不要改为不安全 HTTP 或禁用 TLS 校验。手机必须用真实公网 HTTPS 地址，不是电脑的 localhost。

原生桌面应用需在构建时设置同一公开地址 `VITE_SYNC_GATEWAY_URL=https://自己的域名`；不能只改变网页运行时配置。这里不自动签名、发布或安装新桌面包。

Docker 的可选网页构建阶段设置 `VITE_CLOUD_MOBILE=true`，让 PWA 使用网关设备准入入口，而不进入桌面原生软件授权页。手动构建可选网页才使用 `VITE_CLOUD_MOBILE=true VITE_SYNC_GATEWAY_URL=https://自己的域名 npm run build`；这不会生成 APK。原生 Android 测试包使用 [安卓说明](android-test.md) 的独立 Actions 工作流。**不要**将手机标记设到原生桌面构建环境，桌面软件授权边界保持不变。

## 5. 本地开发（不等于手机部署）

安装 Node 24.13 或更新的 24.x；网关不需要 `npm install`。自建应用与测试租户 allowlist 仍必须真实配置。开发时可将私有 `.env` 改为 `APP_ENV=development`，URL 使用 `http://localhost:5174` 与 `http://localhost:8787`，回调登记后者的固定路径，数据库使用自己预先创建的私有目录的绝对路径；`HOST=127.0.0.1`。仅在 development 接受 localhost 明文 URL 和非 Secure 开发 Cookie。

```sh
npm --prefix tools/sync-gateway start
node --test tools/sync-gateway/*.test.mjs
npm test
npm run build
```

本机调试手机网页入口时，另在前端进程使用 `VITE_CLOUD_MOBILE=true npm run dev`；普通 `npm run dev` 和原生构建仍保留桌面入口行为。

若云凭证缺失，网关拒绝启动并只打印脱敏配置错误码；现有错题本仍可本地录题、编辑和保存。localhost 开发不验证手机、Intel Mac 实机或电脑关机后的服务独立性。

## 6. SQLite 迁移、备份和恢复

首次连接数据库时自动应用 `migrations/001-coordination.sql`。SQLite 使用 WAL、`synchronous=FULL`、`BEGIN IMMEDIATE` 事务；账号、设备、加密令牌、资源映射、版本、变化索引和未完成操作协调状态必须保留。它不是可随意删除的缓存。题目业务内容位于用户飞书资源，网关备份不能代替题库和原图的完整导出。

运行中禁止仅复制 `sync.db`，否则可能漏掉 WAL 中已提交内容。已实现的工具使用 [Node SQLite online backup API](https://nodejs.org/docs/latest-v24.x/api/sqlite.html#sqlitebackupsourcedb-path-options)，包含一致的已提交状态、输出权限 0600，并拒绝覆盖现有文件：

```sh
docker compose --env-file tools/sync-gateway/.env -f tools/sync-gateway/deploy/compose.yml exec gateway node backup.mjs /data/sync.db /backups/sync-20261025T120000Z.db
```

每次使用新的 UTC 时间文件名；示例时间仅作说明。快照 volume 仍在同一服务器时不算异地备份，应另行加密复制到受控备份存储，定期演练恢复，并按自己的隐私/保留政策清理过期快照。命令不打印令牌、Secret 或业务正文。

密钥必须另存密码管理器或秘密管理服务，和数据库备份分开授权：数据库快照含 AES-GCM 加密的飞书凭证，没有原 `TOKEN_ENCRYPTION_KEY` 无法恢复。保留所需时间段的旧密钥版本，记录对应快照、应用 ID、环境、协议/代码版本；不要将密钥作为同一个备份包内的明文附件。

恢复顺序：

1. 在隔离环境验证备份来源、日期、文件权限和对应密钥。先关闭同步服务，保存事故现场；不要直接覆盖还在运行的 WAL 数据库。
2. 使用**新的独立持久目录/volume** 放置已验证的 SQLite 快照，属主 10001、目录 0700、文件 0600。不要将旧实例的 `-wal`/`-shm` 混入快照目录。
3. 配置同一 staging 环境、应用 ID 与匹配的加密密钥，再将 `DATABASE_URL` 指向新目录。保留原卷，确认恢复后才按运维保留策略处置；不要运行 `docker compose down -v` 删除卷。
4. 启动单实例，检查配置、账号/题库映射、连接状态和脱敏错误；只读核对飞书原资源仍可管理。若授权已失效，按 UI 重新授权，不能删除数据库重建空题库“修复”。
5. 恢复较旧快照可能使网关索引落后于飞书。遇到远端未索引实体、版本/哈希异常时进入核对，不能忽略错误继续覆盖。当前没有自动全库索引灾难重建工具；在完成索引校对前暂停写入，必要时由部署人员设计受控恢复并另行验证。
6. 使用拥有者、第二身份和第二设备核验隔离、撤销和变化流。备份可能包含旧的产品会话哈希；对设备撤销安全有疑问时，应强制重新授权或经“旧设备不可用”流程重新核实管理权限并撤销全部旧设备，不把过时会话静默当成当前授权。

## 7. 密钥轮换

轮换不等于撤销已泄露的飞书授权。若怀疑泄露，应先在飞书后台处理应用 Secret/用户授权风险，暂停写入，并保留本地 outbox，之后重新授权。

正常加密密钥维护应停网关、生成一致快照并确认旧密钥备份，再在隔离副本中使用 `crypto.mjs` 的 `open` 和 `seal`，按每条记录的 `${environment}:${accountId}` AAD 解密后重新加密 `tokens` 命名空间，放入单个 SQLite 事务。验证全部记录可用新密钥解密、旧密钥无法解密后，切换副本及新环境密钥并重启。不要直接换环境密钥而不重新加密数据库；不要原地删旧密钥、令牌或账号映射。本版没有一键轮换 CLI，需维护人员使用上述导出函数编写并审核迁移；未完成演练前列为操作阻断项。

`SESSION_SIGNING_KEY` 用于产品会话的 CSRF 派生。轮换后建议在受控维护中作废既有会话并要求重新登录；不要声称只换这个值就自动撤销了所有已有会话。staging 与未来 production 必须使用独立域名/密钥/数据库/卷/备份策略；数据库内额外按环境命名空间隔离不替代部署隔离。

## 8. 首轮真实验收与故障边界

1. 拥有者从现有桌面端“连接飞书”进入系统浏览器授权，观察自动创建专用题库和五张表；确认资源可在该用户飞书云空间找到且可管理。不得手填表格参数代替自动初始化。
2. 有本地题目时先完整备份、预览首次同步，再确认上传；空设备下载。不能把另一账号旧队列上传给当前身份。
3. 电脑生成二维码，手机在 Android App 内扫描并完成同一身份授权，电脑确认后才获得 active。只登录的手机必须仍为 pending，不能读取题目/图片/变化流或 bootstrap。浏览器/PWA 为可选入口，不替代 APK 实机验收。
4. “旧设备不可用”必须先确认撤销说明，再完成一个新的 OAuth 往返，官方 `prompt=consent` 显示授权确认；这不是额外 MFA 或保证重新输入密码。网关用本次新用户凭证即时检查原题库 `manage_public` 权限，身份/权限/映射不完整即失败，不建空库。验证后在一个事务内撤销全部旧设备/会话/绑定并激活目标设备。仍需真实环境验收。
5. 用第二个获准测试身份验证无法读取拥有者的题库、设备、附件和变化流。再测试撤销、断网重试、刷新、冲突、删除恢复和服务重启。
6. 保持服务器运行并关闭电脑，实测手机仍可新增/复习/上传；物理 Intel Mac、HONOR 90 Android 15 与系统清理后的行为需实际记录。原文中的 HarmonyOS 目标未在本轮实现或验证。

权限不足或资源被删不会改用开发者应用身份，不会清空本地数据。已知限流返回可重试提示；刷新凭证结果未知时不盲目重放可能已消费的凭证，进入重新授权。断开连接清除本服务保存的授权和会话，保留本地及飞书题库；当前没有自动调用飞书授权撤销端点，响应明确标注 `providerRevocation=not_supported`，需要时由用户/管理员在飞书侧撤销。

每项真实操作按 [验收记录](verification.md) 保存环境、版本、步骤和证据；缺少域名、凭证、第二身份、目标设备或管理员审批时标记未执行，不能用单元测试、Docker 启动或漂亮状态动画替代。
