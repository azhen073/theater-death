# theater_death 项目规则

《剧院死神》在线法官：13 人 9 身份社交推理游戏的在线裁判系统。服务端拥有真实状态，纯规则引擎 + Socket.IO 实时 + 两种部署（玩家电脑 / 第三方服务器）。

## 必读文档

- `PROGRESS.md` — 进度与交接（compact 后接续工作先读这里）
- `theater_death_rulebook_v1.1.md` — 玩法权威（R-01–R-54，含 S3 裁定第 09 章；默认 1.1 命名预设）
- `docs/rules-v2-full.md` — 规则 2.0 现行合并版（默认入口支持 v2 命名预设，差异见 `docs/rules-v2.md`）
- `theater_death_development_requirements_v1.1.md` — 工程规格（F-01–F-10、测试 T-01–T-50、里程碑 M1–M4）

## 当前进度

- 2026-09-22 公开死亡粒子 + 头像常驻星芒（`feat/public-death-effects`，基线 `b3f5a1e`；**已合并进 main `9b94a65`**，保留贡献提交 `245609e`/`e1ab0f8`）；复用原合图，公开事件驱动，回归撤印，减少动画/关闭特效仍保留文字公告。贡献方增量单测 59/59、相关双浏览器 E2E 56/56、真实整局 chromium 1/1；维护方复核：全量 **90 文件 585 例全过** + `20-death-effects`/`08-display` 双浏览器 24/24。未部署。详情见 `docs/frontend-v2-death-effects-verification.md`。
- 2026-09-22 公开阶段短转场（UI 1/5，`feat/ui-phase-transitions`，基线 `b3f5a1e`；**已合并进 main `b784995`**，保留贡献提交 `b07116e`/`b98b369`）；只读公开昼夜/轮/阶段，入夜「夜幕降临」、天亮「天光初现」、第二阶段「第二阶段开启」播 2.2s 幕布+时钟转场（复用原素材 + CSS，无新依赖）；`sessionStorage` 按 scope/轮/阶段去重，刷新/重连/后台/紧急行动/弹层/减少动画压制或取消且不补播；同批死讯先留 3.2s 窗口再补播（pending 队列，刷新/离线取消）。维护方整合：解 `scene.tsx` 与 #9 的冲突（公告维持 shell 挂载）、同步 spec 到 #9 的公告文案/时长与「公开事件 + 公开座位状态」夹具、素材补 SHA256。复核：全量 **91 文件 590 例全过** + `20-phase-transition`/`20-death-effects`/`08-display`/`19-identity-reveal` 双浏览器 46/46。未部署。详情见 `docs/frontend-v2-phase-transition-verification.md`。
- 2026-09-22 发言聚焦与可选提示音（UI 3/5，`feat/ui-speech-attention`，基线 `b3f5a1e`；**已合并进 main `4bf179a`**，保留贡献提交 `5b0cd61`）；公开发言者金色高亮 + 原素材光环（`aperture.png`，头像圆形裁切不变）+「准备/正在发言」标签；新增「发言与提醒」条替换旧 `speaker-banner` 发言行（天理投票进度行保留），本人准备期突出 15 秒倒计时与「提前开始发言」；提示音默认关闭、点击解锁、仅本页、刷新复位，公开阶段与本人发言各响一次（`sessionStorage` 去重，重复/重连/后台不补响），解锁失败降级文字提醒；不碰麦克风/autoMic/声网/R-43/服务端命令。维护方整合：解 `stage.tsx` 与 #9 的冲突（光环包在 `seat-avatar` 外层，星芒共存）、素材补 SHA256。复核：增量 10 文件 74 例 + 全量 **91 文件 590 例全过** + `22-speech-attention`/`18-voice-levels`/`20-death-effects`/`08-display`/`03-actions` 双浏览器 48/48。未部署。详情见 `docs/frontend-v2-speech-attention-verification.md`。
- 2026-09-22 上警名单与公屏可读性（UI 5/5，`feat/ui-election-chat`，基线 `b3f5a1e`；**已合并进 main `3cf19c9`**，保留贡献提交 `3f0caa7`）；侧栏新增「上警名单」卡（四标签之上常驻可见，报名/退选/重投/结束与当选状态，只用公开候选与公开座位，夜间/复盘不显示）；公屏消息改「N号 · 昵称」+ 字号/行距/历史区高度提升（样式限 `#panel-public`），聊天跟随/未读/分页/草稿逻辑未动。无冲突直接合并。复核：增量 9 文件 67 例 + 全量 **91 文件 590 例全过** + `24-election-chat`/`05-information`/`22-speech-attention`/`20-death-effects`/`08-display` 双浏览器 42/42。未部署。详情见 `docs/frontend-v2-election-chat-verification.md`。
- 2026-09-22 夜间舞台氛围（UI 2/5，`feat/ui-night-atmosphere`，基线 `b3f5a1e`；**已合并进 main `7c426e5`**，保留贡献提交 `589ca64`/`6bf6adb`/`e89f9fe`）；只读公开夜晚状态叠银蓝夜景（原素材光晕 + 暗角 + 雾与 24 粒飘尘），雾/粒子 5 秒后卸载只留静态层，`sessionStorage` 按房间/局/轮去重（刷新/重连不补播），隐藏/离线/离场/减少动画停止；夜间座位与行动卡保持可读；已为 #15 亮度层预留 `--stage-brightness` 与 `:has(> .stage-backdrop)` 兼容。无冲突直接合并；素材补 SHA256。复核：增量 8 文件 64 例 + 全量 **91 文件 590 例全过** + `21-night-atmosphere`/`03-actions`/`22-speech-attention`/`20-death-effects`/`08-display` 双浏览器 50/50。未部署。详情见 `docs/frontend-v2-night-atmosphere-verification.md`。
- 2026-09-22 分阶段身份能力说明（UI 4/5，`feat/ui-phase-identity`，基线 `b3f5a1e`；**已合并进 main `4d58eb0`**，保留贡献提交 `c894d44`）；九身份 × 两阶段规则摘要（带 R 条款与规则版本，标注「不代表此刻可行动，以服务端舞台任务为准」），只挂授权情报面板与「我的身份」弹窗，观众/错配不显示、第二屏标「当前观察视角」；未改目录合同/玩法/权限/服务端。维护方抽查 R-15/18/19/20/21/25/28 与规则书一致（硬编码文案，后续规则变更需同步）。无冲突直接合并。复核：增量 9 文件 65 例 + 全量 **92 文件 602 例全过** + `23-phase-identity`/`05-information`/`19-identity-reveal`/`22-speech-attention`/`08-display` 双浏览器 46/46。未部署。详情见 `docs/frontend-v2-phase-identity-verification.md`。
- 2026-09-22 日间舞台加深与账户亮度设置（`feat/account-stage-brightness`，基线 `b3f5a1e`；**已合并进 main `67648d1`**，保留贡献提交 `6bc4fd9`/`985b9df`）；舞台背景改独立 `stage-backdrop` 层（`z-index:-1` + 舞台 `isolation:isolate`），亮度滤镜只作用于布景层；日间遮罩减弱露出剧院纹理；账户「显示与动画」新增 50–130% 亮度滑杆 + 恢复默认（**局内不出现**），偏好 `stageBrightness` 本地保存（clamp/取整/迁移安全），`--stage-brightness` 挂根元素；与 #13 夜景组合已实测（夜景背景 + 氛围层同值滤镜、单次应用）。无冲突直接合并。复核：增量 9 文件 66 例 + 全量 **92 文件 603 例全过** + `25-stage-brightness`/`08-display`/`21-night-atmosphere`/`03-actions`/`22-speech-attention` 双浏览器 40/40。未部署。详情见 `docs/frontend-v2-stage-brightness.md`。
- 2026-09-22 大厅视口铺满与跨屏缩放适配（`feat/lobby-viewport-fit`，基线 `b3f5a1e`；**已合并进 main `d04125d`**，保留贡献提交 `fadf762`）；仅大厅相位加 `home-layout--lobby`（`max-width:none` + `clamp` 留白，阅读页保留 1280 上限）；满高用 `calc(100svh / var(--display-scale, 1))` 补偿根 zoom；不猜测屏幕/DPR，以浏览器视口为准。无冲突直接合并。复核：增量 10 文件 81 例 + 全量 **92 文件 603 例全过** + `26-lobby-viewport`/`03-actions`/`08-display`/`24-election-chat` 双浏览器 34/34（含 90/100/110% 缩放 × 320–3840 连续 sweeping、chromium CDP DPR 切换）。遗留：真实 Windows 物理双屏拖动未实测（作者已标明，留人工验收）。未部署。详情见 `docs/frontend-v2-lobby-viewport.md`。

