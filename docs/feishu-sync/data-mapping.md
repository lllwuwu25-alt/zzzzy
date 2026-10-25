# P0 检查、数据映射与兼容迁移

检查日期：2026-10-25。基线 `c22bd33b5ca6f4247cf9ff0449507ae2278057b2`，功能分支 `codex/feishu-sync-v1`。仓库内未发现适用于本项目的额外 AGENTS.md。

## 真实现状

- React 19 / TypeScript 5.9 / Vite 7 / Zustand 5；Tauri 2 + Rust。
- `Notebook.version=1`，桌面保存为应用数据目录 `notebook.json`，另可绑定可见工作区。网页版 IndexedDB 的 `notebooks/current` 保存完整 JSON，保留旧 localStorage 只作恢复来源。
- 原有五页：今日复习、收集箱、全部错题、复习记录、设置。没有原有云身份、后端或手机版产品。
- 科目目录为考试 → 科目 → 章节的嵌套名称结构；题型有选择、填空、简答。结构化选项、答案、题图区域和 AI 识别来源均已存在。
- 图片原图为 `dataUrl`；编辑模型 v2 保存原图像素坐标批注、旋转、裁剪、尺寸，渲染时变换，不压平覆盖原图。旧模型仍由现有 `migrateImage` 兼容。
- `src/lib/fsrs.ts` 是项目自有的稳定度/难度简化调度：遗忘率估计、四档权重、自定义天数；**不是官方 FSRS 包**。本次不改变权重、到期规则或掌握状态。
- 旧复习记录已保存 `before/after`、作答、评分、耗时。原有备份导出包含全部题目图片与元数据。
- 既有离线销售授权在原生层继续执行；飞书登录不是桌面激活的替代品。

## 为什么没有先整体换 SQLite

需求允许复用真实已有持久层。桌面原子 JSON / 网页单条 IndexedDB 写入均可把题库和 outbox 一起持久化，改动集中在现有序列化提交通道；避免在平台可行性尚未实测时替换整套本地数据库。网关新建的协调数据库使用 SQLite WAL、FULL synchronous、事务及 SQL 迁移。未来迁移客户端 SQLite 必须另有完整备份/中断恢复演练。

## 字段映射

| 本地 | 云端 | 保留规则 |
| --- | --- | --- |
| `Mistake.id` | `Questions.id` 独立 UUID | `sync.idMap['question:本地ID']` 稳定映射；不改旧本地 ID |
| question/answer/choice/fillBlank/shortAnswer | Questions 版本化 payload | 题干、选项 ID、答案等原样校验保留 |
| exam/subject/chapter/tags/cause/note/recognition/diagrams | Questions payload | 题图区域仍引用原图片本地 ID，跨端保持映射 |
| status/deletedAt | 状态及墓碑 | inbox/ready/trashed 不重解释，恢复提交新 revision |
| schedule | Questions payload | due/stability/difficulty/reps/lapses/lastReview 原样保存 |
| `ImageAsset.id` | Assets UUID + localImageId | 本地图片 ID 不改；资产编辑/排序变化创建新资产版本 |
| dataUrl | Assets 附件原始字节 | 不写题目 payload、不上传本地路径或 blob URL；SHA-256 校验 |
| rotation/crop/annotations/editorVersion/source尺寸 | Assets payload | 画笔、高亮、文字、箭头、形状、遮挡与原始坐标完整保留 |
| Review | ReviewEvents | 每次独立 UUID、deviceId、before/after、评分、作答、耗时、算法版本 |
| 原考试层级 | Collections | 每层独立实体，parentId/order/localKey 保留层级和排序 |
| reviewSettings | LibraryConfig 的学习设置记录 | 仅白名单；内置初始化标记禁止客户端覆盖 |

云记录另有 library_id、schema_version、revision、last_mutation_id、content_hash、UTC 时间及物理 record_id 映射。网关不把 record_id 当业务 ID。

**不上传：** 工作区路径/名称配置、AI API Key、飞书 Token、产品会话、设备授权文件、保险库、主题、侧栏状态、缓存目录、其他账号的本机归档。网关长期只保存身份/加密凭证/版本/哈希/映射/变更索引及任务阶段，不另外长期保存正文或图片副本。

## 首次迁移与账号空间

1. 先显示本机、云端题目及本机图片数量，用户确认非破坏性合并。
2. 在首次保存同步状态前自动创建完整独立备份：桌面 `应用数据目录/sync-backups/before-cloud-<hash>.json`；网页 IndexedDB 的 `before-cloud:<时间>:<UUID>` 记录。
3. 原记录不换号，生成稳定云 UUID 映射，与初始 outbox 同一提交保存。失败则不激活同步状态；不会显示假成功。
4. 先下载快照、对齐已知未发送的学习配置和目录逻辑 ID，再上传本机新增资料。没有按相同题干/相似图片自动去重。
5. 账号/题库/环境不同则阻止同步。显式切换时先备份，原空间含未上传队列完整写入 `localSyncSpaces`，当前空间切到新身份自己的副本；没有旧空间则为空库。工作区路径随各自空间保留，不能把 B 写进 A 的绑定文件夹。
6. 当前空间和归档在同一个本地原子提交中更换；失败保留原状态。普通导出仅当前空间业务数据，不意外导出其他账号空间或会话。

## 同步与冲突

- 本地业务修改与 outbox 同一次提交；输入 2 秒后发送。正在发送先持久化 inflight，未知结果重启后用原操作 ID 校对，不改写该操作。
- 每个实体按 base_revision 排队；旧 ack 只确认对应操作，不清空后来的修改。
- 请求携带账号/题库/环境断言，服务端在当前会话派生的归属下核对，防止切换登录后旧队列被路由到另一账号。该断言不替代授权。
- 图片先完成附件与资产记录，题目最后发布引用，旧资产不覆盖。客户端可按需下载原图或下载整套图片；下载再次核对 SHA-256。
- 全量使用持久高水位和分页成员索引，再回放该游标后变化；epoch 不同要求非破坏性重建，不因快照缺行清空本机。
- 同时离线复习保留两条事实。调度前后状态存在分歧时提示 schedule-divergence 冲突，**不凭客户端时间自动重算并假称算法等价**。
- 撤销评分保留原事件的事实墓碑，发布恢复到 before 的派生调度；网关保存提交组阶段，不能只成功一半就完结。
- 同步启用时禁用旧的 30 天物理清理入口；墓碑、原图和复习事实本版不自动物理删除。

## 恢复与回退

原版 v1 题库可读取新增可选字段；不启用云同步时不迁移业务 ID。回退到旧程序前应导出当前空间完整普通备份，并另留整个应用数据目录副本；旧程序不会维护新同步队列，回到新版必须重新核对，不能把旧程序的保存当作已同步。

网页的同步前备份可通过设置导出后再用原有“从备份恢复”校验导入。浏览器存储损坏时，应先复制/保留浏览器个人数据，不能清空站点后再指望找回未上传修改。网关数据库与加密密钥按部署指南分别备份；只复制数据库文件而漏掉 WAL/密钥不等于可恢复备份。
