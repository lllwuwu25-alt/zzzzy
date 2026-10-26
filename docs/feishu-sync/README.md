# 飞书自有云同步（拥有者测试版）

这是现有错题本的功能集成，现位于独立安卓测试分支 `codex/android-honor90-test`，不是另一个演示错题本。不合并 main、不公开发布 Release，也没有替用户注册或部署外部服务。

## 当前边界

- 已接入现有设置、Zustand 保存通道、图片渲染和 React 手机入口。
- 已实现网关配置校验、SQLite 持久化、OAuth、用户身份建库、设备准入、二维码、确认/撤销、令牌刷新和显式恢复流程。
- 已实现稳定 ID 映射、完整迁移前备份、同一次本地提交中的 outbox、图片及编辑数据、增量/快照、修订冲突、墓碑、复习事实和撤销提交组。
- 普通用户只连接飞书，不填写 App ID/Secret/表格链接/长期 Token。部署人员配置后端；客户端只配置公开服务地址。
- **没有真实飞书联调、没有真实双设备/鸿蒙验收、没有外部 HTTPS 部署验证。** 本地测试使用远端接口替身，不能作为这些项目已通过的证明。
- `production` 明确禁用；跨租户安装、管理员安装授权、卸载生命周期和新旧应用迁移不是切换参数即可完成。

## 导航

1. [部署者配置：按顺序创建自建应用、发布权限、部署 HTTPS](developer-setup.md)
2. [普通用户操作](user-guide.md)
3. [真实数据结构及迁移映射](data-mapping.md)
4. [权限与官方接口核实](../feishu-permissions.md)
5. [验收与未执行项目](verification.md)
6. [正式发布阻断清单](production-checklist.md)
7. [没有服务器时的首轮部署方案](first-server-plan.md)

最新范围澄清：用户已确认 HONOR 90、Android 15，批准复用 Tauri 构建 arm64 测试 APK，通过独立分支 GitHub Actions 上传附件，不发布 Release。浏览器适配保留，手机测试主入口改为原生安卓 App。同步网关仍需要在线 HTTPS 服务，APK 并不能代替 OAuth 回调或安全保存 App Secret 的后端。见 [安卓安装与验收](android-test.md)。

## 代码入口

| 模块 | 路径 |
| --- | --- |
| 现有本地事务与同步队列 | `src/store.ts` |
| 共享业务校验、版本与冲突 | `src/sync/protocol.ts`、`model.ts` |
| 同步运行器及客户端 | `src/sync/engine.ts`、`client.ts`、`controller.ts` |
| 设置与移动端准入 | `src/components/sync/` |
| 原生凭据安全存储及 HTTPS 代理 | `src-tauri/src/sync_session.rs`、`sync_policy.rs` |
| 网关及 SQL 迁移 | `tools/sync-gateway/` |
| 单实例部署材料 | `tools/sync-gateway/Dockerfile`、`deploy/`、`.env.example` |

网关 Node 24.13+，使用内置 HTTP/crypto/SQLite，无第三方运行依赖；客户端沿用原项目依赖，新增本地二维码库 `qrcode`。测试详情和命令见验收记录。

## 不得掩盖的限制

1. 普通附件上传上限 20 MiB；分片上传未实现，超过限制明确失败并保留本地原图。
2. 每条版本化业务 JSON 安全上限 16 KiB。超长题目/大量笔迹仍可本地保存，但该任务会明确显示未同步；没有压缩、截断或丢弃内容。销售前需评估将大型编辑模型拆为附件的后续迁移。
3. 创建多维表格或上传素材的结果未知时停止盲目重试，需部署人员核对；目前未提供自动发现/认领未知新建资源的完整修复向导。
4. Android 测试包使用应用私有目录及 Keystore 加密凭据；浏览器/PWA 只是可选入口。不能保证后台常驻同步或原生鸿蒙能力；HONOR 90 安装、现场扫码、相机、键盘、大字体、文件导出仍待真实设备测试。
5. 网关单实例、SQLite 可靠持久盘；不能直接横向扩为多副本。
6. 独立审查工具本次遭遇额度阻断，不能宣称已通过独立安全审计；上线前必须补充审查及真实验收。

上述项目不影响现有不连接飞书时的本地使用，但会阻止将此分支直接作为已完成的公开销售云同步版本。