- M1 完成：rulesets 默认板 + 验证器、纯引擎（开局/团队确认/夜晚/晨间/胜负）。
- M2 完成：夜间窗口驱动、HTTP 会话/房间/命令/聊天、Socket.IO 实时推送；124 个单测全过 + 容器内实时握手验证。
- M3a 完成：白天引擎（竞选/发言/放逐/遗言/天理移交/结算）与共享阶段转换块。
- M3b 完成：白天驱动（窗口排程/命令）与夜→日→夜循环编排。
- M3c 完成：终局复盘（R-53：全身份/状态/胜负/时间线/含加入前历史的全部交流）。
- M3d 完成：网页前端（React + Vite，同镜像交付）；创建房间 → 13 人开局 → 昼夜循环 → 终局复盘的浏览器全流程实机验收通过。
- M4a 完成：规则收尾（实验模式 API + 大厅横幅 + 落盘、T-50/T-17/T-36 测试补齐）；M4c 完成：部署与运行手册（install/start/stop/update 脚本、RUNBOOK）、大厅退出/解散功能、GitHub（公开）仓库 + Actions 构建发布 ghcr 镜像、服务器部署并经外网域名验证。
- M4b 语音完成（LiveKit：R-43 许可策略、短期凭证与服务端权限同步、前端语音条、compose voice profile、RUNBOOK §7）；**服务器实机双设备验收通过**（修复发布权限竞态：失败自动重试 + 权限事件驱动，Playwright 虚拟麦克风复现验证）。
- 603 个单测全过 / 92 个测试文件（镜像构建含服务端/前端类型检查与 `build:web:v2`；2026-09-22 全量实测，含 v2.0.5-alpha 与 UI 优化批次（死亡特效/转场/发言聚焦/上警名单/夜景氛围/身份说明/舞台亮度））；合并 `origin/main`（`3379726`）后静态清点 **92 文件 / 606 例**（本分支新增用例，未跑全量）；**M4d 完成**：容器化 Playwright E2E（chromium+webkit：全角色流程、语音组、越权、泄漏、恢复、容量）并修复白天驱动崩溃；**M4e 完成**：收官报告 `M4_ACCEPTANCE_REPORT.md`（§15 格式，属 2026-09-16 时点快照）；**观战（需求 v1.2 增补）完成**：绑定玩家只读第二屏（`tests/spectator.test.ts` 7 例 + E2E `07-spectator.spec.ts` 2 例）；**房主踢人（需求 v1.3 增补）完成**：大厅期移出成员/观战者（`tests/server-api.test.ts` 踢人 7 例 + E2E `08-kick.spec.ts` 2 例）；**终局退出（需求 v1.5 增补）完成**：仅终局后可退出（释放席位、房主不解散、空房销毁；对局中仍 409，`tests/server-api.test.ts` +3 例 + E2E `10-end-exit.spec.ts` 2 例）。E2E：v1 入口累计 22 例（chromium 18 + webkit 4，静态清点；2026-09-21 全量实测 **21/21 通过**），v2 入口另有 `e2e/specs-v2/`（**27 个 spec / 86 例**，2026-09-22 合并 `origin/main` 后清点）。**v1.7/v1.8 完成（贡献提案 syhneversigh，阿真确认）**：天理夜死移交时机对齐 + 规则 2.0 命名预设 + 账号体系与 v2 服务端/前端体系准入（`server/v2`、`web-v2`、`contracts/`、`docs/`、`e2e/specs-v2`）；镜像默认入口已切换为新版（`.env` 设 `ENTRY=v1` 可回滚）。**v1.9 完成（贡献提案 kiahir，阿真确认）**：全仓库文档一致性核对（媒体服务残留 / 版本号与计数 / 失效链接 / R-54 正文），无玩法变更。**v2.0.1-beta 完成（贡献提案 kiahir，阿真确认）**：房间解散改为**任意阶段**立即生效（仅房主；对局中终止按 `aborted` 记账）；房主离开语义＝大厅**即解散**、对局中**暂离**、复盘**普通离开**（房间保留、房主由其他在线正式成员继任；非房主一律普通离开）；**大厅里房主的操作只保留「解散房间」**（隐藏等效的「离开房间」）；遗弃房间 **24 小时回收**（v2 按「全员离线」、v1 按「房间无活动」，两入口口径不同因 v1 没有在线状态）。遗留动作：服务器更新镜像并改配声网凭据（`git pull` → `.env` 换 `AGORA_*` → `./deploy/update.sh`）。细化计划见 `PROGRESS.md`。
- 语音关键约束（2026-09-19 起）：服务器语音采用 **声网 Agora 免费层**（App ID / App Certificate 只入 `.env`，不入库；项目须在控制台**开启「连麦鉴权」**发布权限控制才生效——**本项目实测未生效、已接受风险（2026-09-21，见下条）：发布权仅由服务端签发/撤回 + 发布 TTL 150 秒兜底**）；R-43 发布权通过短期 token 实现——加入 = 订阅角色（可听不可发），发言 = 服务端下发发布凭证（TTL **150 秒**：覆盖最长 120 秒发言窗口 + 30 秒缓冲，2026-09-21 由 10 分钟收紧）+ 前端 `renewToken` 即时生效，收回 = 订阅凭证即时降权 + TTL 到期兜底；踢人/关房走频道管理 REST（一次性踢出，可立即重进）。上一代 LiveKit 实现与其残留已清理（`deploy/livekit*.yaml`、`deploy/frontend-local.ps1` 的 `livekit` 服务、各 compose 中的 `LIVEKIT_*` / `VOICE_SERVICE_URL` / `VOICE_ADMIN_URL` 环境变量）；仅 `docs/openapi-v2.2.json` 的 `/voice/webhook`（`livekitSignature`）与 `server/v2/app.ts` 中未被注入的 `verifyWebhook` 路由仍为历史遗留（**未启用**，待定）。
- 关于夜间窗口"无事可做提前结束"的提案已讨论并否决：固定时长是防泄露设计（需求明文），不要重新引入。
- **v2.0.2-alpha 完成（贡献提案 syhneversigh，阿真确认）**：舞台行动 UX 已整合进 main（2026-09-21）：舞台内行动交互与竖屏适配 + 边界修复 + 团队方案“发布并确认本人”单请求原子操作（保留全队逐版确认与固定窗口，R-47 语义不变）。维护方复核后修复环形/文档流判定的竞态（加宽后最多约 1.5 秒滞后且浏览器不一致）并补回归 E2E；未部署。
- **v2.0.2-beta（已完成；贡献 kiahir）**：分支 `2.0.2-beta`（由 `2.0.2-alpha` 改名，基线 `main` 的 `de68a89`，曾推送 `c5df078`，后随分支改名并入 `2.0.3-alpha`）。遗言复核 + R-45 顺序明文（无行为变更）+ `e2e/specs-v2/17-last-words.spec.ts`；账户「显示与动画」F2/F5 修复（`aria-label`、`display-settings` 定点样式）+ 账号页断言；md 审计修 md-1/md-2。实测：遗言 **2/2（两浏览器）**、账户与显示 **8/8**（chromium）。
- **v2.0.3-alpha 完成（贡献 kiahir，阿真确认）**：分支自 `2.0.2-beta` 的 tip（`c5df078`）拉出，并**承接了 `2.0.2-beta` 的远端分支名**（远端已改名 `2.0.3-alpha`）；全部提交已整合进 main（`d669426`）。**局内语音音量显示与调节（A+B + 输出/输入增益）**：自己的 5 段电平、当前发言者「N号 正在发言 · X%」（输出静音时显示「已静音」但保留"谁在发言"）、输出音量 0–100 + 一键静音、麦克风增益 0–150（>125 关闭 AGC 并重建采集轨道，重开麦/换设备自动重应用）；纯本地偏好（`localStorage`），受 R-43 时段门控、不上报服务端。维护方复核修复 `08-display.spec.ts` 两处漏更新断言（偏好键集合漏 4 个语音字段、裸 `getByRole('checkbox')` 在新增复选框后 strict 冲突）。实测：全量 88 文件 568 例全过、4 个 typecheck 与双前端构建通过（镜像构建）、`18-voice-levels` 与 `17-last-words` 双浏览器各 2/2、`01-account`+`08-display` chromium 8/8、`08-display` webkit 6/6。未覆盖/未实现：真实媒体需声网凭据未验、座位卡电平环与每玩家音量未做。遗留：F1/F3/F4、P1/P2、`lastWords.firstNight`/`otherNights` 死配置。
- **v2.0.4-alpha 完成（竞选投票资格修正 + 夜间公开时钟 + 死神知识呈现 + 语音自动化；阿真确认）**：分支 `2.0.4-alpha`（基线 `3980344`；全部提交已整合进 main，tip `f2005ec`）。**规则变更 R-42**：候选与平票重投的平票者不得投票、无投票人（如全员报名）时本局无天理、退选者在投票开始前退选即恢复投票权；同步 1.1 规则书 + `docs/rules-v2-full.md` + `docs/rules-v2.md`（V2-02）+ 规则目录夹具；引擎新增 `electionVoters`/`electionVoterCount` 与 `vote_forbidden_candidate`，服务端竞选满员判定与 `eligibleCount` 同步（放逐路径不变）。**夜间公开时钟**：`public.night.closesAt` 只给当前夜间段截止（段1=协商、段2=查验、回归段=回归；不含段名/段数），HUD 在无公开窗口时回落显示。**死神知识**：`private.knowledge.spiritSeats`（死神/丧亲者→魂灵，魂灵→其他魂灵，其余空）+ 座位卡「魂灵」私有徽标 + 身份弹窗「已知身份」区块。**语音自动化**：进对局自动加入语音（手动离开后本局不再自动重连；观战/第二屏仍手动旁听）+ 新偏好 `autoMic`（默认开）轮到自己自动开麦（每发言窗口一次、手动关麦不重开）+ `START_SPEECH` 文案改「提前开始发言」。本地验证：全量 **88 文件 572 例全过** + 4 typecheck + `build:web:v2` + 契约夹具重导出 + E2E（03/04/05/08/09/17/18 双浏览器、11 chromium、01 chromium 全过；12 仅 AC09/AC19 既有失败；v1 受影响路径 `04-flow-full` 双浏览器 4/4 与 `03-security`/`07-spectator`/`10-end-exit` 6/6）。未部署。
- **v2.0.5-alpha 完成（贡献 syhneversigh，阿真确认；已合并进 main `8ea46ca`，保留贡献提交 `7d4a40a`）**：正式玩家每局首次入场自动展示一次身份卡；`sessionStorage` 按房间/局/玩家去重；观战、第二屏、复盘排除；10 秒内行动优先。当前静态口径为 Vitest **577 例 / 89 文件**（贡献方记 576 漏算选择器用例，维护方全量复核 **89 文件 577 例全过**）、v2 E2E **19 个 spec / 55 例**。GPT-5.6-Luna 独立验证：focused Vitest 15/15、两个前端 typecheck、`build:web:v2`、新增 `19-identity-reveal` 双浏览器 6/6、既有 03/05/08 双浏览器 38/38、真实开局 04 与 09 chromium 各 1/1、02 正式房间 1/1。02 实验房间仍有既有 presence `offline`/`reconnecting` 断言失败，与本需求无关。未跑 E2E 全量，未部署。
- 构建/测试命令：`docker compose -f deploy/docker-compose.yml build`（构建即跑全部测试）。
- **v2.0.6-alpha（进行中，贡献 kiahir；原分支 `2.0.4-beta` 于 2026-09-22 改名）**：分支自 `main` 的 `9c86a90` 拉出（版本名 = 分支名），并**已合并 `origin/main` 的 `3379726`**（v2.0.5-alpha 开局身份揭示 + UI 优化批次 PR #9–#16）。声网语音审计后的**可靠性收口**（无玩法/契约字段变更）：① `server/v2/media.ts` 踢出改为**成功后才删身份映射**（失败留给下一次 `sync` 重试，逐身份捕获失败，`required` 时抛错映射 `/voice/sync` 503），`enqueue` 队列链**永不 reject**（修掉「`required` 失败后下一次入队的 work 被跳过」）；② `voice/agora.ts` 频道管理 REST 加 `AbortSignal.timeout`（15s）+ 5xx/超时/网络错误退避重试（3 次尝试，250ms→1s），4xx 不重试；③ 发布凭证 TTL **600s → 150s**（最长发言窗口 120s + 30s 缓冲；加入凭证仍 1800s，不影响收听）——「撤销强度」取方案①，方案②（失去发布权即踢 uid）待定案；④ 客户端（v2 `session.ts`/`bar.tsx` + v1 `voice.tsx`）补 `token-privilege-will-expire`/`did-expire`（过期前续期 / 过期后重连并恢复开麦）、autoMic 只在 `connected` 才记窗口键、重连期间开麦按钮禁用 +「重连中…」、`#stopTask` 串行化（关麦立刻重开不双发）、uid 归属与 `exception` 提示、离开复位 `onAutoplayFailed`、设备选择会话内保留。**实测**：后端增量 5 文件 40 例 + 客户端 2 文件 19 例全过；四个 typecheck 与 E2E `18-voice-levels`（双浏览器 3/3）通过；stash 旧实现对照 **2 / 6 / 1 failed**；**真机 `16-voice` 1 passed（12.3s，接收方远端电平 35–42%）**；静态清点（合并前基线 `9c86a90`）88 文件 584 例、v2 E2E 18 spec / 53 例；**合并 `origin/main` 后**静态清点 92 文件 / 606 例、v2 E2E **27 spec / 86 例**。**未跑全量**；未验：增益/AGC 听感；**已决定不验（用户决定 2026-09-21）**：踢人/关房真实 REST 与 v1 `02-voice`（均需控制台「客户 ID/密钥」，不再引入）。**已知风险（已接受，用户决定 2026-09-21）**：实测并复测本项目**「连麦鉴权」未生效** → 订阅 token 在 rtc 与 live 下都能发麦、20s 的 `pubAudio` 过期后仍能发麦，即声网侧不强制；缓解 = 服务端签发/撤回（依赖客户端 `renewToken`）+ 发布 TTL 150 秒上限；将来若要强保证，可启用该功能或改用方案②（失去发布权即踢 uid）。仍余 1 条未做：v1 无自动重连且 uid = 座位号（多标签页 `UID_CONFLICT`）。审计另发现 9 项未处理（openapi 的 voice/token 仍是 LiveKit 形态、v2 缺凭据崩溃而非降级、`compose.v2.release.yml` 不注入 `AGORA_*`、install 漏客户密钥、`AGORA_REST_BASE_URL` 未接通、v1 不回收玩家媒体、文档过期、token 角色/权限位无断言、首次安装 `NODE_ENV` 相冲），见需求文档文末 v2.0.6-alpha 一节。

