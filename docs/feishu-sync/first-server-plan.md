# 没有服务器时，怎样开始飞书双端测试

## 先说结论

手机继续使用 APK，不改成手机网站。需要另加 **一台长期在线的 Linux 服务器和一个域名**，承载飞书 OAuth 回调、加密凭据、设备确认和同步协调。电脑关机后，这台服务器继续运行；不能用电脑上的 localhost 充当正式手机同步地址。

这份方案基于现有仓库的 Node 24 网关、SQLite、Docker Compose 与 Caddy 配置，不另做演示程序。当前未购买、未部署、未签发真实证书，也没有验证真实飞书同步。

## 第一阶段准备这些就够了

| 项目 | 建议 | 原因 |
| --- | --- | --- |
| 云服务器 | 先试用/月付；Linux x86_64，建议 2 核 / 4 GB 内存 / 40 GB 以上持久磁盘 | 足够作为自用双端联调的起点，不是并发承诺或压力测试结果 |
| 系统 | Ubuntu 24.04 LTS，Docker Engine + Compose v2 | 对齐现有单机部署材料，不需要 Windows Server、Android SDK 或桌面环境 |
| 网络 | 独立公网 IPv4，能从手机访问 80/443，能访问飞书与镜像源 | 用于 OAuth、证书及同步；8787 只在容器内开放 |
| 域名 | 一个可控域名，使用 `sync.你的域名` 子域名 | 客户端、回调和扫码统一一个 HTTPS origin |
| 飞书 | 你自己组织中的企业自建应用，已发布到测试人员可用范围 | 第一轮只做你自己的电脑、HONOR 90 和隔离测试账号 |

