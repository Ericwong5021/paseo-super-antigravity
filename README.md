# Super Antigravity

Paseo 的增强版 Antigravity (`agy`) 插件：在保留原生 `antigravity-cli`（ACP/NDJSON、思考深度、Skills、Slash Commands、`ask_question`、MCP 共享与原生子 Agent 标签页）的基础上，集成 **Antigravity Tools** 账号联动、运行时风控冷却、自动轮换以及侧边栏 5h 配额胶囊与速览弹窗。

- 上游 Provider 基础：[lefos13/paseo-plugin-antigravity-cli](https://github.com/lefos13/paseo-plugin-antigravity-cli) (MIT)
- 外部状态/网关联动：[Antigravity Tools](https://github.com/lbjlaq/Antigravity-Manager)（零源码复用，见 [`NOTICE.md`](./NOTICE.md)）
- 使用独立 Provider ID `antigravity-super`，可与 Paseo 内置 `antigravity` 及 `antigravity-cli` 并存

## 界面结构

- **侧边栏单入口 + 5h 配额胶囊**：默认展示聚合后的 Gemini 5h 剩余百分比（低于 20% 标红），点击胶囊弹出配额速览卡片（含隐私打码、重置倒计时、快捷切换与解封）。
- **主界面（三标签页）**：
  - **账号**：整体剩余额度概览、Antigravity Tools 账号池一键切换/解除冷却、本地 `agy` 隔离账号配额与登录设置。速览弹窗顶部固定显示「本机 agy 正在使用」的那一行（真实 home 配额与登录邮箱），账号池里同邮箱的行才是「当前」；Tools 指针与实际登录不一致时会标黄提示，切换后会用一次 `/usage` 探针确认是否真的切过去了。
  - **冷却**：运行时 429/限流/配额耗尽冷却策略、新会话自动轮换阈值、Antigravity Tools 网关端口与同步。
  - **胶囊**：侧边栏胶囊展示指标、样式、配色、低额度提醒与默认打码开关（含实时预览）。

## 审批模式与消息撤回

- Provider 图标使用 Gemini 四芒星。Default、Accept edits、Auto、Plan 各用不同盾牌图标，插件定义相应权限配色（Auto 为橙色），但当前 Paseo 客户端没有使用这些配色，因此仍显示原有颜色；本插件不修改客户端。Auto 会询问不可逆操作，独立的「Skip all permissions」才会跳过全部工具审批。
- **Full access** 与 Paseo 内置 Antigravity 的同名模式一致，使用 `ShieldOff` 图标并标记为无人值守模式，跳过文件编辑、Shell 命令等全部工具审批。默认 ACP 驱动通过实时审批处理器自动放行，选择后立即处理等待中的审批；切回其他模式立即恢复审批。它与原有 Tool approval 设置同步。NDJSON 与结构化输出回合使用 `--dangerously-skip-permissions`；`full-access` 是 Paseo 模式，不会作为无效的 `--mode full-access` 传给 agy。新会话仍默认使用 Default，可在模式菜单选择 Full access。
- 默认 ACP 驱动通过 `session/set_mode` 在当前会话切换模式；Tool approval 由实时权限处理器执行，收紧或放宽均无需新建对话。已经获准执行的工具不会被倒退取消。旧 NDJSON 驱动的启动参数在下一条消息时更新。
- ACP 支持 Paseo 原生的「撤回对话」入口。插件在新用户回合开始前保存 SQLite 会话和时间线检查点；撤回时先关闭 CLI，恢复模型上下文和时间线。第一条消息的撤回会让后续消息启动新的原生会话，原会话仍保留。
- 仅能撤回更新后记录了检查点的持久化回合；运行中、后台任务未结束、回合中途追加的 steering 消息及旧 NDJSON 会话不支持。撤回仅影响对话，已经改动的项目文件保留。
- 检查点位于 `$PASEO_HOME/plugin-data/antigravity-super/rewind/`；撤回前的数据库、原生日志和时间线保存在相应检查点的 `withdrawn-*` 文件中，便于人工恢复。检查点包含对话内容，随回合数增加占用本地磁盘。

## 本地开发与检查

```bash
npm install
npm run typecheck
npm test
paseo plugin add /absolute/path/to/plugins/super-antigravity
paseo plugin reload super-antigravity
paseo plugin logs super-antigravity
```

## Provider ID

| id | label | driver |
| --- | --- | --- |
| `antigravity-super` | Antigravity (Super) | this plugin |

插件数据目录：`$PASEO_HOME/plugin-data/antigravity-super/`