## 裁定状态

- Q-01–Q-08 已全量定值（规则书第 09 章），不得用传统狼人杀惯例改写；发现新边界问题重新开号并走版本记录。
- 玩法规则、实现约定、实验默认值必须明确分开；实验模式配置必须在大厅醒目提示，不得冒充正式功能。
- 房主是**房间管理角色**（不是玩法角色）：继任/移交只看「正式成员 + 在线且有连接 + 会话有效」，**不限游戏内生死**——已出局的正式成员同样可以继任房主，因此也能解散房间 / 踢人 / 移交。该行为经阿真确认保留，**不要重新引入"死者不接任"**。无人在线时房主为空、房主类按钮全部隐藏。

## Docker 约束（阿真要求，2026-09-16）

- 全部构筑与运行在 Docker 容器内完成，与宿主机真实环境隔离，保证可迁移。
- 开发、测试、生产共用同一镜像；宿主机不承担运行时依赖（除 Docker 本身）。
- 数据目录、端口、会话秘密、媒体配置通过 compose 与 `.env` 注入；镜像内不含真实密钥。
- 交付物包含 Dockerfile、compose 编排与基础镜像版本锁定。

## 协作约束

- 先写纯规则和获批准的预期测试，再接网络与界面。
- 客户端只能提交意图，身份由服务端会话解析，不能信任载荷自报。
- 公共状态、个人历史、阵营历史都必须先授权后发送；不能先发全量再用页面隐藏。
- 同一角色的多个连接不能增加行动或票数。
- 只做公共白天语音；夜间全体静音且公屏禁发；死者阵营房只读。
- 一套程序支持电脑和第三方托管，不复制规则引擎。
- 不擅自扩充服务器灾难恢复、录音、公开匹配和管理员改判。
- 所有规则改动须更新条款引用、测试及版本记录。
- 报告真实执行命令与结果；未运行、未覆盖必须标明。
- 不能修改正确测试预期来掩盖实现不符合规则。
- **未经明确指令，不得 push 到 GitHub 远端仓库**（含 `origin` / `fork`，以及新建、改名、删除远端分支或开 PR）。本地 `commit` 可以照常做；`git fetch` 等只读远端操作不受限制。

## 测试策略（阿真要求，2026-09-17）

- **默认只跑增量测试**：改动后只跑相关单测文件（`npx vitest run tests/xxx.test.ts`）与相关 E2E spec（`npx playwright test specs/0x-xxx.spec.ts`）。
- **全量回归（全部单测 + 全量 E2E）只在阿真明确要求时运行**；不要"顺手"跑全量，测试慢、等待成本高。
- 例外：构建 app 镜像时 Docker 构建链内部会跑全部单测（构建必要部分，不算违规）；纯文档/只读研究不必跑测试。
- 汇报时要如实写明跑了哪些、没跑哪些。