云商可选 [腾讯云轻量应用服务器](https://cloud.tencent.com/product/lighthouse) 或 [阿里云轻量应用服务器](https://help.aliyun.com/zh/simple-application-server/)。先选能稳定被手机和飞书访问的地域，购买前核对该地域的合规要求、续费价格、月流量与超额费用。不要只看首页首年活动价，也不需要为了两台设备先买数据库、Redis、对象存储、负载均衡或 Kubernetes。

建议先买最短周期验证连通性，确定地域和功能后再考虑年付。这里不承诺某个套餐价格或日后服务量；公开多人使用前需要容量和故障演练。

## 你做什么，我可以继续做什么

你需要自己完成或授权管理员完成：

1. 注册/实名认证云账号，选择服务器与域名，确认费用。
2. 在域名后台为 `sync.你的域名` 添加指向服务器公网 IP 的 A 记录。
3. 在飞书后台创建自建应用、申请权限、登记回调并完成管理员发布审批。

取得这些条件后，我可以继续在已有项目上完成：

- 服务器基础配置、Docker 与现有 Compose 部署、DNS/HTTPS 检查。
- 后端私有参数配置指导、持久卷权限、健康检查、备份与恢复演练。
- 将公开服务地址写入电脑测试版和 APK，重新生成匹配安装包。
- 按顺序做真实 OAuth、自动建库、扫码、电脑确认、离线重连及冲突测试。

只需先告诉我公网测试域名和服务器情况。**不要在聊天里发送 root 密码、SSH 私钥、App Secret、数据库加密密钥或发码保险库。** 后续通过已登录控制台或受控服务器终端填写私有配置；普通用户从头到尾不填这些参数。

## 部署和验收按这个顺序

### 1. 域名与服务器连通

确认 DNS 解析到正确公网 IP，服务器安全组放行 TCP 80/443，SSH 仅限受控管理来源。不要把网关、数据库、Docker 管理接口暴露到公网。

### 2. 飞书后台配置

按 [开发者配置第 2 节](https://github.com/lllwuwu25-alt/zzzzy/blob/codex/android-honor90-test/docs/feishu-sync/developer-setup.md#2-创建自建应用并发布权限) 创建并发布自建应用。

- 用户权限：`bitable:app`；OAuth 请求使用 `offline_access`，必须实际取得刷新凭证才能验收续期。
- 固定回调：`https://sync.你的域名/v1/auth/feishu/callback`。
- 精确确认测试组织的 `tenant_key`，仅允许测试组织；不使用 `*`。
- 不额外申请全通讯录、邮箱、手机号或消息权限。

### 3. 部署现有网关

服务器取得本分支代码后，部署人员参照仓库的 `tools/sync-gateway/.env.example` 创建权限为 0600 的私有 `.env`，两项公网 URL 都设为同一个 HTTPS origin。`APP_ENV=staging`，`FEISHU_APP_TYPE=self_built`。App Secret 和两个不同的随机 32 字节加密/签名密钥仅填后端。

从仓库根目录执行现有命令：

```sh
docker compose --env-file tools/sync-gateway/.env -f tools/sync-gateway/deploy/compose.yml config --quiet
docker compose --env-file tools/sync-gateway/.env -f tools/sync-gateway/deploy/compose.yml build
docker compose --env-file tools/sync-gateway/.env -f tools/sync-gateway/deploy/compose.yml up -d
```

Caddy 在域名与端口正确时申请并续期 TLS 证书，见 [自动 HTTPS 官方说明](https://caddyserver.com/docs/automatic-https)。数据库与证书使用独立持久卷。详细环境字段、故障检查和在线 SQLite 备份命令已在 [开发者配置](https://github.com/lllwuwu25-alt/zzzzy/blob/codex/android-honor90-test/docs/feishu-sync/developer-setup.md) 给出；不要重复手工创建题库或表格。

验证 `/v1/status` 可通过 HTTPS 访问且配置正确。这仅代表服务启动，**不代表飞书联调通过**。

### 4. 生成同一服务地址的双端测试包

在构建环境配置公开的 `VITE_SYNC_GATEWAY_URL=https://sync.你的域名`；安卓工作流从仓库 Actions Variable `SYNC_GATEWAY_URL` 读取。该值不是秘密。重新构建电脑测试版与 APK；旧安装包不会因服务器上线就自动获得新的编译地址。

电脑测试版沿用现有隔离数据和授权测试机制，不能直接覆盖正式用户程序或清空原题库。当前无服务地址的 APK 先用于本机功能测试。

### 5. 第一轮真机测试

1. 电脑登录你的飞书身份，自动创建专用题库；有旧题时先备份并预览首次合并。
2. 电脑“添加设备”生成绑定二维码。
3. 手机 App 扫码，登录相同飞书身份；返回 App，保持等待确认。
4. 电脑核对并允许这台手机，手机再下载题库和原图。手机先登录不能直接成为首台激活设备。
5. 测试单图/多图/拍照、批注、复习、飞行模式修改后重连、两端同时编辑、软删除和撤销设备。
6. 关闭电脑但保持服务器运行，验证手机可以独立录题、复习和同步。
7. 用第二个获准测试身份检查账号隔离，再演练服务器备份恢复。

每项记录实际结果、错误编号和匿名设备信息，不记录 Secret/Token，也不将“单元测试通过”改记为真实双端通过。

## 成本和维护边界

持续费用主要是服务器、域名续费及流量；题目与原图的云资源归属用户自己的飞书空间，也要留意飞书套餐/API 限额。HTTPS 由现有 Caddy 自动化，不要求另买商业证书套餐。

SQLite 运行中必须使用仓库的在线备份工具，不能只复制主数据库而漏掉 WAL。数据库快照要加密异地保存；加密密钥另存，不能把密钥明文塞进同一个备份包。升级前备份，保留可回退版本，不运行 `docker compose down -v` 删除卷。

## 现在不能承诺的事

- 尚无服务器和域名，所以本次没有真实公网部署、飞书 OAuth 或 HONOR 90 双端验收证据。
- 目前是自建应用、测试租户 allowlist、单实例的 staging 版本。**不能只把环境名改成 production 就向所有购买者开放云同步**；正式跨组织安装、授权生命周期、卸载/撤销、新旧应用迁移及平台审核需要后续实现和验收。
- Android 商业授权与长期发行签名仍未开放；当前独立调试包不应作为售卖包。临时调试签名可能导致后续不能覆盖安装，卸载前必须备份。
- 当前有 20 MiB 云附件、16 KiB 单条版本化业务 JSON 等限制，超限保留本地并报错；大题库压力、原生系统返回/软键盘/相机与 Keystore 生命周期仍需实际测试。
