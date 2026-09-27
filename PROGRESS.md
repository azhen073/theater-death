# theater_death 进度与交接

更新时间：2026-09-22 · 供上下文压缩（compact）后接续工作使用

## 当前状态

2026-09-22 公开死亡粒子与头像常驻星芒：`feat/public-death-effects`（基线 `b3f5a1e`；**已合并进 main `9b94a65`**，保留贡献提交 `245609e`/`e1ab0f8`）新增公开死亡座位粒子与头像常驻星芒；纯前端、无新依赖或位图，保留私密边界/回归/重连基线，末次死亡公告可跨到复盘。贡献方相关增量单测 7 文件 59/59、两项前端类型检查及构建通过、相关 Chromium/WebKit E2E 56/56、真实 13 人整局 chromium 1/1；维护方复核：全量 **90 文件 585 例全过** + `20-death-effects`/`08-display` 双浏览器 24/24。未部署。命令和边界见 [死亡视觉验收记录](docs/frontend-v2-death-effects-verification.md)。

2026-09-22 公开阶段短转场（UI 1/5）：`feat/ui-phase-transitions`（基线 `b3f5a1e`；**已合并进 main `b784995`**，保留贡献提交 `b07116e`/`b98b369`）按公开昼夜/轮/阶段播 2.2s 幕布+时钟转场，去重/压制/取消规则见 [阶段转场验收记录](docs/frontend-v2-phase-transition-verification.md)。维护方整合：解 `scene.tsx` 与 #9 的冲突（公告维持 shell 挂载）、同步 spec 到 #9 的公告文案/时长与「公开事件 + 公开座位状态」夹具、素材补 SHA256。复核：全量 **91 文件 590 例全过** + `20-phase-transition`/`20-death-effects`/`08-display`/`19-identity-reveal` 双浏览器 46/46。未部署。

2026-09-22 发言聚焦与可选提示音（UI 3/5）：`feat/ui-speech-attention`（基线 `b3f5a1e`；**已合并进 main `4bf179a`**，保留贡献提交 `5b0cd61`）新增发言者光环/标签与「发言与提醒」条（替换旧 `speaker-banner` 发言行）、本人准备倒计时与提前开始、可选提示音（默认关闭/本页/去重不补响/失败降级），不碰语音权限链路。维护方整合：解 `stage.tsx` 与 #9 的冲突（光环包在 `seat-avatar` 外层）、素材补 SHA256。复核：增量 10 文件 74 例 + 全量 **91 文件 590 例全过** + `22-speech-attention`/`18-voice-levels`/`20-death-effects`/`08-display`/`03-actions` 双浏览器 48/48。未部署。详情见 [发言聚焦验收记录](docs/frontend-v2-speech-attention-verification.md)。

2026-09-22 上警名单与公屏可读性（UI 5/5）：`feat/ui-election-chat`（基线 `b3f5a1e`；**已合并进 main `3cf19c9`**，保留贡献提交 `3f0caa7`）侧栏新增常驻「上警名单」卡（只用公开候选/座位，夜间与复盘不显示），公屏消息加「N号 · 昵称」并提升字号/行距/历史区高度（样式限 `#panel-public`），聊天跟随/未读/分页/草稿逻辑未动；无冲突直接合并。复核：增量 9 文件 67 例 + 全量 **91 文件 590 例全过** + `24-election-chat`/`05-information`/`22-speech-attention`/`20-death-effects`/`08-display` 双浏览器 42/42。未部署。详情见 [上警名单验收记录](docs/frontend-v2-election-chat-verification.md)。

2026-09-22 夜间舞台氛围（UI 2/5）：`feat/ui-night-atmosphere`（基线 `b3f5a1e`；**已合并进 main `7c426e5`**，保留贡献提交 `589ca64`/`6bf6adb`/`e89f9fe`）只读公开夜晚状态叠银蓝夜景（光晕/暗角/雾 + 24 粒飘尘，5 秒后卸载只留静态层），按房间/局/轮去重不补播，隐藏/离线/离场/减少动画停止；已预留 #15 亮度层兼容（`--stage-brightness`、`:has(> .stage-backdrop)`）。无冲突直接合并；素材补 SHA256。复核：增量 8 文件 64 例 + 全量 **91 文件 590 例全过** + `21-night-atmosphere`/`03-actions`/`22-speech-attention`/`20-death-effects`/`08-display` 双浏览器 50/50。未部署。详情见 [夜景验收记录](docs/frontend-v2-night-atmosphere-verification.md)。

2026-09-22 分阶段身份能力说明（UI 4/5）：`feat/ui-phase-identity`（基线 `b3f5a1e`；**已合并进 main `4d58eb0`**，保留贡献提交 `c894d44`）九身份 × 两阶段规则摘要（带 R 条款与规则版本，标注以服务端舞台任务为准），只挂授权情报面板与「我的身份」弹窗；维护方抽查 R-15/18/19/20/21/25/28 与规则书一致（硬编码文案，规则变更需同步）。无冲突直接合并。复核：增量 9 文件 65 例 + 全量 **92 文件 602 例全过** + `23-phase-identity`/`05-information`/`19-identity-reveal`/`22-speech-attention`/`08-display` 双浏览器 46/46。未部署。详情见 [身份能力说明验收记录](docs/frontend-v2-phase-identity-verification.md)。

2026-09-22 日间舞台加深与账户亮度设置：`feat/account-stage-brightness`（基线 `b3f5a1e`；**已合并进 main `67648d1`**，保留贡献提交 `6bc4fd9`/`985b9df`）舞台背景改独立 `stage-backdrop` 层（亮度滤镜只作用布景，头像/文字/行动卡不受影响），日间遮罩减弱露出剧院纹理，账户新增 50–130% 亮度滑杆 + 恢复默认（局内不出现，偏好 `stageBrightness` 本地保存/夹取/迁移安全）。无冲突直接合并；与 #13 夜景组合在合并树实测（夜景背景 + 氛围层同值滤镜、单次应用）。复核：增量 9 文件 66 例 + 全量 **92 文件 603 例全过** + `25-stage-brightness`/`08-display`/`21-night-atmosphere`/`03-actions`/`22-speech-attention` 双浏览器 40/40。未部署。详情见 [舞台亮度验收记录](docs/frontend-v2-stage-brightness.md)。

2026-09-22 大厅视口铺满与跨屏缩放适配：`feat/lobby-viewport-fit`（基线 `b3f5a1e`；**已合并进 main `d04125d`**，保留贡献提交 `fadf762`）仅大厅相位 `max-width:none` + `clamp` 留白（阅读页保留 1280 上限），满高用 `calc(100svh / var(--display-scale, 1))` 补偿根 zoom，不猜测屏幕/DPR。无冲突直接合并。复核：增量 10 文件 81 例 + 全量 **92 文件 603 例全过** + `26-lobby-viewport`/`03-actions`/`08-display`/`24-election-chat` 双浏览器 34/34。遗留：真实 Windows 物理双屏拖动未实测（作者已标明，留人工验收）。未部署。详情见 [大厅视口验收记录](docs/frontend-v2-lobby-viewport.md)。至此 UI 优化批次（#9–#16，8 个 PR）全部整合进 main。

| 里程碑 | 状态 | 说明 |
| --- | --- | --- |
| 文档 | ✅ | 规则书 v1.1（含 2026-09-19 追加：Q-09 移交时机 + 规则 2.0 命名预设；合并版见 `docs/rules-v2-full.md`）+ 需求文档 **v2.0.5-alpha**，Q-01–Q-08 全量定值（规则书第 09 章） |
| M1 规则与数据 | ✅ | 纯规则引擎 + 默认板配置 + 验证器；74 个单测容器内全过 |
| M2 文字闭环 | ✅ | M2a 引擎补全 + visibility · M2b 夜间窗口驱动 + HTTP 会话/命令 · M2c Socket.IO 实时推送；124 测试全过 + 容器内实时握手验证 |
| M3 白天与复盘前端 | ✅ | M3a 引擎 + M3b 驱动编排 + M3c 复盘 + M3d 网页前端；158 测试 + 浏览器全流程实机验收 |
| M4 语音与部署 | ✅ | **全部完成**：M4a 规则收尾 · M4b 语音（发布竞态修复 + 服务器实机双设备验收）· M4c 部署（服务器上线 + Tunnel + CI 镜像 + 退出/解散）· M4d E2E 验收（14/14，含容量；发现并修复白天驱动崩溃）· **M4e 收官报告**（`M4_ACCEPTANCE_REPORT.md`，§15 格式） |
| 观战（v1.2 增补） | ✅ | 绑定玩家只读第二屏：入口选择目标、只读大厅/对局、语音旁听、终局复盘同权；194 单测 + E2E 16/16 |
| 房主踢人（v1.3 增补） | ✅ | 大厅期移出成员（清位、可重进）、移出观战者（不限阶段、连带语音参与者移除）；204 单测 + E2E 18/18 |
| 板子编辑器（v1.4 增补） | ✅ | 入口页「自定义板子…」：只改角色数量、实时校验（复用服务端校验器）、强制实验模式；204 单测 + E2E 09 增量通过 |
| 终局退出（v1.5 增补） | ✅ | 仅终局后可退出：释放席位、房主不解散、空房销毁；对局中仍 409；`tests/server-api.test.ts` +3 例 + E2E `10-end-exit.spec.ts` 2 例 |
| 文档一致性整理（v1.9） | ✅ | 全仓库 24 个 md 逐项核对：清理 LiveKit 残留（脚本 / compose / 文档）、修正版本号与单测计数、修复失效链接、同步 R-54 正文；**无玩法变更** |
| 解散与遗弃回收（v2.0.1-beta） | ✅ | 解散改为**任意阶段**立即生效（仅房主；对局中终止按 `aborted` 记账）；房主离开＝大厅**即解散**、对局中**暂离**、复盘**普通离开**（房主继任）；**大厅房主操作只保留「解散房间」**；遗弃房间 **24 小时回收**（v2 全员离线 / v1 房间无活动）；`tests/room-governance`、`empty-rooms`、`v2-maintenance`、`server-api`(+3)、`room-operation-api` 相应更新；新增 E2E `specs/11-dissolve.spec.ts`（v1 解散）与 `specs-v2/02-rooms.spec.ts` 的「房主大厅退出=解散」；`empty-rooms` 增加 `forget` 兜底用例、`frontend-v2-room-model` 增加 `hostExitDissolves` 用例；全量 84 文件 527 例 |
| 语音媒体服务（声网替换） | ✅ | LiveKit（Cloud 跨境连接慢）→ **声网 Agora 免费层**：服务端签发短期 token（订阅/发布/降权）、前端换 `agora-rtc-sdk-ng`、踢人走频道管理 REST；**2026-09-19 真实云联调与 E2E 语音 3 例全过**；服务器更新待执行（见接续指引） |
| PR#3 选定移植（贡献提案 syhneversigh） | ✅ | A 组（公开知识泄露修复 + 目标/能力查询 + 加固模块）`4688b49`；B 组（天理夜死移交时机对齐 + 规则 2.0 命名预设）`4d0d71e`；D 组（账号 / v2 房间模型 / 服务端 v2 / web-v2 / 契约）本批完成（v2 语音改造为声网） |
| 舞台行动 UX（v2.0.2-alpha，PR #5，贡献 syhneversigh） | ✅ | PR #5 全部 4 个提交已整合进 main（`b085f1b`）：舞台内行动交互与竖屏适配、边界修复、`EDIT_PROPOSAL` 原子“发布并确认本人”（版本冲突/幂等/旧服务端回退，R-47 语义不变）。维护方复核修复环形/文档流判定的竞态（加宽后最多约 1.5 秒滞后且浏览器不一致）并补回归 E2E；全量 87 文件 556 单测、双浏览器 E2E 与类型构建通过。未部署。 |
| 2.0.2-beta（遗言 + 账户显示设置 + 文档审计，贡献 kiahir） | ✅ | **遗言**：R-41/R-45/R-46、V2-01/V2-02 复核一致；G5 把「同日多名出局者按座位号升序、每人 60 秒」写入规则书 R-45 与 `docs/rules-v2-full.md`（无行为变更）；G4 新增 `e2e/specs-v2/17-last-words.spec.ts`——**2/2（chromium + webkit）实测通过**。**显示与动画**：三设置核对通过；F2「死亡特效」补 `aria-label` 并收紧 E2E 定位；F5 + 字号统一（三标签 14px、帮助 12px、行距 18px，定点不改全局）；`01-account` 补账号页断言与截图——**8/8 实测通过**。**md 审计**：25 个受控 md、链接 0 失效、计数实测无误，修 md-1/md-2。分支 `2.0.2-beta`（`c5df078`）随后**改名为 `2.0.3-alpha`**（内容保留）；未决：F1/F3/F4、`lastWords.firstNight`/`otherNights` 死配置、麦克风仅单测覆盖 |
| 2.0.3-alpha（局内语音音量显示与调节，贡献 kiahir） | ✅ | 全部提交已整合进 main（`d669426`）。**已实现 A+B + 输出/输入增益**：自己的 5 段电平、当前发言者「N号 正在发言 · X%」（静音时「已静音」但保留"谁在发言"）、输出音量 0–100 + 一键静音、**麦克风增益 0–150（>125 关闭 AGC，跨阈值时重建采集轨道）**（重开麦/换设备自动重应用）；纯本地偏好（`localStorage` 四字段），受 R-43 时段门控。维护方复核修复 `08-display.spec.ts` 两处漏更新断言（偏好键集合漏 4 个语音字段、裸 `getByRole('checkbox')` strict 冲突）。**实测：全量 88 文件 568 例全过 + 4 个 typecheck 与双前端构建（镜像构建）+ `18-voice-levels`/`17-last-words` 双浏览器各 2/2 + `01-account`+`08-display` chromium 8/8 + `08-display` webkit 6/6**。未覆盖：真实媒体（需声网凭据）未验；未实现：座位卡电平环、每玩家音量、无电平提示；待核：声网音量 API 名称与本地 `setVolume` 的实际上限（150 是否真放大）。遗留仍在：F1/F3/F4、P1/P2 |
| 2.0.4-alpha（竞选投票资格修正 + 夜间公开时钟 + 死神知识呈现 + 语音自动化） | ✅ | **规则变更（R-42）**：候选与平票者不得投票、无投票人时无天理、退选恢复投票权；同步规则书/合并版/目录夹具/引擎/服务端/测试/E2E 驱动（`11-special-actions` 平票驱动改为非候选投票）。**夜间公开时钟**：`public.night.closesAt`（只给当前段截止，不显示段名）。**死神知识**：`private.knowledge.spiritSeats` + 座位卡「魂灵」徽标 + 身份弹窗「已知身份」。**语音自动化**：进对局自动加入语音 + 轮到自己自动开麦（本地偏好 `autoMic`，默认开）+ `START_SPEECH` 文案改「提前开始发言」。本地验证：全量 **88 文件 572 例全过** + 4 typecheck + `build:web:v2` + 契约夹具重导出（含 `night-death-full.json`）+ E2E 分批双浏览器全过（12 仅 AC09/AC19 既有失败）。已整合进 main（`f2005ec`）。 |
| 2.0.5-alpha（开局身份揭示） | ✅ | 正式玩家每局首次进入对局时显示一次角色图、名称、阵营、座位和说明；唯一按钮“进入舞台”。`sessionStorage` 按房间/局/玩家去重；公共观众、私人第二屏和复盘排除；本人行动 ≤10 秒或倒计时未知时让位且本局不补弹。GPT-5.6-Luna 独立验证：focused Vitest 15/15、两个前端 typecheck、`build:web:v2`、新增 E2E 双浏览器 6/6、既有 fixture E2E 38/38、真实流程 04/09/02 正式房间通过。02 实验房间仍有既有 presence 断言失败。已合并进 main（`8ea46ca`，merge commit 保留贡献提交 `7d4a40a`）；维护方复核：全量 **89 文件 577 例全过**（贡献方计数 576 漏了选择器用例），两处小修见下。未部署。 |
| 2.0.6-alpha（声网语音可靠性收口 + 送达回执 / 频道对账 + 凭据链补齐，贡献 kiahir；原分支 `2.0.4-beta` 改名） | ✅ | **已合并进 main `20ccd06`**（保留贡献提交 `f40a1ee`）；维护方复核（2026-09-23）：全量 **93 文件 643 例全过** + 增量 6 文件 74 例 + 4 typecheck + E2E `27-voice-delivery`/`18-voice-levels` 双浏览器 14/14 + 真实凭据 `16-voice` chromium 1/1（16.4s）；合并后小修：install.ps1 恢复 BOM、无客户凭据时不暴露 `queryChannelUsers`（对账按 skipped）、文档笔误。分支自 `main` 的 `9c86a90` 拉出，**已合并 `origin/main`（`3379726`：v2.0.5-alpha + UI 优化批次 #9–#16）**，本分支未跑全量。媒体回收可靠性（`media.ts` 踢出成功后才删映射、失败留待 `sync` 重试；`enqueue` 永不 reject）+ 频道管理 REST 超时/退避重试（`agora.ts`）+ 发布凭证 TTL **600s → 150s** + 客户端连接可靠性 5 类（凭证续期/过期重连、autoMic 窗口键时序、重连按钮态、`#stopTask` 串行化、uid 归属/异常提示/设备保留）+ 端到端**送达回执**（`POST /voice/receipt` + `private.voice.delivery` **只下发当前发言者**，界面 10px 灰字「已送达 N/M」）+ 声网**频道轮询对账**（5 秒、仅进行中对局，只踢**未知 uid**，计数入 `AdminSummary.voice.reconcile`，**不使用 NCS**）+ 发言者本人不再显示远端电平 + **部署面凭据链补齐**（install 脚本 `.env` 补客户 ID/密钥 / `ADMIN_PASSWORD` / `AGORA_REST_BASE_URL`；主 `docker-compose.yml` 此前**没注入 `ADMIN_PASSWORD`**、release compose 只注入 `VOICE_ENABLED`，均已补）+ **缺凭据降级不崩**（文字测试模式 + 告警）+ **空 `AGORA_REST_BASE_URL` 修复**（空串→相对 URL，踢人/关房/对账全废）+ **关房改为「官方调用 + 逐个补踢」**（不带 uid 的踢人规则在真实声网是静默空操作）。实测：增量 **5 文件 60 例全过**（后端 40 + 客户端 19 → v2-media 16 / voice-agora 13 / voice-session 18 / voice-levels 7 / 新增 v2-voice-delivery-api 6；凭据补验后 voice-agora 16 / v2-config 10）、四个 typecheck 通过、`18-voice-levels` 双浏览器 **8/8**、`27-voice-delivery` 双浏览器 **6/6**、镜像重建（构建链内含**全量单测 + 4 typecheck + 双前端构建**）通过、**真机 `16-voice` 1 passed（12.3s；C/D 后 16.6s，发言者页「已送达 12/12」、听众页无送达行）**；**真实凭据补验（2026-09-23）**：D 对账 `rounds` 0→4→8→16→24 且 `failures` 0、未知 uid（自签 uid=0 通配凭证）被对账踢出、踢人 REST（555001 离开而 555002 留下）、关房修复后频道清空、**v1 `02-voice` 2/2（1.1 分钟）**；静态清点（合并前基线）88 文件 584 例；**合并 `origin/main` 后**静态清点 92 文件 / 606 例、v2 E2E **28 spec / 90 例**；方案与官方核对见 `docs/proposal-voice-delivery-observability.md`。**另实测（含复测）本项目「连麦鉴权」未生效 → 订阅 token 也能发麦；已接受该风险（用户决定 2026-09-21）**：靠服务端签发/撤回 + 发布 TTL 150 秒兜底。仍余：v1 无自动重连 + uid=座位号（其余审计项中 ②③④⑤ 已在本版修复）。详见需求文档文末 v2.0.6-alpha |
| 2.0.7-alpha（竞选投票本人提示 + 名单改名 + 提示音移入账户设置 + 团队攻击合并单按钮 + 公屏全阶段可写档位 + 白天自由发言阶段，贡献 kiahir） | 🚧 | 分支 `2.0.7-alpha`（自 `816f904` = `origin/main` 拉出，本地未推送）。**纯客户端**：新增 `web-v2/src/features/game/election-vote-notes.ts`（回执 / 禁投 / null 三态）接入 `presentation.ts` 的 idle 分支——无资格者（候选 / 重投平票者 / 死者 / 票权冻结）给出原因、投票后给出「已投给 N号 昵称 / 已弃票」；判定镜像 `engine/day.ts` 的 `submitElectionVoteIssue`（已退选恢复投票权不提示），回执只认当前 `election_vote` 窗口。界面「上警名单」→「竞选名单」。**提示音开关从局内发言条移入账户「显示与动画」**（持久偏好 `attentionSound`，默认关；局内任意手势自动解锁、未解锁时给一行可点兜底）。**团队攻击合并为单按钮**（标签即载荷：同意方案 v(n) / 发布并确认方案 / 发布并确认空刀；空刀需先清空选择）。**公屏写权限档位（规则 Q-10 + 契约必填字段）**：公屏改为对局内全阶段可写，房主建房时在 `alive_only` / `everyone` 间显式选择（无默认值），v1 入口维持「仅白天」。**白天「自由发言」阶段（规则变更 Q-11，用户裁定）**：房主**建房时必须显式选择**（`POST /rooms` 必填布尔 `freeSpeech`，缺失/非布尔 → 400 `invalid_free_speech`），选择结果**冻结在本局规则**里（`true` 保留 `timersSeconds.freeSpeech = 120`、`false` 删除该键，引擎门控 = `freeSpeechSeconds(state) !== null`）；开启后**每个白天**在**发言轮之后、放逐投票之前**插入固定 **120 秒**（**不提前结束**，与夜间窗口同一防泄露口径），**存活玩家可开麦**（死者仍只可订阅），无「当前发言者」、`autoMic` 不自动开麦，界面按**本机远端电平**显示「谁在说话」座位光环（阈值 5、保持期 1.2 秒），并**照常下发送达回执**（多发布者按窗口 + 发布者集合聚合，发布者自己的回执不计）；新增 `PublicGameDTO.voice.uids`（频道 uid → playerId，供光环归属，不含隐藏信息）。正式预设比对**忽略**这个房主可选键（`withoutFreeSpeech`），被篡改的取值仍拒绝；**1.1 预设与 v1 入口没有该阶段**。**座位徽标改版为可复用 BadgeStrip**（旧 `.seat-known`/`.seat-sheriff` 用 `writing-mode: vertical-rl`，容器 Chromium 的 CJK 字体缺竖排度量 → 盒高恒为 0、两字重叠成一个）：新增 `presentation/badges.ts`（色调注册表 + 纯函数）+ `components/badge-strip.tsx` + `features/game/seat-badges.ts`，落点＝座位号行内、多徽标共用底色框按色调等分，顺序固定 **身份 → 天理 → 魂灵**；身份徽标只在本人座位（第二屏同样显示），底色按阵营取 `--faction-human #3d6b9c` / `--faction-death #8f3b48`（同一对变量供身份弹窗/开局身份卡/复盘 `.faction-tag`）；排版经四次修订定为**恒定单排**（字号 8px、内边距 `2px 3px`，`needsStackedRow()` 删除，`flex-wrap` 仅兜底）。**座位左下角「濒死」标记**（用户裁定 方案 B/L1/②）：新增**可选**私有字段 `private.knowledge.dyingSeats`，由 `server/v2/view.ts` 的 `dyingSeatsFor()` 按 R-20/R-24 与 `engine/night.ts` 的 `dying_list` 逐条对齐下发（一阶段+夜间+名单已产生+本人在世；降临者全部、水妖仅未用还魂曲者；其余身份/二阶段/白天/本人已死亡/公开视图与观众**省略该字段**），前端 `features/game/seat-dying.ts` 只读该字段渲染白底 + `#944b56` 描边 + 红字的 8px 角标（宽 26px），`aria-label` 追加「，濒死」；不改公开 `alive`。除上述各项外未改 v1 入口与 1.1 预设。实测：增量单测 + 类型检查 + E2E 逐 spec 双浏览器全过（明细见文末追加）。未跑全量、未部署。详见 `docs/frontend-v2-election-vote-notes.md`、`docs/frontend-v2-public-chat-modes.md`、`docs/frontend-v2-free-speech.md`、`docs/frontend-v2-speech-attention-verification.md`、`docs/frontend-v2-stage-ux.md` |

## 接续指引（compact 后先读这里）

1. 读本文件 + `AGENTS.md`（项目规则与 Docker 约束）即可接上状态。
2. 规则细节查 `theater_death_rulebook_v1.1.md`（第 09 章 = S3 裁定）；
   工程规格查 `theater_death_development_requirements_v1.1.md`（最新 v2.0.6-alpha：v1.6 声网替换 · v1.7 规则 2.0 与移交时机 · v1.8 账号与 v2 体系准入 · v1.9 文档一致性整理 · v2.0.1-beta 解散与遗弃回收 · v2.0.2-alpha 舞台行动 UX 整合 · v2.0.2-beta 遗言顺序明文 + 账户显示设置修复 + 文档审计 · v2.0.3-alpha 局内语音音量显示与调节 · v2.0.4-alpha 竞选投票资格修正 + 夜间公开时钟 + 死神知识呈现 + 语音自动化 · v2.0.5-alpha 开局身份揭示 · v2.0.6-alpha 声网语音可靠性收口（媒体回收 / 发布 TTL / 客户端 / 送达回执 / 频道对账）+ 真机验收与鉴权实测 · v2.0.7-alpha 竞选投票阶段本人提示（无资格说明 / 投票回执）+「上警名单 → 竞选名单」重命名 + 团队攻击单按钮 / 点击切换 / 草稿配色昼夜一致修正 / 空目标一律说「空刀」+ 公屏写权限档位（Q-10）+ 白天自由发言阶段（Q-11）+ 座位徽标体系（BadgeStrip / 阵营配色 / 恒定单排 8px / 本人身份徽标）+ 座位「濒死」标记（私有 `private.knowledge.dyingSeats`，方案 B/L1/②），见文末版本记录）。
3. 进度断点（2026-09-19 深夜）：**PR#3 选定移植进行中**（外部贡献 syhneversigh，阿真确认照抄 A/B/D 三部分）。
   - **A 组已推送 `4688b49`**：公开知识泄露修复（`visibility/knowledge.ts` 先红后绿 9 例——修夜间名单在晨间公告前可从公开接口读到的泄露）、`engine/targets.ts`、`server/capabilities.ts`、`server/windows.ts` + `queued-clock.ts`、`server/log-store.ts`（迁移守卫 + 预备表列）、`GameCommand.windowInstanceId` / `START_SPEECH`、`LiveWindow.instanceId` / `type`。
   - **B 组（本批）**：天理夜死移交时机对齐 R-46/T-40 字面（晨间公告后立即办，不再等白天末尾）+ 规则 2.0 命名预设 `THEATER_DEATH_13_V2`（V2-01 立即终局 / V2-02 公告前竞选 / V2-03 发言 120 秒 + 15 秒准备窗口 / V2-04 提案兜底）；`engine/*`、`rulesets/*`、`day-driver` / `night-driver`、`clock` 照抄；版本记录已更新（规则书 Q-09 + 需求 v1.7 + `docs/rules-v2.md`）；增量 18 文件 193 例全过。
   - **D 组完成**：账号体系、StableRoom 房间模型（暂离 / 接管 / 房主继任 / 空房策略）、服务端 v2（/api/v2 + 契约 + 回执 + strictWindows）、web-v2 前端、contracts / docs / fixtures / E2E specs-v2 全套准入；`server/rooms.ts` 手工合并（保声网与终局退出）；**v2 语音改造为声网**（uid 稳定映射 + token 权限模型）；旧 LiveKit 自托管残留已删除。**全量 84 文件 517 例 + 双类型检查 + web-v2 构建全过。**
   - **入口切换（2026-09-19，阿真要求）**：镜像默认启动**新版（v2）体系与新前端**（`server/index.ts` 分发；`server/legacy-index.ts` + `ENTRY=v1` 供回滚与旧版 E2E）；compose 数据目录 `/app/data-v2`（旧 `../data` 保留挂载）、`WEB_ROOT=web-v2/dist`、`NODE_ENV` 可覆盖（本地 http 用 development）；e2e.env 设 `ENTRY=v1`；RUNBOOK §2.1 / .env.example 已更新。CI 绿（`35cf1ee` 起镜像 = 新前端）。
   - **服务器更新仍待执行**：`cd ~/theater-death && git pull` → `.env` 加 `AGORA_APP_ID` / `AGORA_APP_CERTIFICATE` / `AGORA_CUSTOMER_KEY` / `AGORA_CUSTOMER_SECRET`（删旧 LiveKit 行；`PUBLIC_BASE_URL` / `SESSION_SECRET` / `SESSION_COOKIE_SECURE` 保持服务器值不动）→ `./deploy/update.sh`；此前里程碑与语音链路均已就绪。
   - 本地分支 `pr3-review` 为 PR#3 head（审查用，暂留）；`deploy/livekit.yaml` / `livekit-public.yaml` 旧残留**已删除**（v1.9 另清理了 `frontend-local.ps1` 的 `livekit` 服务与各 compose 的 `LIVEKIT_*` / `VOICE_SERVICE_URL` / `VOICE_ADMIN_URL` 环境变量）。
4. 工作方式：先讲方案、阿真批准后动手；全部构筑/测试/运行在 Docker 容器内；测试必须真实运行，不许只写不跑。
5. 舞台 UX 已整合：PR #5 全部 4 个提交进 main（`b085f1b`），维护方修复布局判定竞态并补回归 E2E；全量 87 文件 556 例通过，未部署。

## 仓库与交付

- GitHub（公开）：`https://github.com/azhen073/theater-death`
- CI：push main → GitHub Actions 构建（镜像构建内含全部测试）→ 发布 `ghcr.io/azhen073/theater-death:latest`（包已设公开，服务器匿名可拉；层缓存后约 1 分钟）
- 部署（服务器）：`git clone` → `./deploy/install.sh`（优先拉镜像、回退本地构建）；更新：`git pull && ./deploy/update.sh`；详见 `deploy/RUNBOOK.md`
- **生产环境细节（域名、服务器地址）不在仓库内记录**，需要时问阿真
- Windows 提交的 `.sh` 必须在 git 里补可执行位：`git update-index --chmod=+x deploy/xxx.sh`

## 环境与命令（Windows + PowerShell）

- Docker Desktop 用户级安装：`C:\Users\28496\AppData\Local\Programs\DockerDesktop`
  （阿真的新终端 PATH 已含 docker；AI 的会话需先加 PATH，见下）
- daemon.json 已配 3 个国内镜像加速源（docker.1ms.run / xuanyuan / daocloud，原文件备份于 temp）
- Dockerfile 内 npm 使用 npmmirror 源；依赖由 `package-lock.json` 锁定（npm ci）

```powershell
$env:Path = "C:\Users\28496\AppData\Local\Programs\DockerDesktop\resources\bin;$env:Path"
docker compose -f deploy/docker-compose.yml build   # 构建镜像 = typecheck + 全量测试，任何一步失败即构建失败
docker compose -f deploy/docker-compose.yml up -d   # 启动服务（HTTP + Socket.IO，端口 3000）
docker compose -f deploy/docker-compose.yml down    # 停止清理
```

依赖更新流程（宿主不装 node_modules）：改好 `package.json` 后在容器内解析锁文件：

```powershell
docker run --rm -v "C:\project\theater_death:/app" -w /app node:24.15.0-bookworm-slim sh -c "npm install --package-lock-only --registry=https://registry.npmmirror.com"
```

## 架构约定（已落地）

- **Node 24 原生运行 TS**（type stripping）：源码 import 一律带 `.ts` 后缀；`tsc --noEmit` 仅做类型检查（tsconfig 开着 `allowImportingTsExtensions` + `rewriteRelativeImportExtensions`）。不引入 tsx/ts-node。
- **引擎纯函数**：`state + 动作 → { state, events }`；不依赖时钟、网络、浏览器。窗口计时/超时由服务端驱动（M2 实现）。
- **事件带可见性**：`EventVisibility = public | players | faction | server`；服务端先裁剪再发送，禁止先发全量再前端隐藏。
- **会话与房间**：HMAC 无状态 cookie（td_session）作唯一凭证；房间在内存（不承诺崩溃恢复）；凭证丢失=席位不可找回。
- **推送与对账**：Socket.IO 增量推送不带游标（客户端本地计数接续）；断线/刷新一律走 `GET /api/view` 全量流对账。
- **日志**：SQLite 只落服务端全量事件与聊天消息（审计/复盘用）；在线读取走内存。
- **随机由种子驱动**：`createRng(seed)`（mulberry32），同种子分配可复现；分配结果不公开。
- **测试在镜像构建内执行**（Dockerfile 第 13 步），本地不跑 node。

## 引擎与协议 API 速查

```
engine/setup.ts
  createGame({ gameId, ruleset, players, seed }) → { state, events }
    随机座位 + 洗牌分配；事件：game_started(公共) + role_assigned(仅本人)

engine/proposal.ts  # R-47 版本化草稿 + 全员确认
  createProposalState() / editProposal(state, activeMemberIds, actorId, targets)
  confirmProposal(state, activeMemberIds, actorId, revision) / lockedVersion(state, activeMemberIds)
  规则：锁定 = 当前有资格成员全部确认的最新版本；未达成 = 空刀；单人池提交即确认；重复确认幂等

engine/night.ts
  startNight(state) → 设置 nightStage=stage、初始化 night 上下文
  validateAttackPhase(state, input) → issues[]（守护连续限制/配额/失技/目标合法性）
  resolveAttackPhase(state, input) → 攻击结算（R-48 排序：目标座位升序，同目标 魂灵→死神→莱莱可）
  descenderCheckIssue(state, actorId, targetId) / resolveDescenderCheck(...)  # 降临者查验，每夜一次，结果仅本人可见
  rescueSelectionIssue(state, targetId) / resolveRescue(state, targetId | null)
  resolveNightEnd(state) → 濒死→死亡确认 + 失技判定，phase→morning

engine/morning.ts
  reviveSelectionIssue(state, targetId) / selectReviveTarget(state, targetId)  # 二阶段水妖回归
  resolveMorning(state) → 回归生效→公告→翻牌→科研员公告→阶段转换→阵营房死神加入判定→门先生回归→胜负

engine/stage.ts（晨间与白天共用，R-33/R-51）
  detectStageTrigger(players) → 死亡事件触发的阶段转换判定（all_spirits_dead / researcher_dead）
  applyReveals(players, emitter) → 莱莱可技能翻牌 / 科研员出局翻牌 + reveal_announced
  announceResearcherCount(state, players, emitter) → 公告时点存活死神阵营数
  applyStageTransition(state, players, trigger, emitter) → 转二阶段 + 门先生立即回归 + 阵营房死神加入

engine/day.ts（M3a，R-41–R-46）
  voteEligibility(state, playerId) → ok/dead/laike_frozen（莱莱可翻牌禁投一阶段；天理票权同步冻结）
  voteUnits(state, voterId) → 普通 2 单位 / 天理 voteWeight×2 = 3 单位
  currentLastWordsSpeaker / currentElectionSpeaker / currentSpeechRoundSpeaker / currentTieSpeechSpeaker
  beginDay(state) → 初始化白天流程（首夜遗言队列 / 首日竞选 / 发言轮待指定；建立卸任天理移交待办）
  endLastWords(state, actorId) → 遗言队列推进
  registerCandidacy / withdrawCandidacy / startElectionSpeech / advanceElectionSpeech
  submitElectionVote / settleElectionVote → 当选 / 平票重投 / 无天理
  designateSpeechRound(state, actorId, startId, 'asc'|'desc') / startDefaultSpeechRound(state)
  advanceSpeech(state, actorId) → 逐人推进，完毕进入放逐投票
  submitDayVote / settleDayVote → 出局公示 / 平票发言 / 重投 / 无人出局
  advanceTieSpeech(state, actorId)
  submitHandover(state, actorId, targetId|null) / resolveHandover(state)（超时销毁）
  resolveDaySettle(state) → 翻牌→转换→立即回归→判胜负→入夜（dayNumber+1, phase 'night'）或终局

engine/victory.ts
  checkVictory(state) → WinResult | null   # 晨间外的第二个检查点（投票后）在 M3 复用

visibility/（M2a 已落地，服务端只发裁剪结果）
  viewerContext(state, playerId) → { playerId, seat, roleId, factionId, life } | null
  isVisibleTo(event, viewer) / filterVisible(events, viewer)   # server 永不投递；死者保留已获知识
  roomMembership(state, playerId) → { roomId, readOnly, canWrite, historyFromSeq } | null
  canReadRoomMessage(state, playerId, messageSeq)               # R-52 历史边界：seq > historyFromSeq
  factionRoomView(state, playerId) → 房间视图（成员表）| null（非成员拿不到）
  canPostPublic(state, playerId)                                 # 白天 ∧ 存活
  toClientError(issue) → { code, message }                       # 安全文案
  buildPlayerView({ state, events, playerId }) → PlayerView
    公共流/个人流各自独立游标（ClientEvent.cursor 从 1 起，不泄露全局 seq）
  buildReviewView({ state, events, messages }) → ReviewView | null（null = 未终局）（R-53 / M3c）
    终局公开：全部交流（公屏/阵营房全文，含死神加入前历史）、行动时间线（引擎事件含 server 类，如 attack_events）、
    全部身份与最终生命状态、胜负原因；不含密钥/凭证/调试数据

server/（M2b-1 已落地，纯逻辑可注入时钟）
  clock.ts: Clock（now/schedule/cancel）· createSystemClock() · createFakeClock()（测试用 advance/pendingCount）
  commands.ts: NightCommand（SUBMIT_GUARD / SUBMIT_LAIKE / EDIT_PROPOSAL / CONFIRM_PROPOSAL /
    SUBMIT_CHECK / SUBMIT_RESCUE / SUBMIT_REVIVE）+ DayCommand（见 day-driver 段）→ GameCommand 联合
  night-driver.ts: createNightDriver({ clock, onStep }) → NightDriver
    start(state) → startNight + 段一（守护/阵营/刺杀并行，45/90s 固定时长）
    到点自动：resolveAttackPhase → 段二（查验/救并行 45s）→ resolveRescue → resolveNightEnd
      → 二阶段水妖夜死开回归窗口 45s → resolveMorning
    submit(command) → { accepted, code, message }；windows() 给客户端倒计时；dispose() 清定时器
    窗口时长取自 ruleset.timersSeconds（faction=90、ability=45）；不提前关窗（防节奏泄露）

server/ HTTP 层（M2b-2 已落地）
  session.ts: signSession / verifySession（HMAC-SHA256 无状态 cookie，td_session）
  rooms.ts: RoomRegistry（createRoom / joinRoom / startGame / getByCode / getByGameId）
    Room：内存房间（成员/状态/事件/聊天/回执/串行队列 enqueue）；不承诺崩溃恢复
  log-store.ts: createLogStore(path)（node:sqlite；events + messages 表；appendEvents/appendMessage/listEvents/listMessages）
  app.ts: createApp({ registry, clock, sessionSecret, cookieSecure }) → Express
    POST /api/rooms · /api/rooms/:code/join · /ready · /start
    GET /api/view（大厅/对局两种形态；对局形态含 proposal/hints/windows/serverTime）
      proposal：本人所在阵营协商池的草稿视图（pool/activeMemberIds/revision/targetPlayerIds/confirmedBy/locked，R-47）
      hints：sheriffSeat / speakerSeat / candidateSeats（前端操作面板用，免去从事件流推演）
    GET /api/review（M3c：仅终局后；未结束 403 game_not_ended；成员会话限定）
    POST /api/command（requestId 幂等，重发返回原回执；action 覆盖夜间 + 白天全部命令）
    POST/GET /api/chat（public/faction；历史过滤走 canReadRoomMessage）
    防护：Origin 同源校验、命令/聊天限流、json 64kb 上限
  day-driver.ts: createDayDriver({ clock, onStep, onComplete? }) → DayDriver（M3b）
    按引擎步骤排唯一活动窗口：last_words / election_signup / election_speech / election_vote /
      speech_order / speech_round / vote / tie_speech / handover；settle 同步结算后 done
    提前结算：投票全员投完即结算（不泄漏票型，仅结算时公示）；其余窗口到点自动推进
    submit(GameCommand)：白天命令校验窗口/身份/引擎 issue 后应用；跨阶段命令返回 window_not_open
    白天命令：END_LAST_WORDS / REGISTER_CANDIDACY / WITHDRAW_CANDIDACY / END_ELECTION_SPEECH /
      SUBMIT_ELECTION_VOTE / DESIGNATE_SPEECH / END_SPEECH / SUBMIT_DAY_VOTE / END_TIE_SPEECH / SUBMIT_HANDOVER
  rooms.ts 编排（M3b）：指定局开始 → 夜驱动；夜完成（phase 'day'）→ 日驱动；
    日结算（phase 'night'）→ night-driver.start（内部 startNight）→ 下一夜；终局（'ended'）不再开驱动
  index.ts: 环境变量装配启动（PORT/DATA_DIR/SESSION_SECRET/SESSION_COOKIE_SECURE）
  realtime.ts: createBroadcaster() → Broadcaster（Socket.IO）
    attach(server, { registry, sessionSecret })：握手校验会话 cookie（失败 unauthorized）
    连接后加入 game:<id> 与 player:<id> 频道，发 hello({ gameId, playerId, roomCode })
    emitGameEvents：public → 房间广播 flow 'public'；players/faction → 按接收者定向 flow 'personal'；server 不推
    emitChat：public 广播房间；faction 仅成员且消息在其历史边界内
    推送为增量（无游标）；对账以 GET /api/view 的全量流为准（客户端本地计数接续）

  静态托管（M3d）：web/dist 存在时挂 express.static + SPA fallback（非 /api、/healthz、/socket.io 的 HTML GET 回 index.html）
  attackPhaseInput 五字段：guardTargetIds / stage1DeathTargetIds / stage1SpiritTargetIds /
  stage2JointTargetIds / laikeTargetId
```

## 文件清单（当前）

```
theater_death/
├─ AGENTS.md                       项目规则（含 Docker 约束）
├─ PROGRESS.md                     本文件
├─ README.md                       项目门面（快速开始/开发/部署指引）
├─ theater_death_rulebook_v1.1.md
├─ theater_death_development_requirements_v1.1.md
├─ package.json / package-lock.json / tsconfig.json / vitest.config.ts
├─ .env.example / .env.v2.example / .env.frontend-local.example
├─ .gitignore / .dockerignore / .gitattributes
├─ .github/workflows/  release.yml（push main → 构建含测试 → 发布 ghcr 镜像）
│           · backend-v2-check.yml / backend-v2-candidate.yml（v2 增量检查与候选门禁）
├─ deploy/  Dockerfile（node:24.15.0-bookworm-slim 锁定）· docker-compose.yml（image 指向 ghcr）
│           · Dockerfile.v2 / Dockerfile.frontend-v2 / Dockerfile.e2e / Dockerfile.dependencies
│           · compose.*.yml（v2 / v2.release / v2.load / contract / frontend* / e2e）
│           · install/start/stop/update × {ps1,sh} · frontend-local.ps1 · v2.ps1 · RUNBOOK.md（运行手册）
│           · （旧 livekit.yaml / livekit-public.yaml 已删除；媒体服务现为声网托管）
├─ engine/  index · types · events · emit · random · setup · proposal · night · victory · morning · stage · day · targets
├─ rulesets/ index · types · roles · theater-death-13 · theater-death-13-v2 · validate
├─ visibility/  index · context · deliver · rooms · chat · errors · projection · review · knowledge
├─ server/  index.ts（入口分发：新版 v2 / 旧版 v1）· legacy-index.ts · health.ts · app · session · rooms
│           · log-store · realtime · clock · queued-clock · commands · night-driver · day-driver
│           · capabilities · windows · receipts · v2/（账号 · 稳定房间与租约 · 契约 2.x · 回执 · 视图与第二屏 · 媒体 · 管理 · 维护）
├─ contracts/  v2 · catalog · admin（新版客户端契约类型）
├─ voice/   policy（R-43 许可策略，纯函数）· agora（声网适配：订阅/发布/降权 token 签发、踢人/关房 REST）
├─ scripts/  build-frontend-v2 · select-tests · test-incremental · v2-capacity · v2-capacity-seed · seed-frontend-v2
├─ docs/    契约 2.1 / 2.2 · OpenAPI v2.2 · 规则 2.0（rules-v2 / rules-v2-full）· frontend-v2-* · backend-v2-*
├─ tests/   92 个测试文件（见"测试状态"）：v1 引擎与驱动（smoke · rulesets · engine-* · visibility
│           · night-driver · day-driver · server-api · realtime · spectator · review · voice-*）
│           · v2 体系（v2-api · v2-config · v2-realtime · v2-media · v2-timers · v2-victory · account-*
│             · avatars* · stable-room · room-* · screen-grants · empty-rooms · receipts · frontend-v2-*
│             · contract-* · knowledge · targets · capabilities 等）
│           · fixtures/contract-2.1（29 份 JSON 快照 + full-index）
├─ e2e/     容器化 Playwright 验收：specs/（v1 入口 10 个：01 冒烟·02 语音·03 越权·04 全流程·05 恢复
│           · 06 泄漏·07 观战·08 踢人·09 板子编辑器·10 终局退出）
│           · specs-v2/（v2 入口 29 个：账号·房间·行动·夜行·情报·公屏·复盘·展示·全流程·恢复·特殊行动·治理重连·发布冒烟·账号失败·管理·语音·遗言·语音电平·身份揭示·死亡特效·阶段转场·夜景氛围·发言聚焦·身份能力·竞选名单·舞台亮度·大厅视口·竞选投票提示）
│           · helpers/ 与 helpers-v2/ · capacity.mjs · timeline.mjs · playwright.config.ts / playwright.v2.config.ts
│           · （配套镜像 deploy/Dockerfile.e2e 与 compose e2e profile）
├─ vite.config.ts / vite.v2.config.ts   前端构建配置（产物 web/dist 与 web-v2/dist）
├─ web/  index.html · tsconfig.json（独立 DOM 环境与 JSX）
│        src/ main.tsx · app.tsx · game.tsx · review.tsx · voice.tsx（语音条与控制器）· api.ts · format.ts · types.ts · styles.css · vite-env.d.ts
├─ web-v2/  index.html · tsconfig.json（默认入口新前端）：src/ app · features/（账号·大厅·行动·情报·公屏·观战·复盘·语音·管理）· transport · presentation · styles
└─ data/ + data-v2/   SQLite 落盘位置（旧 `../data` 与新 `../data-v2`，由 `.env` 的 ENTRY 决定）
```

## 测试状态

603 passed / 92 files（2026-09-22 全量实测（含 v2.0.5-alpha 与 UI 优化批次：死亡特效/阶段转场/发言聚焦/上警名单/夜景氛围/身份说明/舞台亮度）：容器内 `vitest run` **92 文件 603 例全过**（15.7s）。较上一版 602 例新增 `frontend-v2-display-model` 亮度迁移/夹取 1 例。

642 passed / 93 files（2026-09-23 全量实测，含 v2.0.6-alpha（PR #17）声网语音可靠性收口）：容器内 `vitest run` **93 文件 643 例全过**（14.6s）。较上一版 603 例新增 40 例（送达回执 / 频道对账 / REST 超时与重试 / 缺凭据降级 / 客户端凭证续期与重连，含维护方补的「无客户凭据不暴露频道查询」1 例）。

2.0.6-alpha（原 2.0.4-beta）增量（2026-09-21，贡献 kiahir）：后端 **5 文件 40 例**（voice-agora 10 / v2-media 9 / voice-policy 10 / voice-api 7 / v2-voice-api 4）+ 客户端 **2 文件 19 例**（voice-session 13 / voice-levels 6）**全过**；服务端 `typecheck` 与 `typecheck:web:v2` / `v2-tests` / `web`(v1) 通过；E2E `18-voice-levels` **chromium 3/3 + webkit 3/3**。**回归有效性**：把改前的 `media.ts` / `session.ts` / `bar.tsx` 分别 stash 回去跑同一批用例 → **2 / 6 / 1 failed**，恢复后全绿。静态清点 **88 文件 584 例**、v2 E2E **18 spec / 53 例**（**本分支未跑全量**，上面那条 572 是 `main` 的实测记录）。**2026-09-22 合并 `origin/main`（`3379726`）后**静态清点为 **92 文件 / 606 例**、v2 E2E **27 spec / 86 例**。**C/D 落地（2026-09-23）后**同一批文件为 **5 文件 60 例全过**（v2-media 16 / voice-agora 13 / frontend-v2-voice-session 18 / frontend-v2-voice-levels 7 / 新增 `v2-voice-delivery-api` 6，即本批新增 7/3/5/1/6 例），四个 typecheck 仍通过；E2E `18-voice-levels` 增为 **双浏览器 8/8**（新增本人发言用例）、新增 `27-voice-delivery` **双浏览器 6/6**（含「已送达」低调样式断言）。**客户 ID/密钥补验（2026-09-23）**：voice-agora 增至 **16 例**（空/空白 REST 基地址退回默认、关房补踢、查询失败不阻塞关房）、v2-config **10 例**（缺凭据降级与 `voiceAdmin`）、v2-media 16、v2-voice-api 4 全过；**镜像重建通过**（构建链内含全量单测 + 4 个 typecheck + 双前端构建，未单独复跑全量）。

2.0.7-alpha 增量（2026-09-23，容器内）：**3 文件 45 例全过**（新增 `frontend-v2-election-vote-notes` 20 例）+ `typecheck:web:v2` / `v2-tests` / `build:web:v2` 均 exit 0 + E2E `28`（新）/`24`（改名同步）/`03` 双浏览器 **30 passed**（首轮 `28` 的只读观众用例定位器写死「舞台行动」而两浏览器各失败 1 例，属测试问题，修正后 10/10）；还原接线对照 **2 例失败**。静态清点 `tests/` **94 文件 / 654 例**（与维护方 643 例差 9 属计数方法差异，未跑全量核对）、`e2e/specs-v2` **29 spec / 95 例**。未跑全量、未重建镜像、未部署。详见 `docs/frontend-v2-election-vote-notes.md`。

2.0.7-alpha 追加（提示音开关移入账户设置）：`tests/frontend-v2-display-model.test.ts` **9 例全过**（新增 `attentionSound` 默认/守卫）+ 两 typecheck + `build:web:v2` 均 exit 0 + E2E `22-speech-attention`/`08-display`/`01-account` 双浏览器 **22 passed（54.5s）**、`22` 连跑两轮 **6/6、6/6**；**回归有效性**：组件改为忽略偏好 → `22` 提示音两例失败。顺带修 `01-account` 的 `getByRole('status')` strict 冲突（舞台亮度 `<output>` 同为 status）——**基线 stash 对照同样失败，非本版引入**。未接真实声卡。

2.0.7-alpha 追加（团队攻击合并单按钮）：E2E `03-actions`（含重写的空刀用例）双浏览器 **14/14**、`04-night-actions`/`10-recovery` 真实服务端用例 **8/8（1.6m）**、`typecheck:web:v2` exit 0；**回归有效性**：把 `emptyAction` 的门槛还原 → `03-actions` 的「同意方案/空刀单按钮」两例失败（`stage-skip` count 0 → 1）。空刀仍是合法草稿，服务端/契约未动。

2.0.7-alpha 追加（契约文档维护）：`docs/openapi-v2.2.json` 的 `/rooms/{code}/voice/token` 由 LiveKit 形状改为实现形状 `{appId, channel, uid, token}`，新增 `/rooms/{code}/voice/receipt`（body `{requestId, gameId, windowInstanceId, state, client?}`，响应 `{recorded, delivery}`），`/voice/webhook` 标 `deprecated` 并注明未挂载；`private.voice.delivery` 抽出共用 `VoiceDelivery` schema。`tests/contract-openapi.test.ts` 新增一条文档形状断言（拒绝 LiveKit 形状、身份字段不得入载荷）。实测 `tests/contract-openapi.test.ts` + `tests/test-selection.test.ts` **2 文件 17 例全过**；**回归有效性**：临时把 token 形状改回 `url/roomName` → 新断言失败（`missingProperty: url`）。纯文档 + 用例，无 UI 改动故无截图；服务端实现未改（契约版本仍 2.2）。

2.0.7-alpha 追加（团队刀人选择交互）：**点击座位＝选中 / 再点＝取消**，删除座位上的 `−` / `＋` 与「已选 ×N」（角标只留「已选」，`maxTargets`＝不同目标数上限）；`updateSelection` 去掉重复追加路径与 `change` 参数（`onSelect(playerId)`）。**界面不再能表达"同一目标多刀"**（用户裁定 2026-09-23：规则上不需要对单个目标双刀），服务端 / 引擎 / 契约未改。实测：单测 `frontend-v2-actions`/`frontend-v2-draft-reconciliation` **13 例全过** + `typecheck:web:v2` exit 0 + E2E `03-actions`（双浏览器）与真实服务端 `04-night-actions` **16 passed（1.1m）**；**回归有效性**：把切换改回"追加重复" → 单测失败（`['p_a','p_a']` ≠ `[]`）且 `03-actions` 报 `×2 · 3 / 3`。截图（全屏 `fullPage`，按 AGENTS 新规则）：`test-results-frontend-v2/probe-v2-select-full-{two,one}.png`、加粗提示 `probe-v2-hint-bold.png`（本地产物，不入库）。

2.0.7-alpha 追加（选择提示加粗）：行动卡的「点击舞台上的可选玩家进行选中 / 取消选中，仅改变选择；确认后才提交。」由 `.muted` 小灰字改为 `.action-hint`（`font-weight:700`、13px、正文色，各目标类行动共用）。实测 `typecheck:web:v2` exit 0 + E2E `03-actions`（双浏览器）与探针 **16 passed**，新增 `toHaveCSS('font-weight','700')` 断言；截图 `probe-v2-hint-bold.png`（全屏）。

2.0.7-alpha 追加（生效文案审查后改写）：团队方案面板的「此刻截止会执行」改为 **「窗口截止将采用」**（原措辞把"此刻"与"截止"两个时间点混在一起、且"执行"无宾语、无结算兜底），值域改为 `v2 · 1号 …` / `无草稿 → 今晚空刀`，依据三态改为 **「全队已确认这一版」/「未全票确认，采用最后合法草稿」/「还没有任何草稿，按空刀处理（今晚不出刀）」**，并在该行加 `title`「结算时按此方案出刀；最终以服务端结算为准」。实测 `typecheck:web:v2` exit 0 + `03-actions` 双浏览器 **16 passed**（新增用例覆盖三种依据）；**回归有效性**：把标题改回旧文案 → 新用例失败（实得「此刻截止会执行…」）；截图 `probe-v2-effective-copy.png`（全屏，展示"最新草稿 v3 vs 将采用 v2"这一最易读错的屏）。

2.0.7-alpha 追加（依据文案复审 + 空刀态修正）：逐句核对引擎后修两处——① **生效版本内容为空时必须说"空刀"**：`targetSummary(view, [])` 会返回「空选择」，而"最后合法草稿可以是空目标"是引擎允许的真状态（`engine/proposal.ts:87`、`tests/v2-proposal.test.ts:39-47`）→ 值行改为 `v{n} · 空刀（今晚不出刀）`；② 值行与依据改精确：无生效版本 → **「当前无草稿（空刀）」**（用户指定）+ 依据「没有可采用的草稿，按空刀处理（今晚不出刀）」（不再断言"没有草稿"），`latest_legal` 依据改为「没有全票版本，采用最后一份由在场成员提交的草稿」（对齐 `findLast(v => activeMemberIds.includes(v.authorId))`）。**另核对**：v2 服务端固定用 `THEATER_DEATH_13_V2`（`teamConfirm: 'unanimous_or_latest'`，`server/v2/app.ts:62,227`），带 `unanimous_by_revision` 的 1.1 板只服务 v1 入口（旧前端无此面板）→ 无需为"非全票版本不生效"准备文案；`basis='unanimous'` 与原「全队已确认这一版」经核对准确（locked 非空即返回 locked）。实测 `typecheck:web:v2` exit 0 + `03-actions` 双浏览器 **16 passed**（用例扩为"全票／最后合法草稿／空刀草稿／无草稿"四态）；**回归有效性**：去掉空目标分支 → 断言失败（实得 `v3 · 空选择`）；截图 `probe-v2-effective-{emptydraft,nodraft}.png`（全屏）。

2.0.7-alpha 追加（草稿目标配色区分）：座位上「我的选择」＝深蓝实线、「当前草稿目标」＝青色虚线 +「草稿」角标（重合时深蓝实线 + 青环），方案面板加图例、`aria-label` 补「在队伍草稿中」。E2E `03-actions` 双浏览器 **14/14**（含新增类名/角标/图例/计算样式断言）、`04-night-actions`/`10-recovery` **22 passed（2.1m）**、`typecheck:web:v2` exit 0；**回归有效性**：去掉 `stage-seat--draft` 类 → `03-actions` 断言失败（期望虚线/类，实得仅为 selected）。

2.0.7-alpha 追加（「我的选择」昼夜配色一致修正）：配色区分落地后复查发现**夜间把选中态压成淡蓝**——`night-atmosphere.css` 的 `.theater-stage--night .stage-seat--selected .seat-main { background:#dceaff; border-color:#9bbfff; box-shadow:0 0 0 4px #91b7ed66 }`（3 类特异度）盖过当时只有 2 类特异度的日间规则，于是「我的选择」白天深蓝、夜里淡蓝。修法：**删除该夜间覆盖**，三态颜色只由 `main.css` 的 `--seat-selected*` / `--seat-draft*` 变量定义，三条座位态规则统一加 `.theater-stage` 前缀（特异度不低于夜间规则，不再需要覆盖）；夜间座位底色 `#f5f8fd` 与「不可选」态覆盖保留。实测 `typecheck:web:v2` / `v2-tests` 均 exit 0 + `03-actions`（8 例）与临时探针双浏览器 **18 passed**，探针昼/夜计算样式逐项一致（选中 `solid rgb(69, 89, 116) 2px` / `rgb(234, 240, 248)` / `rgba(69, 89, 116, 0.25) 0 0 0 4px`，与草稿重合再加青环 `rgba(47, 125, 140, 0.4) 0 0 0 3px`，图例色块同值）；**回归有效性**：`git stash` 这两个 CSS 文件回到修正前 → 探针失败（夜间边框实得 `rgb(155, 191, 255)` = `#9bbfff`），`stash pop` 后全绿；探针跑完已删除，截图 `probe-v2-seat-colors-night.png`（全屏）。

2.0.7-alpha 追加（草稿行空目标改口为「空刀」）：方案面板的「最新草稿 **v{n}**：…」此前对空目标沿用 `targetSummary([])` 的「空选择」，与下方生效行的「空刀」口径不一致 → 新增 `draftText` 三态：`revision === 0` →「尚无草稿」、目标为空 →「空刀」、否则照旧列目标；**「空选择」只保留给本地选择为空**（`presentation/targets.ts` 未改）。实测 `typecheck:web:v2` / `v2-tests` 均 exit 0 + `03-actions`（新增「最新草稿 v3：空刀」与 v0「尚无草稿」断言）与临时探针双浏览器 **18 passed**；**回归有效性**：把 `draftText` 退回只调 `targetSummary` → `03-actions` 与探针各报 `Expected "最新草稿 v3：空刀" / Received "最新草稿 v3：空选择"`；探针跑完已删除，截图 `probe-v2-draft-empty.png`（全屏）。

2.0.7-alpha 追加（**公屏写权限档位，规则 + 契约变更，用户裁定 Q-10**）：公屏文字由「仅白天」改为**对局内所有阶段可写**（覆盖 S2「夜间公屏禁发」原裁定；夜间语音仍按 R-43 全静音）。房主**建房时必须显式选择**档位、无默认值、创建后不可改：`alive_only`＝仅存活正式玩家可写（死者只读，本人遗言期仍可写）/ `everyone`＝存活与死者全体可写；观众与第二屏任何档位下只读；大厅与复盘不适用。实现：`contracts/v2.ts` 加 `PUBLIC_CHAT_MODES`/`PublicChatMode` 与 `RoomSnapshot.room.publicChat`；`server/v2/app.ts` 的 `POST /rooms` 校验必填（缺失/非法 → 400 `invalid_public_chat`）并把档位存进 `StableRoom`；`visibility/chat.ts` 的 `canPostPublic(state, playerId, policy)` 改三档（`legacy_day_only` 为默认参数，v1 行为不变），经 `server/capabilities.ts` → `server/v2/view.ts` 透传到快照与聊天路由；`web-v2/src/features/room/create.tsx` 新增必选「公屏权限」单选（未选不可提交），`publicChatLabel` 用于大厅「本局规则」与侧栏公屏页签；`docs/openapi-v2.2.json` 补 `PublicChatMode`、`/rooms` 必填与 `room.publicChat`，10 个 `RoomSnapshot` 夹具补字段（不整目录重导）。文档同步：规则书 R-35 表 + 第 09 章 Q-10、`docs/rules-v2-full.md`、`docs/rules-v2.md` V2-05、F-05、权限矩阵、第 346/605 行、T-33、AGENTS 协作约束与裁定状态、`docs/backend-v2-api.md`、`docs/client-contract-2.2.md`、`docs/proposal-voice-delivery-observability.md`（标注历史不改项已被覆盖）。实测：单测 `visibility`/`capabilities`/`v2-api`/`chat-receipts-api`（新增 4 例）+ `frontend-v2-*` **21 文件 170 例** + 服务端与 API **28 文件 142 例** + `contract-openapi` **5 例**全过，四个 typecheck exit 0；E2E 逐 spec 双浏览器 `02-rooms` **6 passed**（含「未选不可提交」断言）、`06-chat-screen-real` **2 passed**（真实服务端夜间活人发公屏成功）、临时探针 **2 passed** 并出三张全屏截图。未覆盖：`06` 的「真实转日公屏」用例依赖手动推进假时钟（超时，与本变更无关）、`02` 的「实验房间」presence 既有失败、`everyone` 档的真实浏览器死者夜间发言（由单测与服务端用例覆盖）；v1 入口仍「仅白天」（已知不对称）；未跑全量、未重建镜像、未部署。静态清点（`it(`/`test(` 正则）：`tests/` **94 文件 660 例**、`e2e/specs-v2` **29 spec / 99 例**。详见 `docs/frontend-v2-public-chat-modes.md`。

2.0.7-alpha 追加（阵营交流记录并入公屏页签）：把「阵营交流记录」从「情报」页签移到「公屏」页签、排在公屏记录之下（页签数量与顺序不变；未读圆点改由公屏页签承载 `unread.public + unread.faction`，`active` 同步改为公屏页签；阵营房的成员制、只读边界与草稿行为一字未改）。同步 E2E：`06-chat-screen-real`（改为切到公屏页签并新增 `real-faction-room-<project>.png` 截图）、`05-information`（3 处）、`10-recovery`（2 处）的页签入口；顺带把页签定位由 `exact: true` 放宽（未读圆点会改变可访问名，此前会误超时）。实测：`typecheck:web:v2` exit 0、`frontend-v2-*` **21 文件 170 例**全过；E2E `06`（双浏览器）**2 passed**、`05` chromium **6 passed**、`10-recovery` chromium **3 passed**（含「导航往返保留 faction 草稿」）。**已知既有失败（非本次引入，已用还原侧栏的对照复现）**：`05-information` 的「聊天/事件历史」用例在 **webkit** 上 `scrollTop` 断言失败（期望 ≤1，实得 5790）——把侧栏改动还原后同样失败。

2.0.7-alpha 追加（死亡公告横幅不再遮挡 HUD）：`.death-notice` 原来写死 `top: 88px`（窄屏另有一条 `top: 90px`），而 HUD 是 sticky、高度随宽度与显示缩放变成 88/123/135px 且未滚动时还有场景顶部内边距，于是窄屏必然压住「导航 / 第二屏 / 房间管理」。修法按用户选定方案 1：`GameScene` 给 HUD 挂 ref，用 `ResizeObserver` + rAF 节流的 `scroll`/`resize` 把**HUD 当前下沿**写进 `--hud-bottom`（场景被房间管理隐藏时保留上次值，卸载即移除），CSS 改为 `top: calc(var(--hud-bottom, 112px) + 8px)`，并删掉窄屏写死的 `top: 90px`；≤680px 仍为 HUD 之下的全宽条。**逐项实测两个引擎坐标相同**（不是 WebKit 专有）。验证：`typecheck:web:v2` / `v2-tests` exit 0、`frontend-v2-*` **21 文件 170 例**全过、E2E `20-death-effects` 双浏览器 **12/12**（新增断言：横幅 y ≥ HUD 下沿、≥ 工具行下沿，滚动 300px 后再验一次）；截图 `death-fx/burst-{chromium,webkit}.png`。详见 `docs/frontend-v2-death-effects-verification.md` 追加节。

2.0.7-alpha 追加（窄屏 HUD 滚动后收成细条）：手机端（≤680px）HUD 折成两行 123px 且吸附，滚动到座位区时**必盖住一整排座位**（滚动 900px 实测：3 个座位完全被盖、6 个部分被盖；chromium 与 webkit 同值——用户看到的「WebKit 遮挡」实为 WebKit `fullPage` 截图把 sticky 元素画在滚动偏移处的合成伪影，视口内两引擎一致）。按用户选定方案 B：`GameScene` 加 `matchMedia('(max-width: 680px)')` + rAF 节流的 `scroll`/`resize`，**滞回**（下滑 >120px 收起、回到 ≤24px 展开）；收起态只留「第 N 轮 · 夜晚 · 第 M 阶段」＋阶段名＋倒计时＋**「更多」**（高约 44px），四个操作移入「更多」面板（`aria-expanded`，同一时刻只渲染一处，避免重名）；桌面宽度永不收起。E2E：新增 `29-hud-compact.spec.ts`（双浏览器 **2 passed**，含 44px 高度、`aria-expanded`、菜单内点「导航」开弹窗、回顶恢复）；把 HUD 操作入口统一改为 `revealHudActions(page)`（`helpers-v2/rooms.ts`，展开态空操作），并同步 `02/03/05/06/07/08/10/12/21/22/23/25` 的调用点；`06` 的阵营房整页截图改为**先回顶再截**（消除 sticky 伪影）。实测：`typecheck:web:v2` / `v2-tests` exit 0、`frontend-v2-*` **21 文件 170 例**全过、E2E `29`（双浏览器）2/2、`06` 双浏览器 2/2、`23` 双浏览器 10/10、`03+08+21+22+25` 双浏览器 **42 passed**、`05+07` 双浏览器 **26 passed**、`02` 双浏览器 **6 passed**（跳过既有 presence 失败用例）、`10-recovery` chromium **3 passed**；静态清点 `tests/` **94 文件 660 例**、`e2e/specs-v2` **30 spec / 100 例**。

2.0.7-alpha 追加（**白天「自由发言」阶段，规则变更 Q-11，用户裁定**）：规则 2.0 新增**可选**阶段——房主建房时**必须显式选择**（`POST /rooms` 必填布尔 `freeSpeech`，缺失/非布尔 → 400 `invalid_free_speech`），选择结果**冻结在本局规则**里（`true` 保留 `timersSeconds.freeSpeech = 120`、`false` 删除该键；引擎门控 = `freeSpeechSeconds(state) !== null`）；开启后**每个白天**在**发言轮之后、放逐投票之前**插入固定 **120 秒**、**不提前结束**（与夜间窗口同一防泄露口径）、**存活玩家可开麦**（死者仍只可订阅）、无「当前发言者」、`autoMic` 不自动开麦；界面按**本机远端电平**（阈值 5、保持期 1.2 秒）显示「谁在说话」座位光环，并**照常下发送达回执**（多发布者按窗口 + 发布者集合聚合，发布者自己的回执不计）；新增 `PublicGameDTO.voice.uids`（频道 uid → playerId，供光环归属，不含隐藏信息）。落点：`rulesets/{types,theater-death-13-v2,validate}.ts`（计时器白名单 + `withoutFreeSpeech` 让正式预设比对忽略该房主可选键、被篡改的取值仍按 `invalid_timer` 拒绝）、`engine/{types,day}.ts`（`freeSpeechSeconds` / `enterFreeSpeechOrVote` / `freeSpeechIssue` / `advanceFreeSpeech` + `freeSpeechDone` 防重入）、`server/day-driver.ts`（`free_speech` 窗口 + `timeoutFreeSpeech`）、`voice/policy.ts`（死者 `dead_listener`、其余 `granted`）、`server/v2/media.ts`（`SPEAKING_WINDOWS` + 多发布者聚合 + `uidMap`）、`server/v2/{snapshots,app}.ts`、`contracts/v2.ts`、`docs/openapi-v2.2.json`；web-v2 侧 `presentation/voice-levels.ts` + 新增 `features/voice/speaking-seats.ts`、`session.ts` 电平订阅、`bar.tsx`（自由发言不算「轮到我」、无当前发言者时也不自动开麦）、`stage.tsx`/`scene.tsx` 座位光环、`speech-attention.tsx`、`create.tsx`（必选开关，未选不可提交）、`lobby.tsx`。实测：增量单测 **34 文件 284 例全过**（新增 `v2-free-speech` 4 例，`v2-timers`/`v2-media`/`v2-api`/`frontend-v2-voice-levels` 各 +1 例，契约夹具补 `freeSpeech`）、**四个 typecheck 全部 exit 0**、E2E 新增 `specs-v2/30-free-speech.spec.ts` **双浏览器 4 passed**（HUD「自由发言」+ 提醒条 + `role="timer"`、不自动开麦、手动开麦后「已送达 1/1」、电平 42 亮光环并在保持期后清掉；建房未选时提交禁用、请求体 `freeSpeech: true`、大厅开关展示）、回归 `18`+`22`+`05` **26 passed**、`02-rooms` **6 passed**（跳过既有 presence 失败用例）、`06-chat-screen-real` **2 passed**（跳过依赖手动时钟的用例）。静态清点 `tests/` **95 文件 668 例**、`e2e/specs-v2` **31 spec / 102 例**。未覆盖：真实声卡多人同时开麦（需声网凭据与多路麦克风）。详见 `docs/frontend-v2-free-speech.md`。

2.0.7-alpha 追加（**自由发言阶段行动卡文案修正**，2026-09-27，用户裁定方案 A）：检查发现该阶段舞台中心只显示通用兜底「本阶段无需操作 / 等待其他玩家或服务端推进阶段。」——本阶段服务端**不下发任何任务**（`server/capabilities.ts` 白天分支无命中 `free_speech` 的 `allow()`，`server/v2/snapshots.ts` 的 `tasks` 只由 `allowedCommands` 派生，`server/day-driver.ts` 只排窗口），且 idle 分支**不看生死**，存活与出局玩家同一句话；而本阶段唯一动作是开麦（`voice/policy.ts` 存活 `granted()`、死者 `dead_listener`），卡片标题却是「YOUR NEXT MOVE」——与 `docs/frontend-v2-election-vote-notes.md` 已修的同类缺口口径不一致。改法（纯客户端）：新增 `web-v2/src/features/game/free-speech-note.ts`，在 `features/actions/presentation.ts` 的 idle 分支优先覆盖——存活「自由发言时间 / 点击上方语音条开麦发言；倒计时结束自动进入放逐投票。」、出局「你已出局 / 自由发言阶段只能旁听，倒计时结束进入放逐投票。」；只读视角（观众 / 第二屏）与其它阶段逐字不变；缺本人私有视图时返回 `null` 退回通用文案（**不猜生死**）。判定只读 `public.day.step === 'free_speech'` + `private.self.life`；**服务端 / 契约 / 引擎 / 1.1 预设 / v1 入口未改**。实测：新增 `tests/frontend-v2-free-speech-note.test.ts` **10 例**（推导 6 + 接入行动卡 4），连同 `frontend-v2-election-vote-notes`(20) + `frontend-v2-actions`(8) = **3 文件 38 例全过**；**回归有效性**：把 `idleText` 临时还原为只用竞选文案 → 该文件 **2 failed**（`expected '本阶段无需操作' to be '自由发言时间'` / `'你已出局'`），恢复后 10/10；`typecheck` / `typecheck:web:v2` / `typecheck:web:v2-tests` exit 0；E2E `specs-v2/30-free-speech.spec.ts` 扩为 **3 例**（新增「出局者看到旁听说明，只读观战仍走只读文案」）→ **chromium 3/3 + webkit 3/3**，回归 `specs-v2/28-election-vote-notes.spec.ts` 双浏览器 **10/10**；截图（全屏）`test-results-frontend-v2/free-speech-speaking-{chromium,webkit}.png`（存活卡片）、`free-speech-dead-{chromium,webkit}.png`（出局卡片 + 语音条「当前未获得发言权限」）。静态清点 `tests/` **96 文件 678 例**、`e2e/specs-v2` **31 spec / 103 例**。

2.0.7-alpha 追加（**自由发言文案统一**，2026-09-27，用户裁定）：「全体存活可同时开麦」表述有误 → 统一 **「存活玩家可开麦」**：发言与提醒条、语音条、大厅「本局规则」（`开启（发言轮后 2 分钟 · 存活玩家可开麦）`）、建房表单说明段与单选副文共四处用户可见文案，外加 `docs/openapi-v2.2.json` 的 `freeSpeech` 说明、代码注释（`server/day-driver.ts`、`engine/day.ts`、`server/v2/media.ts`、`voice/policy.ts`）与 E2E 三处断言。实测：`typecheck:web:v2` / `typecheck:web:v2-tests` exit 0；`v2-media`(17) + `v2-free-speech`(4) + `frontend-v2-free-speech-note`(10) = **3 文件 31 例全过**；E2E `specs-v2/30-free-speech.spec.ts`（新文案断言）**chromium 3/3 + webkit 3/3**；截图 `free-speech-speaking-*` / `free-speech-lobby-*` 已按新文案重出。规则正文三处仍为「全体存活玩家可同时开麦」（保留「同时」这一规则性质），未改。

2.0.7-alpha 追加（**座位徽标改版为可复用 BadgeStrip**，2026-09-27，用户裁定）：起因是检查「为什么 13 号有魂灵标志」时发现**旧徽标在 Chromium 下只显示一个字**——`.seat-known`/`.seat-sheriff` 用 `position:absolute` + `writing-mode: vertical-rl` + `font-size:9px`，在容器镜像的 CJK 字体（只有 WenQuanYi Zen Hei / Unifont，**缺竖排度量**）下竖排 CJK 盒高恒为 **0**（9/24/48px 全为 0），两个字重叠在同一处；拉丁竖排正常（32×28.3）、横排 CJK 正常（18×13），加 `height`/`line-height`/`text-orientation: upright` 均无效。改版（用户选定 chip 方案 + 落点方案 B「塞进座位号行」+「做成可复用性高的功能」）：新增**可复用三层**——`web-v2/src/presentation/badges.ts`（`BadgeTone` 注册表 `BADGE_TONES` / `badge()` / `isSplitStrip` / `badgeStripLabel`，纯函数）、`web-v2/src/components/badge-strip.tsx`（`BadgeStrip({items,size,className,ariaLabel})`，只认识色调+文案）、`web-v2/src/features/game/seat-badges.ts`（`seatBadges(view, seat)`，顺序固定 **天理 → 魂灵**，天理公开、魂灵沿用私有 `knowledge.spiritSeats` 授权）；CSS 加通用 `.badge-strip` / `.badge-strip__item--{tone}`（天理 `#81704c`、魂灵 `#6b4c78`，白字对比度 4.8/7.2）+ `:root` 新增 `--font-ui`；**新增徽标只需三处**（色调+文案 → 一条底色 CSS → 派生函数），组件不改。排版：徽标作为 `.seat-number` 的最后一个子元素（`13 [天理|魂灵]`），**不新增行、座位卡高度不变**（断言高度差 < 1px，因此不影响环形/流式切换）；多徽标**共用一个底色框、按色调等分**（`inline-grid` + `grid-auto-columns: 1fr`——用 flex+边框实测差 1px），半块间 1px 白线；`aria-label` 顿号连接（「天理、魂灵」）+ 半块 `aria-hidden`。连带：环形适配与 `08-display` 选择器列表 `.seat-sheriff` → `.badge-strip`；`stage.tsx` 删除 `knownSpirits` 与两个旧 span。实测：新增 `tests/frontend-v2-badges.test.ts` **11 例**；增量批次 **6 文件 74 例全过**；`typecheck` / `typecheck:web:v2` / `typecheck:web:v2-tests` exit 0；E2E `05-information` 双浏览器 **13 passed**（新增「座位徽标」用例：顺序/底色不同/等分宽度/盒高>8px/卡高不变/卡内/390 无溢出；仅既有的 webkit `scrollTop` 用例失败）、`08-display`+`30-free-speech` 双浏览器 **18 passed**、`03-actions` 双浏览器 **16 passed**；截图（全屏）`seat-badges-{chromium,webkit}.png`、`seat-badges-mobile-*.png`、4 倍放大 `seat-badges-zoom-chromium.png`（左半天理金字/右半魂灵紫字，两字齐全）；另回归 `22-speech-attention`+`20-death-effects`+`23-phase-identity` 双浏览器 **28 passed**。静态清点 `tests/` **97 文件 689 例**、`e2e/specs-v2` **31 spec / 104 例**。详见 `docs/frontend-v2-stage-ux.md` §4。

2.0.7-alpha 追加（**座位选择框配色调浅 + 不可选态可读性修复**，2026-09-27，用户裁定方案 A）：按用户要求把「选择框」整体调浅，并把「描边/光环」与「承载白字的底色」拆成两个 token（否则白字对比度会掉到 4.1 以下）：`--seat-selected-line: #7d90ab`、`--seat-draft-line: #6aacb8`（只用于边框与光环），角标底色仍用 `--seat-selected: #4d6285`（原 `#455974`，白字 6.2）与 `--seat-draft: #2f7d8c`（白字 4.7，不能再浅），底色 `--seat-selected-bg: #eaf0f8 → #f3f7fc`、`--seat-draft-bg: #eef7f8 → #f4fbfc`，光环 `#45597440 → #7d90ab33`、`#2f7d8c66 → #6aacb855`；**「不可选」座位**改日间 `#e7ebf0b0/#788393 → #eef1f6/#5a6a80`、夜间 `#d7e0ee/#58677c → #eaeff7/#5a6a80`。**同页 A/B 实测（chromium 探针：注入旧色值对照，按祖先底色合成后算文字对比度）**：不可选座位 9–10px 小字对比度 **夜间 4.33 → 4.78、日间 1.81 → 4.87**（日间原本几乎不可读，属真实缺陷）；选中态 `solid rgb(125,144,171)` / `rgb(243,247,252)` / `rgba(125,144,171,0.2) 0 0 0 4px`（文字对比度 11.19）、草稿态 `dashed rgb(106,172,184)` / `rgb(244,251,252)`（11.49）、重合态实线 + 3px 青环 + 6px 浅蓝环，昼夜逐项一致。连带：E2E `03-actions` 四条计算样式断言同步（选中边框/底色、重合阴影、草稿虚线色）；回归 `03-actions`+`08-display`+`21-night-atmosphere` 双浏览器 **34 passed**、`25-stage-brightness` 双浏览器 **2/2**（首跑失败是缺 `accounts.json` 种子，补 seed 后通过，与换色无关）；`typecheck:web:v2` exit 0；截图 `test-results-frontend-v2/probe-seatcolors-{after,before}-{night,day}-chromium.png`（1440 全屏对照）与 `…-390-chromium.png`。**未跑全量、未重建镜像、未部署。**

2.0.7-alpha 追加（**本人座位身份徽标**，2026-09-27，用户裁定）：在复用同一 `BadgeStrip` 的前提下新增 `identity` 色调——**只出现在本人座位**，文案取 `private.self.roleId` → `catalog.roles[].name`（`seatBadges(view, seat, catalog?)` 增加第三参），座位号行内顺序固定 **身份 → 天理 → 魂灵**，底色 `#455974`（白字 7.0）；**第二屏**（只读绑定视角）同样显示绑定玩家的身份徽标（座位号行已有「视角」标记），**公开观众**无私有视图 → 不显示；catalog 查不到该身份或不传 catalog 时**不显示**（不露 `roleId` 原文，与「公开翻牌」同口径）；不新增行、座位卡高度不变（E2E 断言高差 < 1px）。实测：`tests/frontend-v2-badges.test.ts` 由 11 → **17 例全过**（新增 6 例：本人唯一、顺序、第二屏、公开观众、未知身份、缺 catalog）；`typecheck:web:v2` / `typecheck:web:v2-tests` exit 0；E2E `05-information` **双浏览器 16/16 全过**（新增「本人座位身份徽标」用例；顺带同步两处旧断言——魂灵本人座位不再是"零徽标"、门先生夹具改为只断言无知识/职务徽标；本次 webkit 的 `scrollTop` 既有 flake **未复现**）、`30-free-speech`+`03-actions` 双浏览器 **22 passed**；截图（全屏）`seat-identity-{chromium,webkit}.png`、`seat-identity-second-screen-*.png`。**未跑全量、未重建镜像、未部署。**

2.0.7-alpha 追加（**身份徽标按阵营配色 + 多徽标共存检查**，2026-09-27，用户裁定）：① **阵营统一配色**：新增 `presentation/faction.ts`（`FACTION_LABELS` / `factionKey` / `factionLabel`）与 `main.css` 的 `--faction-human: #3d6b9c`（白字 5.6）/ `--faction-death: #8f3b48`（白字 7.3）；身份徽标底色按 `catalog.roles[].faction` 取色（`.badge-strip__item--faction-human|death`），**同一对变量**同时用于「我的身份」弹窗、开局身份卡与复盘「全部身份」行的 `.faction-tag`，因此同一身份各处颜色一致（未知阵营不渲染、不猜）；② **多徽标共存检查（实测发现两处真问题并修）**：(a) 「草稿/已选」角标原 `padding:4px 7px`（高 22px）下沿探入卡片 11px，**与徽标条实测重叠 21×3.5px** → 收紧为 `3px 7px; line-height:1`（高 16px），重叠 0；(b) 双徽标与号码同排时**行宽超卡片内容宽**（内容 97px；chromium 行宽 97、**webkit 100px**），字体度量差异会让 webkit 先换行、chromium 不换行 → 改为**按徽标数量决定布局**：1 枚与号码同排（卡片不加高），**2 枚及以上 `seat-number--stacked` 独占一行**（`flex-direction: column`），两引擎表现一致；`flex-wrap: wrap` 仅作兜底（3 枚这种规则外组合也不再溢出卡片）。极端组合实测（临时探针）：2 枚 62×16 在卡内、3 枚 93–97×16 独占一行仍在卡内、文字均未裁切。实测：`tests/frontend-v2-badges.test.ts` **20 例全过**（新增阵营口径 3 例）；`typecheck:web:v2` / `v2-tests` exit 0；E2E `05-information` **双浏览器 18/18**（新增「多个徽标同时存在」：身份+天理等分、底色=阵营红/金、与草稿已选零重叠、文字不裁切、390 不出卡；「本人座位身份徽标」补 `data-faction` + 阵营色 + 与弹窗标签同色断言）；回归 `03-actions`+`30-free-speech`+`23-phase-identity`+`07-review`+`08-display`+`21-night-atmosphere` 双浏览器 **62 passed**（另 2 例为缺账号种子导致，补 seed 后 6/6 通过）；截图（全屏）`seat-badges-multi-{chromium,webkit}.png`、`…-390-*.png`、`seat-identity-*`。**未跑全量、未重建镜像、未部署。**

2.0.7-alpha 追加（**去掉本人座位的「你」标记 + 换行规则按文案字数**，2026-09-27，用户裁定「先去掉『你』标记」）：座位号行不再显示「你」（身份徽标本身只在本人座位，属重复信息），第二屏仍标「视角」，无障碍名补「你的座位」以免读屏丢失"这是你的座位"。去掉这一格宽度后**2 字身份 + 天理在两引擎都能与号码同排**（实测：chromium/webkit 强制同排均 `inside=true`、不裁字、卡片高度差 0），于是把换行判定由「2 枚即独占一行」改为**按文案字数**（新增纯函数 `needsStackedRow()`）：两枚且最长 ≤2 字 → 同排且**卡片不加高**；**最长 3 字（门先生/降临者/科研员/丧亲者/莱莱可）或 ≥3 枚 → 独占一行**（实测 3 字 + 天理在 webkit 强制同排会 wrap 且卡片 +20px，故必须独占一行；判定来自数据而非字体度量，两引擎一致）；`flex-wrap: wrap` 仅作更窄屏兜底。实测：单测 `frontend-v2-badges.test.ts` **21 例全过**（新增换行判定 1 例）；`typecheck:web:v2` / `v2-tests` exit 0；E2E `05-information` 双浏览器 **18/18**（「座位徽标」改为断言 2 字双徽标同排 + 卡高不变；「多个徽标同时存在」补 3 字身份独占一行、仍在卡内不裁字；「本人座位身份徽标」断言无「你」+ `aria-label` 有「你的座位」）；回归 `03-actions`+`23-phase-identity`+`30-free-speech` 双浏览器 **30 passed**（另 1 例为缺账号种子，补 seed 后 6/6）。截图（全屏）`seat-badges-multi-*`（2 字同排）、`seat-badges-long-identity-*`（3 字独占一行）。**未跑全量、未重建镜像、未部署。**

2.0.7-alpha 追加（**徽标改「恒定单排」+ 字号 8px / 内边距 2px 3px**，2026-09-27，用户裁定方案 A′）：徽标**不再按数量换行**——`.badge-strip--sm` 字号 10 → **8px**、`.badge-strip__item` 内边距 `3px 5px → 2px 3px`（`min-width` 保持 30px），`needsStackedRow()` 与 `.seat-number--stacked` 整体删除，座位号行恒定单排（`flex-wrap: wrap` 仅作兜底）；徽标块高度 16 → 12px。**几何矩阵实测**（4 组合 × 视口 {320,390,768,1440} × 缩放 {90,100,110}% × 双引擎 = 96 格，临时探针跑完已删；`余量 = 卡片可用宽 − 行宽`，最紧组合＝3 字身份 + 天理）：**1440 → 18 / 18px、768 → 18 / 18、390 → 15.7 / 15.7（均单行，行高 17px）**；对照改前（10px）在 390/1440 就已顶满（80 / 94.7≈97px）并**折成两行（行高 40px）**、320 余量为负 → 本次把「≥390px 全部单行」做成。**320 视口仍未达标**（卡片可用宽仅 71.3px，余量 0–2.8px、折行；实测备选：`min-width: 24px` 仍折行、字号回 9px 更差 −2px、**≤359px 改两列网格** 可用宽 ≈118px、余量 **39–50px** 可行）→ 待用户定。**用户裁定方案 ② 后已落地**：新增 `@media (max-width: 359px)`（`grid-template-columns: repeat(2,minmax(0,1fr))`、`gap: 14px 10px`、`padding: 16px 10px`），320 档可用宽 ≈118px、余量 39px，两引擎均单排且卡片不加高；两个徽标用例各补 320 断言（网格 2 列 + 与号码同排 + 余量 > 12px + 卡内不裁字 + 无横向溢出），截图 `seat-badges-320-*`、`seat-badges-long-identity-320-*`。实测：单测 `frontend-v2-badges` **20 例全过**；`typecheck:web:v2` / `v2-tests` exit 0；E2E `05-information` 双浏览器 **18/18**（「座位徽标」加 8px 字号与余量 > 8px 断言；「多个徽标同时存在」把 3 字身份改为**同排 + 余量 > 12px + 卡高不变**），回归 `03-actions`+`23-phase-identity`+`30-free-speech`+`08-display`+`21-night-atmosphere` 双浏览器 **68 passed**；截图 `seat-badges-zoom-chromium.png`（4× 放大判 8px 字形，清晰可辨）、`seat-badges-{multi,long-identity}-*`、`probe-nowrap-matrix-*-{after,before}-{chromium,webkit}.txt`。**未跑全量、未重建镜像、未部署。**

2.0.7-alpha 追加（**进入对局前的大厅与复盘自由开麦**，2026-09-27，用户裁定 Q-12）：先出方案时实测发现**大厅根本没有 `room.access`**（`stable-room.ts:98` 只在 `startMatch()` 建、`rounds.ts:23` 局末置空）、**没有 playerId**（`participants` 开局才填）、**也没有频道名**（`gameId` 每局生成，`StableRoom.gameId` 在大厅为 null），因此不是放开两处判定就行——按用户选定的**方案甲**新增**独立的房间语音频道** `l_<roomId>`（跨局复用），对局频道仍是 `gameId`、对局内权限与 R-43 链路一字未改；用户同时裁定**复盘期间也允许开麦**（房间频道覆盖 `lobby` + `review`）。落地：`voice/policy.ts` 新增 `LOBBY_SPEAKER_PERMISSION` 与 `roomVoicePermission({phase, formal, state, playerId})`（大厅/复盘→正式成员自由开麦、其余只读；对局内逐字转交 `voicePermission`）；新增 `server/v2/room-voice.ts`（`roomVoiceChannel`/`roomVoiceIdentity`/`roomVoiceMembers`，主体=memberId）；`media.ts` 抽出 `VoiceScope`（频道 + 身份表 + 是否终结 + 可选的 `match`），`matchScope/roomScope/issue/sync/reconcile/joined` 全部改走范围，`uidMap` 改为暴露**语音主体**（对局内 `p_`、房间内 `m_`）；`snapshots.ts` 顶层新增必有字段 `RoomSnapshot.voice = {channel,uids}`（**移除** `PublicGameDTO.voice`），大厅/复盘的 `canPublishVoice` 走同一函数、`delivery` 仅 `playing` 下发；`stable-room.startMatch()` 开局关闭房间频道（新增 `deps.closeRoomVoice`）、`room-directory.releaseControl()` 撤销房间身份；`app.ts` 语音 token/sync 支持两种范围（`gameId` 变可选、大厅相位以服务端为准）、对账同时覆盖两个频道、解散时关两个频道。客户端：`session.ts` 上下文改 `scope`（对局=`gameId`，大厅/复盘=相位名）并按范围变化先离开再加入、token 请求在大厅不带 `gameId`；`bar.tsx` 三种相位都渲染语音条（大厅「进入对局前 · 正式玩家可自由开麦」、复盘「复盘讨论 · 正式玩家可自由开麦」），仍然**只有对局内自动开麦**，`uids` 读顶层；`shell.tsx` 的 `activePage` 放宽到房间页；大厅成员卡新增「正在说话」光环（`member-card--speaking` + `badge--speaking`，复用 `speaking-seats` 与 1.2 秒保持期）。实测：`voice-policy` 13 例、`v2-media` 21 例（新增房间频道 4 例：频道名/身份表、发布与订阅凭证+uid→memberId、离线回收、无回执不关房）、`v2-voice-api` 7 例（新增大厅 3 例：正式成员发布+观众订阅+快照 `voice.channel`/`canPublishVoice`；开局关频道并切 `gameId`；复盘回房间频道且相位以服务端为准）、`frontend-v2-voice-session` 20 例（新增大厅加入不带 gameId、范围切换先离开再加入）全过；四个 typecheck exit 0；E2E 新增 `32-lobby-voice.spec.ts` **双浏览器 4/4**（大厅提示+可开麦+观众只旁听、成员卡光环与保持期后消失、复盘提示），回归 `30-free-speech` 双浏览器 6/6（夹具 `uids` 移到顶层后同步）、`18-voice-levels`、`05-information`+`07-review`+`27-voice-delivery` 双浏览器 **38 passed**；截图（全屏）`lobby-voice-*.png`、`lobby-voice-observer-*.png`、`review-voice-*.png`。**未跑全量、未重建镜像、未部署；真实媒体（大厅里真的互相听见）仍需真实声网凭据按 `16-voice` 口径补验。**

2.0.7-alpha 追加（**320px 座位改两列网格**，2026-09-27，用户裁定方案 ②）：徽标「恒定单排」在 320 视口仍折行（三列网格下每卡可用宽仅 71.3px）→ 新增 `@media (max-width: 359px) { .stage-seats--ring, .stage-seats--grid { grid-template-columns: repeat(2,minmax(0,1fr)); gap: 14px 10px; padding: 16px 10px; } }`，可用宽 ≈118px、余量 **39px**（chromium/webkit 同值），两引擎均单排且卡片不加高；对照实测另两个备选（`min-width: 24px` → 余量 0–3px 仍折行、字号回 9px → −2px）均不可行，故取两列；只作用于 ≤359px，≥390 仍三列。实测：`typecheck:web:v2` exit 0；E2E `05-information` 双浏览器 **18/18**（「座位徽标」与「多个徽标同时存在」各补 320 断言：网格 2 列、2 字双徽标与 3 字身份 + 天理均与号码同排、行内余量 > 12px、全在卡内不裁字、卡片不加高、无横向溢出），同树 `31-dying-mark` + `03-actions` 双浏览器 **18 passed**（首跑 chromium 报卡高差 3px，原因是拿 1440 测得的卡高与 320 比——改为同在 320 下比两个座位后通过，属测试写法问题）。截图（全屏）`test-results-frontend-v2/seat-badges-320-{chromium,webkit}.png`、`seat-badges-long-identity-320-*.png`。**e2e 规格无 typecheck 通道**（browser 镜像无 tsc、deps 镜像无 `@playwright/test`，且它不在 `package.json` devDependencies 里）——属既有结构缺口，未修。**未跑全量、未重建镜像、未部署。**

2.0.7-alpha 追加（**座位左下角「濒死」标记**，2026-09-27，用户裁定 方案 B / 落点 L1 / 样式②）：授权走**服务端裁剪 + 客户端只读**——`contracts/v2.ts` 的 `PrivateGameDTO.knowledge` 加**可选**字段 `dyingSeats?: number[]`，`server/v2/view.ts` 新增 `dyingSeatsFor(selfSeat, state)`，与 `engine/night.ts:361-378` 发出 `dying_list` 的授权**逐条对齐**：`stage === 1 && night !== null`、本人 `life !== 'dead'`、身份为**降临者**（R-24，一阶段全量）或**水妖且 `!abilities.waterRescueUsed`**（R-20，用后当场失去视野）、且 `night.dyingSet.length > 0`；不满足即返回 `null` → **字段整体省略**（不以下发空数组冒充「本夜无人濒死」）。公开视图 / 观众 / 二阶段 / 白天 / 本人已死亡均无该字段，**第二屏继承被绑定玩家**；濒死**不改变公开 `alive`**（`visibility/projection.ts`）。前端新增 `web-v2/src/features/game/seat-dying.ts` 的 `seatDyingMark(view, seat)`（只读字段、不做任何推断），`features/game/stage.tsx` 在座位卡**左下角**渲染 `<span className="seat-dying">濒死</span>`——白底 + `#944b56` 描边 + 红字（对比度 6.2:1）、8px / `padding 1px 4px`（宽 26px），与左上「草稿」、右上「已选」构成三角标族，且**不与阵营身份徽标的实心红撞色**；文案 `aria-hidden`，座位按钮 `aria-label` 追加「**，濒死**」，不阻断点选与「详情」。文档：`docs/frontend-v2-stage-ux.md` §5（规则依据 / 授权表 / 呈现 / 边界 / 验证）、`docs/client-contract-2.2.md`、`docs/openapi-v2.2.json`（`knowledge` 加可选 `dyingSeats`，`required` 不变）、AGENTS 版本记录。实测：新增 `tests/frontend-v2-dying-mark.test.ts` **6 例** + `tests/knowledge.test.ts` 新增 **5 例**（授权矩阵：降临者/水妖、水妖用后失效、二阶段/白天/名单未产生/本人已死亡、公开视图不含 + 与 `dying_list.payload.seats` 集合一致）→ `knowledge` **16 例全过**；增量批次 **42 / 54 例全过**；`typecheck` / `typecheck:web:v2` / `v2-tests` exit 0；E2E 新增 `specs-v2/31-dying-mark.spec.ts` **双浏览器 2/2**（文案与配色、无障碍名、名单外/无字段/水妖/公开观众无、第二屏有、左下定位、1440/390/320 与「详情」按钮**零重叠**、全屏截图 + 4× CDP 放大），回归 `31+03+05+23+07` 双浏览器 **60 passed**。**几何修正**：10px 版在 320px 与可见「详情」按钮撞 3.4px → 收窄到 8px/26px 后零重叠（对照断言改为与 `.seat-tools button` 比）。**回归有效性**：临时把字段改回无条件下发 → 授权用例失败。静态清点 `tests/` **98 文件 / 709 例**（`it(` 正则）、`e2e/specs-v2` **32 spec / 104 例**（`test(` 正则；临时探针 `90-probe-dying-overlap.spec.ts` 跑完已删除）。截图（全屏 `fullPage`）：`test-results-frontend-v2/seat-dying-{chromium,webkit}.png`、`seat-dying-390-*.png`、`seat-dying-320-*.png`、`seat-dying-zoom-chromium.png`（4× 放大）。**未跑全量、未重建镜像、未部署。**


2.0.6-alpha 真机验收（原 2.0.4-beta，2026-09-21，本机 `.env` 真实凭据）：`16-voice` **chromium 1/1（12.3s）**——13 客户端真机入频道、候选开麦发布、**接收方远端电平 35–42%（真实收流）**、结束发言即时撤权（截图 `test-results-frontend-v2/voice-*.png`；跑完 `down -v` 收栈）。**鉴权探针**（临时用例已删）：加入**强制校验 token**（无 token → `dynamic use static key`；错证书 → `invalid token, authorized failed`），但**发布权限位无约束力**（订阅 token 在 rtc 与 live 下均能发麦、20s 的 `pubAudio` 过期后仍能发麦）→ **本项目「连麦鉴权」未生效（复测同），已接受该风险（用户决定 2026-09-21）**：靠服务端签发/撤回 + 发布 TTL 150 秒上限兜底。仍未验：增益/AGC 听感；踢人/关房真实 REST 与 v1 `02-voice`（均需客户 ID/密钥）：2026-09-21 曾决定不验，**2026-09-23 用户改定「后续可以引入客户 ID/密钥」→ 待凭据到位后补验**（生产要用踢人/关房与频道对账，`.env` 必须配该凭据；连带待办：install 脚本 `.env` 补这两项、接通 `AGORA_REST_BASE_URL`）。**2026-09-23 复验（C/D 后，同样真实凭据）**：`16-voice` **chromium 1/1（16.6s）**——发言者页截图**「已送达 12/12」**（C 在真实媒体上成立）、听众页 `5号/6号 正在发言 · 69–78%` 且**无送达行**（隐私门控）、撤权后无送达行；api 容器**无媒体失败告警**；活频道 `queryChannelUsers` → `{channelExist:true, mode:1, users:[1..10]}`，匿名凭据 → `HTTP 401 Invalid authentication credentials`。仍未验：增益/AGC 听感、`publish_audio` 兜底（未启用）；`16-voice` 对送达行无断言（仅截图）。**客户 ID/密钥补验（2026-09-23，同样真实凭据）**：v2 验收栈加 `ADMIN_PASSWORD` 后可读 `voice.reconcile` —— 假时钟按 6 秒推进下 `rounds` 0→4→8→16→24、`failures` 0、干净进程 `notInChannel` 0；**未知 uid**（App 证书自签 `uid=0` 通配凭证、浏览器以 uid 987654 入频道）被下一轮对账踢出，`unknownKicks` 递增；**踢人 REST** 只踢 555001 → 其离开而 555002 仍在；**关房 REST** 修复前 6 秒后频道仍 `[4,5]`、修复后变 `[]`；**v1 `02-voice` 2/2（1.1 分钟）**。临时探针（helper 容器 + 临时 spec）已删除，凭据只在本机 `.env`。

E2E（2026-09-21）：v1 入口全量 **21/21 通过**；v2 入口全量运行受验收服务 **IP 限流**（登录/注册 30 次/分钟）影响会出现登录 429 级联失败，需按增量策略分批跑——本次已逐 spec 复核：03/04/05/07/08/09/10/11 全过，12 仅 AC09/AC19 失败（main 基线同样失败，既有），02 与 06 的失败在 main 基线同样复现（既有）。`13-release-smoke`（需 `FRONTEND_BASE_URL`）、`15-admin`（需 `ADMIN_TEST_PASSWORD`）、`16-voice`（需语音配置）为环境门控，不在本编排运行。
E2E（v2.0.2-beta 追加，2026-09-21 实测）：新增 `e2e/specs-v2/17-last-words.spec.ts`（遗言界面链路，2 例）——**chromium 2/2、webkit 2/2 通过**；命令 `docker compose -f deploy/compose.frontend-acceptance.yml --profile acceptance run --rm browser npx playwright test --config=playwright.v2.config.ts 17-last-words.spec.ts --project=chromium|webkit`（acceptance 栈 + seed，约 2–4 秒）。v2 入口静态清点更新为 **18 个 spec / 52 例**（`18-voice-levels.spec.ts` 为 v2.0.3-alpha 新增，`05-information` 的「死神/魂灵知识」为 v2.0.4-alpha 新增）。
E2E（v2.0.4-alpha 实测，2026-09-21，acceptance 栈分批 + seed）：`03-actions`+`05-information`+`08-display` chromium 19/19（含新「死神/魂灵知识」用例与偏好键 8 项断言）、`05-information`+`03-actions` webkit 13/13、`04-night-actions` 双浏览器 2/2（夜间 HUD 时钟 + 无任务玩家也能看到）、`11-special-actions` chromium 1/1（平票驱动改为非候选投票后通过）、`18-voice-levels` 双浏览器 4/4（含自动加入语音 + 自动开麦）、`09-full-game` 双浏览器 2/2、`17-last-words` 双浏览器 4/4、`01-account` chromium 2/2、`08-display` webkit 6/6、`12-governance-reconnect` chromium AC07 通过（AC09/AC19 为既有失败）。v1 入口（规则变更共用引擎，只跑受影响路径）：`04-flow-full` 双浏览器 4/4（机器人流程含竞选报名/投票）、`03-security`+`07-spectator`+`10-end-exit` 6/6；其余 v1 spec 与竞选无关，未重跑。

E2E（v2.0.5-alpha 增量，2026-09-22，GPT-5.6-Luna 独立执行）：新增 `19-identity-reveal.spec.ts`，chromium + webkit 6/6；既有 fixture E2E `03-actions`/`05-information`/`08-display` 双浏览器 38/38；真实开局 `04-night-actions`、`09-full-game` chromium 各 1/1，`02-rooms` 正式房间 1/1。`02-rooms` 实验房间仍有既有 presence 状态断言差异（期望 offline、实际 reconnecting），与身份揭示无关。当前静态口径：Vitest **577 例 / 89 文件**（维护方全量复核全过），v2 E2E **19 个 spec / 55 例**；E2E 未跑全量。
E2E（公开死亡特效 + 阶段转场，2026-09-22，维护方实测）：`20-death-effects` 双浏览器 12/12、`20-phase-transition` 双浏览器 16/16；与 `08-display`、`19-identity-reveal` 的集成集 **46/46**（同树，含两 PR 交互路径：死讯优先窗口 / 公开事件 + 公开座位状态）。v2 静态口径更新为 **21 个 spec / 69 例**（55 + 6 + 8；两个新 spec 均为 2026-09-22 批次）。
E2E（发言聚焦与提示音，2026-09-22，维护方实测）：`22-speech-attention` 3 例 + `18-voice-levels`/`20-death-effects`/`08-display`/`03-actions` 双浏览器集成集 **48/48**（含光环与死亡星芒共存、头像圆形裁切保持）。v2 静态口径更新为 **22 个 spec / 72 例**（69 + 3）。
E2E（上警名单与公屏，2026-09-22，维护方实测）：`24-election-chat` 3 例 + `05-information`/`22-speech-attention`/`20-death-effects`/`08-display` 双浏览器集成集 **42/42**（含 XSS 文本转义、160 条分页锚点、长昵称/长文本、4 断点无溢出）。v2 静态口径更新为 **23 个 spec / 75 例**（72 + 3）。
E2E（夜间舞台氛围，2026-09-22，维护方实测）：`21-night-atmosphere` 3 例 + `03-actions`/`22-speech-attention`/`20-death-effects`/`08-display` 双浏览器集成集 **50/50**（含 5 秒 motion 卸载、四档宽度可点、资源 200 + image/png、运行中切减少动画）。v2 静态口径更新为 **24 个 spec / 78 例**（75 + 3）。
E2E（分阶段身份能力说明，2026-09-22，维护方实测）：`23-phase-identity` 5 例 + `05-information`/`19-identity-reveal`/`22-speech-attention`/`08-display` 双浏览器集成集 **46/46**（九身份两阶段、死亡/已用状态、观众/错配/第二屏边界、390 无溢出）。v2 静态口径更新为 **25 个 spec / 83 例**（78 + 5）。
E2E（舞台亮度与 #13 组合，2026-09-22，维护方实测）：`25-stage-brightness` 1 例（滑杆持久化/跨页实时生效/跨房间沿用/日夜/390+1440/点击不受阻）+ `08-display`/`21-night-atmosphere`/`03-actions`/`22-speech-attention` 双浏览器集成集 **40/40**（含夜景背景 + 氛围层同值滤镜、单次应用）。v2 静态口径更新为 **26 个 spec / 84 例**（83 + 1）。
E2E（大厅视口铺满，2026-09-22，维护方实测）：`26-lobby-viewport` 1 例（90/100/110% 缩放 × 320–3840 连续 sweeping、chromium CDP DPR 1/1.25/1.5/2、规则弹层宽度、房间操作）+ `03-actions`/`08-display`/`24-election-chat` 双浏览器集成集 **34/34**。v2 静态口径更新为 **27 个 spec / 85 例**（84 + 1）。UI 优化批次（#9–#16 共 8 个 PR）全部整合完毕。
E2E（v2.0.6-alpha 语音可靠性，2026-09-23，维护方实测）：`27-voice-delivery` + `18-voice-levels` 双浏览器 **14/14**；真实凭据 `16-voice` chromium **1/1（16.4s）**（真机入频道、远端电平、撤权）。v2 静态口径更新为 **28 个 spec / 90 例**。
已覆盖：T-01、T-03–T-17、T-19–T-30、T-34–T-50（引擎与驱动，含实验模式 T-49、天理莱莱可决胜票 T-50）、白天下令/窗口/编排冒烟（夜→日→夜）、T-48 终局复盘、实验模式房间（正式拒绝/实验开局/实验值落盘）、退出与解散、**语音许可策略（各窗口穷举 + 平票者开麦）与声网适配（token 签发/踢人/关房 REST）、语音 API（开关/大厅/开局/同步/推送/竞选发言候选获得发布权）**。
未覆盖（如实记录，详见 M4e 报告）：真实设备 WebKit/Safari 深度路径与麦克风（由阿真双设备人工验收补足）、"旧凭证重连"独立场景（单测 + 刷新/断网恢复间接覆盖）、媒体失败"文字继续"降级（单测/集成覆盖）。§15 的 Playwright/真实设备/容量验收已由 M4d 完成（见"下一步计划"M4d 记录）。

真实运行验证记录：
- 2026-09-16：`docker compose up -d` → /healthz 正常、创建房间、SQLite 落盘。
- 2026-09-16：容器内 socket.io-client 连接（会话 cookie）→ 收到 hello { gameId, playerId, roomCode }。
- 2026-09-16（M3d）：浏览器实机 13 人全流程（12 名脚本玩家 + 1 名浏览器玩家）：创建/加入 → 准备 → 开局 → 首夜 → 遗言/竞选/发言/投票/计票公示 → 第二夜 → 科研员出局终局 → 复盘（身份/时间线/交流）全通过；夜间同屏验证窗口倒计时与个人流；公屏发言经 Socket.IO 回显正常。
- 2026-09-16（M4c）：**服务器部署（Ubuntu + Docker + Cloudflare Tunnel 子域名）**：外网 `/healthz` 200、首页 200、未登录 API 401、Socket.IO 公网握手 200、浏览器恢复会话进入大厅正常；CI 链路（GitHub Actions → ghcr 镜像 → 服务器拉取更新）验证通过。
- 2026-09-16（M4b）：**本地真实 LiveKit 容器链路验证**（livekit-server v1.9.7 + deploy/livekit.yaml）：服务端启动正常；我们签发的凭证经 TokenVerifier 验证通过（roomJoin/canSubscribe、canPublish=false）；createRoom / syncRoom（空房间静默）/ closeRoom（含幂等 404 静默）全部工作。
- 2026-09-16（M4b）：**公网自托管可行性实测**：家宽出口 STUN 发现动态公网 IPv4（101.87.132.163）；Docker 内两种 compose 组合的 LiveKit nodeIP 均正确（本地 `127.0.0.1`+默认配置 / 公网组合自动发现公网 IP）。服务器实际启用仍需端口映射与 Tunnel 路由（RUNBOOK §7.2）。
- 2026-09-16（M4b）：**LiveKit Cloud 链路验证通过（服务器最终方案）**：以托管项目凭证完成——签发凭证经云端验证、云端 createRoom / syncRoom / closeRoom 全部成功、`wss://` 地址可直接作服务端管理地址（`VOICE_ADMIN_URL` 留空自动同值）。
- 2026-09-16（M4b）：**服务器实机语音验收通过**（阿真两台设备：电脑 + 手机 4G）：修复发布竞态后，竞选发言轮开麦成功、双设备互听正常；云端音轨与服务端权限均验证正确（服务器媒体方案 = LiveKit Cloud 托管）。
- 2026-09-16（M4b）：**服务器实机验收抓获并修复发布竞态**（详见踩坑）：Playwright 虚拟麦克风完整复现（夜间加入 → 竞选发言 → 修复前 `tracks:[]` 报错、修复后云端出现音频轨）→ 修复推送待服务器更新后由阿真复测。

## 下一步计划（细化）

### M3 白天与复盘前端 ✅ 已完成
- **M3a 白天引擎 ✅ 完成**（engine/day.ts + engine/stage.ts，22 测试，见测试状态）
- **白天流程实现定值（阿真已批准，2026-09-16）**：
  1. 夜间死亡的天理移交统一在白天流程的「天理移交」固定步办理（出局者遗言之后）；首日之前无天理（天理首日竞选产生），该场景只出现在第 2 天及以后
  2. 竞选投票过程仅显示已投人数，截止后一次性公示完整票型（同放逐）
  3. 竞选平票重投：候选=平票者、投票人=全体存活玩家、时长复用 vote(60s)、无额外发言；重投再平票无天理；0 票不重投直接无天理
  4. 发言轮天理指定窗口 45s（ability），超时按座位升序默认；指定方向 asc/desc（界面映射左/右）
  5. `timersSeconds` 新增 `tieSpeech: 45`（放逐平票者发言，R-44）
  6. 投票目标允许投自己（规则未禁止）；0 票/全弃票直接无人出局，不重投
  7. 遗言队列多人依次各 60s；遗言可主动结束；投票明细全部公开（票型公示含弃票者）
- **M3b 白天驱动与循环编排 ✅ 完成**（server/day-driver.ts + rooms 编排 + 白天命令 + 8 驱动测试）
  - 窗口排程：遗言/报名/候选发言/竞选投票/指定/发言/放逐投票/平票发言/移交；settle 同步结算
  - 提前结算：投票全员投完即结算；其余窗口到点自动推进（固定时长不提前关窗）
  - 编排：rooms 夜驱动 → 日驱动 → 夜驱动循环（终局停止）；`onComplete` 钩子（night/day 驱动新增/使用）
- **M3c 复盘 ✅ 完成**（visibility/review.ts + GET /api/review + 2 测试）
  - 终局后成员可读：全身份/最终生命/胜负/行动时间线（引擎全量事件）/全部交流（含死神加入前阵营房历史）
  - 未终局 403、无会话 401；不含密钥/凭证/调试数据
- **M3d 页面前端 ✅ 完成**（web/ + vite + express 静态托管 + Docker 构建集成）
  - 技术：React 19 + Vite 8（根 package.json，devDependencies）；web/tsconfig.json 独立 DOM 环境；`typecheck:web` + `build:web` 进 Dockerfile
  - 页面：入口（创建/加入）→ 大厅（2.5s 轮询对账）→ 对局主屏（座次/公告/仅你可见/窗口倒计时/行动面板/公屏）→ 复盘；Socket.IO 增量 + 重连全量对账；服务端 404（房间没了）自动回入口
  - 协议补充：GET /api/view 的 proposal（R-47 草稿：版本/目标/确认进度/锁定）与 hints（天理/当前发言者/候选座位）；night-driver.proposalState + day-driver 同名返回 null
  - 验收：浏览器实机 13 人全流程（见上）；夜间角色操作面板（守护/提案/查验/还魂曲）与阵营房 UI 未拿到对应角色，靠类型检查与代码审查覆盖
  - **验收中发现并修复生产崩溃**：day-driver 提前结算后原窗口定时器到点重复结算 → 引擎抛错进程退出；修复（所有到点回调加 phase 守卫）+ 回归测试（tests/day-driver.test.ts）

### M4 语音与部署（a/b/c 已完成；d/e 待做）

- **M4a 规则收尾 ✅ 完成**（2026-09-16）
  - T-50 补齐：天理莱莱可禁投时决胜票不生效 → 平票重判（含二阶段恢复票权的反事实证明）→ tests/engine-day.test.ts
  - T-17 / T-36 补齐：二阶段未翻牌莱莱可每晚可刺（跨夜保留使用记录仍可刺）；一阶段 2 魂灵 + 死神未失技 = 4 个攻击名额全部合法、不强制用满
  - **实验模式（R-54 / T-49）落地**（阿真拍板"API 级 + 大厅横幅"）：`POST /api/rooms` 可传完整 ruleset（`validateRuleset` 校验；正式模式变体拒绝）；`GET /api/view` 加 `rulesetMode` / `requiredPlayers`（大厅与对局两种形态）；房主板子快照落 SQLite（log-store 新增 `rooms` 表）；前端大厅"实验模式"醒目横幅；房间全流程使用自己的板子（`Room.ruleset`）
- **M4b 语音 ✅ 代码完成**（2026-09-16；阿真拍板 LiveKit + 平票者发言开麦）
  - `voice/policy.ts`：R-43 许可穷举（遗言者/当前候选/当前发言者/平票发言者；竞选投票、放逐投票与重投、夜间、晨间结算、指定与移交窗口全禁；死者仅旁听）；`voice/livekit.ts`：短期凭证（30 分钟、canPublish=false 由服务端动态授予）、`syncRoom`（listParticipants 差异更新 updateParticipant）、`closeRoom`（幂等 404 静默）
  - `server/rooms.ts` 每次推进后 fire-and-forget 同步媒体权限（失败只记日志，不影响胜负/计时），终局 closeRoom；`server/realtime.ts` 通过个人频道推送 `voice_permission`；`server/app.ts`：`POST /api/voice/token`（未启用 409 voice_disabled、未开局 409、限流）、`POST /api/voice/sync`、视图 `voice.enabled/permission`
  - 前端 `web/src/voice.tsx`：加入/离开、连接与重连状态、许可原因提示、本地静音（流程切换不强迫取消）、设备选择、死者旁听、失败重试；未启用/失败显示「文字测试模式」；`voice_permission` 事件驱动 + 2.5s 视图对账兜底
  - 部署：compose `livekit` 服务（v1.9.7 锁定、`profiles: ["voice"]`、7881/TCP + 7882/UDP）；**双配置**：`livekit.yaml`（本地/局域网，`use_external_ip: false` + `LIVEKIT_NODE_IP` 经 sh 条件传 `--node-ip`）/ `livekit-public.yaml`（服务器公网，`use_external_ip: true`，`LIVEKIT_NODE_IP` 留空由 **STUN 自动发现动态公网 IP**），`.env` 用 `LIVEKIT_CONFIG_FILE` 选择；`.env.example` 与 install 脚本生成 LiveKit 密钥；**`COMPOSE_PROFILES=voice` 写在 .env 即随 `--env-file` 生效**（脚本零改动）
  - **服务器方案（2026-09-16 定案）**：家宽虽有动态公网 IPv4/IPv6（STUN 实测），但光猫端口映射受阻 → **服务器采用托管媒体 LiveKit Cloud 免费层**（阿真拍板；连接器与信令域名由部署者自行配置）；自托管代码保留，适用于本机/局域网/有公网入站场景。**云链路已实测**：签发凭证经云端验证、云端 createRoom/syncRoom/closeRoom、`wss://` 直接作为服务端管理地址均通过。托管凭证只入服务器 `.env`（不入库）
  - **验收结论（已完成）**：服务器外网实机语音（阿真两台设备：电脑 + 手机 4G；加入语音、竞选发言轮开麦、双设备互听）；M4d 自动化覆盖：夜间禁麦、发布自动重试回归、权限收回（竞选发言结束）、退出与刷新恢复
- **M4c 部署与运行手册 ✅ 完成**（2026-09-16）
  - 交付：`deploy/install|start|stop.{ps1,sh}`（首次与日常分开；.env 随机密钥生成；优先拉预构建镜像、回退本地构建）；`deploy/update.{ps1,sh}`（拉 ghcr 镜像更新，约 1-2 分钟）；`deploy/RUNBOOK.md`（系统要求/安装/启停/公网入口/数据日志/秘密注入/故障排查/不承诺）；`README.md`
  - **CI 镜像流程**：`.github/workflows/release.yml`（push main → 构建（镜像内含全部测试）→ 推 `ghcr.io/azhen073/theater-death:latest`；gha 层缓存后约 1 分钟）；镜像包已设公开（服务器匿名可拉）
  - **大厅退出 / 解散**（阿真要求补齐）：`POST /api/rooms/:code/leave`——普通成员释放席位（可重新加入）、房主解散全房间、对局开始后 409 拒绝；成功即清会话 Cookie；前端按钮 + 解散确认弹窗
  - **服务器部署与外网验证**：部署到阿真的 Ubuntu 服务器，Cloudflare Tunnel 路由（面板操作用 webclaw）指向 `localhost:3000`；外网验证：/healthz 200、首页 200、未登录 401、Socket.IO 公网握手 200、浏览器会话恢复进大厅
  - **取消项**：玩家电脑托管的 cloudflared 本机快速隧道验证（阿真决定聚焦服务器部署，相关文档内容已删）
- **M4d 浏览器与容量验收（§15）✅ 完成**（2026-09-16）
  - **交付**：`e2e/`（01 冒烟 / 02 语音 / 03 越权 / 04 全流程 / 05 恢复 / 06 泄漏 + bot/云断言 helpers + capacity.mjs）；`deploy/Dockerfile.e2e`（`mcr.microsoft.com/playwright:v1.63.0-noble` 版本锁定）+ compose profile `e2e`（app + 自托管 livekit + runner，**不依赖云凭证**；livekit 服务挂 `["voice","e2e"]` 两档 profile）；`deploy/e2e.env`（测试固定值，无真实秘密）
  - **关键机制**：runner 与 app **共享网络命名空间**（`network_mode: service:app`），浏览器访问 `http://localhost:3000`（localhost 天然安全上下文，避开非 localhost 的 Chromium HTTPS-First 升级）+ `--unsafely-treat-insecure-origin-as-secure` 使用虚拟麦克风；两套实验板（FAST/VOICE——验证器只要求时限为正数）加速功能用例，正式板用于容量；浏览器复盘渲染用 cookie 注入（`td_session`）
  - **运行**：`docker compose -f deploy/docker-compose.yml --env-file deploy/e2e.env --profile e2e run --rm e2e npx playwright test`（开发迭代可挂载 `-v "…/e2e:/src:ro"` + `cp -r /src/. /e2e/`）；报告/截图/trace/容量结果落 `e2e-results/`（已 gitignore）
  - **结果（2026-09-16 全量重跑）**：**14/14 通过（17.9 分钟）**——chromium 10 用例（12 上下文全角色 UI 覆盖 4.5 分钟、13 机器人终局复盘 2.5 分钟、语音发布自动重试回归、夜间禁麦、越权×2、刷新/断网恢复、泄漏检查）+ webkit 4 用例（12 上下文流程 5.9 分钟、恢复类）；UI 行动统计覆盖守护/刺杀/提案/查验/还魂/竞选/发言/投票/升序指定全面板；刷新恢复、断网重连均验证
  - **容量（正式板，D1 夜 → D2 夜）**：完整日夜循环 **219.8s**、419 条命令、p50 2ms / p95 16.5ms / max 52.7ms；app 容器峰值 CPU 4.81%、常驻 61–67MiB；livekit 常驻 ~17MiB（宿主 `docker stats` 采样）
  - **发现并修复生产级崩溃（E2E 收获）**：天理在指定窗口内提前指定发言顺序后，该窗口旧超时定时器仍触发 `startDefaultSpeechRound` → 引擎拒绝（"发言轮已经开始"）→ 未捕获异常 → **Node 进程退出、容器重启、房间全丢**（全量 E2E 首跑实际触发）。修复：`scheduleWindow` 切换窗口时 `clock.cancel` 旧定时器 + 指定窗口超时回调补 `phase` 守卫；复现测试 `tests/day-driver.test.ts`（先红后绿）→ **187 单测全过**
  - **未覆盖（M4e 报告如实列出）**：真实设备 Safari 深度路径（阿真双设备人工验收已补足）；"旧凭证重连"由单测（凭证固定 canPublish=false）+ 会话内重连/刷新用例间接覆盖；媒体失败"文字继续"降级路径由单测/集成覆盖
- **M4e 收官报告 ✅ 完成**（2026-09-16）：`M4_ACCEPTANCE_REPORT.md`（§15 交付格式：版本/环境/命令/统计/覆盖矩阵/真实设备/时间线/实验模式/未覆盖/证据路径/发现的问题）；时间线产物脚本 `e2e/timeline.mjs`（13 机器人整局 + 复盘落盘，8 天 284 事件）
- 项目状态：**M1–M4 全部里程碑完成**。遗留动作：服务器应用崩溃修复镜像（见"接续指引"第 3 条）

### 观战：绑定玩家只读第二屏 ✅ 完成（2026-09-17，需求 v1.2 增补）

- **产品模型（阿真拍板）**：观众绑定一名玩家，看到**该玩家的完整视角**（含身份与私有信息）；每名玩家最多一名观众（双向 1:1）；昵称必填；大厅/对局/终局均可加入；只读 + 语音只旁听
- **服务端**：`SessionPayload.kind='spectator'`（playerId 即 spectatorId）；`Room.spectators`（`watchRoom`/`removeSpectator`；玩家离开大厅时其观众一并清理；`startGame` 与 `members` 不受影响）；端点 `POST /api/rooms/:code/watch`、`POST /api/spectate/leave`、`GET /api/rooms/:code/members`（公开：昵称/座位/存活/是否已有观众，无身份字段）；`resolveViewer` 分流——`/api/view`、`GET /api/chat`、`/api/review`、语音凭证按**绑定玩家**处理，`/api/command`、`POST /api/chat`、`/api/voice/sync` 观众一律 403 `spectator_readonly`；视图响应新增 `spectating` 标记与 `spectators` 名单
- **实时**：观众 socket 只入公共频道 + 绑定玩家的个人频道（与绑定玩家收同一事件流）；`hello` 带 `kind`/`spectatorId`；语音许可事件照发（前端旁听模式忽略）
- **语音**：观众 token 按 spectatorId 签发（identity 唯一，不与玩家冲突）；`SPECTATOR_PERMISSION = { canPublish:false, reason:'spectator' }`；`syncRoom` 对未知 identity 默认 false，观众天然不受影响；前端 `VoicePanel` 旁听模式（不调 voiceSync/不申请麦克风/无静音与设备选择）
- **前端**：入口页"观战（只看不玩）"→ 拉公开名单 → 选择绑定目标 → 观战；大厅只读横幅 + "退出观战"；对局屏复用玩家视图渲染（`绑定玩家的身份`/`仅绑定玩家可见` 标题、无行动面板、聊天 `观战只读`）；顶栏"观战"标签；终局后观众可看同一份复盘
- **测试**：`tests/spectator.test.ts` 7 例（加入守卫/视图一致/只读/读取范围/人数与离开清理/入口名单/复盘/实时同流）；E2E `07-spectator.spec.ts` 2 例（大厅只读 + 对局中一致性/终局复盘，含 bot 快进）；**194 单测 + E2E 16/16**
- **E2E 驱动修复（重要教训）**：12 上下文用例在容器负载下从 ~5 分钟漂移到 13 分钟——根因是 `actFollowing` 的 `.click()` 无超时（默认 30s），视图 2.5s 轮询下按钮消失即空等 30s；修复：点击统一 3s 超时快失败 + 初始化与主循环并发化（覆盖强度不变）

### 房主踢人 ✅ 完成（2026-09-17，需求 v1.3 增补）

- **产品模型（阿真拍板）**：踢人仅未开局大厅期（对局中角色/胜负不存在被移出场景）；被移出者**释放席位、可重新加入**（清位语义，不做拉黑/冷却）；房主**可单独移出观战者**且不限阶段（观战不影响对局）；房主不能移出自己（提示用解散）
- **服务端**：`RoomRegistry.kickMember`（state 守卫 409 / 自我 409 cannot_kick_self / 目标 404 / 移除成员 + 连带其观众）与 `kickSpectator`（404 not_a_spectator）；成员移除与观众清理抽出共用私有方法（leaveRoom 复用）；`POST /api/rooms/:code/kick`（房主校验 403 not_host；body 恰好一个 targetPlayerId / targetSpectatorId，否则 400）；被动移除无需吊销会话（无状态 cookie + membership 校验兜底），`not_member` 文案统一“你已不在该房间中”
- **语音清理**：`voice/livekit.ts` 新增 `removeParticipant`（幂等 404 静默，同 closeRoom 模式）；用于移出观战者与**观战者主动退出**（修复其媒体参与者不被回收、token 挂 30 分钟的问题）；大厅期无语音凭证，踢玩家无语音残留
- **前端**：大厅成员行（房主、非自己）「移出」+ `window.confirm`；成员行下缩进列出观战者（数据已在 `lobby.spectators`），房主可单独移出；`loadView` 错误处理扩展——`not_member`（含 403）同样回入口页并显示服务器消息（原先只处理 401/404，被移出者会卡在旧界面）
- **测试**：`tests/server-api.test.ts` 踢人 7 例 + 语音移除 2 例、`tests/voice-livekit.test.ts` removeParticipant 1 例；E2E `08-kick.spec.ts` 2 例（踢成员→对方回入口→重进；踢观战者）；**204 单测 + E2E 18/18**

### 实验模式板子编辑器 ✅ 完成（2026-09-17，需求 v1.4 增补）

- **产品模型（阿真拍板）**：入口页「自定义板子…」编辑器，**只改角色数量**（其余参数固定默认板）、不本地保存、每次重编；已建房的板子照旧落服务器数据库
- **实现**：`web/src/board-editor.tsx`（分组 ± 调节、分组小计与总人数、实时校验、恢复默认、昵称内嵌）；创建时 mode 强制 experimental + version 'custom'；**直接复用 `rulesets/validate.ts` 与 `THEATER_DEATH_13`**（前端与服务器同一份校验逻辑；vite root 外引用 OK，dev 需 `server.fs.allow: ['..']`）；`api.createRoom` 加可选 ruleset；服务端零改动；神职/科研员/死神/丧亲者 UI 硬限 1
- **测试**：E2E `09-board-editor.spec.ts` 1 例通过（默认 13→改 10→制造非法看错误与禁用→恢复→创建→大厅横幅与"满 10 人"）；单测 204 不变；**全量 E2E 未跑**（阿真新测试策略：默认增量，全量等指令）

### 终局退出 ✅ 完成（2026-09-18，需求 v1.5 增补）

- **产品模型（阿真拍板）**：只放开**终局后**退出；对局进行中（夜/晨/昼）仍 409 `game_started`——13 人板的胜负、失技阈值、遗言与票权都绑定 13 个席位，中途退出无规则依据
- **终局语义**：任何人（含房主）退出都只**释放自己的席位**；房主退出**不解散**（其他成员照旧查看复盘）；**最后一名成员退出时房间销毁**（双索引删除，顺带缓解终局房间常驻内存）；退出即清会话 cookie，且房间已开局不能重新加入 → 等于放弃该局复盘访问（界面确认弹窗明示）
- **服务端**：`server/rooms.ts::leaveRoom` 守卫改为“非终局才拒绝”（`state !== null && state.phase !== 'ended'`）；终局分支走“移除成员（连带其观众）+ 空房销毁”；大厅语义（房主=解散）不变。`server/app.ts` `/api/view` 对局形态新增 `roomCode`（前端调 leave 需要；大厅形态本来就有）
- **前端**：`web/src/game.tsx` 终局卡片改为「查看复盘 / 退出房间」两按钮（观战者不显示后者，走既有「退出观战」）；`web/src/app.tsx` 新增 `leaveRoom` 回调（镜像 `leaveSpectate`：调 `api.leaveRoom(roomCode)` → 清 session/事件/聊天/复盘/语音 → 回入口页）
- **测试**：`tests/server-api.test.ts` +3 例（终局后成员退出且他人复盘保留 / 房主退出不解散 / 最后一人退出销毁房间），该文件 24→27 例；E2E `10-end-exit.spec.ts` 2 例（对局中退出被拒 409；终局退出回入口页 + 他人复盘保留，含 13 机器人快进）
- **真实运行（2026-09-18）**：容器内 `docker compose -f deploy/docker-compose.yml build` exit 0（typecheck + typecheck:web + 18 文件 207 例全过 + vite build，镜像 sha256 `ff8ec7dc…`）；增量 E2E 只跑 `specs/10-end-exit.spec.ts` → **2 passed (3.2m)**；其余用例未跑（按测试策略）
- **E2E 用例口径提醒**：静态清点为 17 个 `test()`（chromium 全跑 17 + webkit 匹配 04/05 各 2 = **21 次运行**）；`AGENTS.md` 此前记的「18/18」与静态清点差 1，未跑全量故未定论，需要时以一次全量运行核对。**（2026-09-20 结论）** 口径已核实：本节当时确实是 17 个 `test()` / 21 次运行；其后新增 `specs/11-dissolve.spec.ts`，v1 入口现为 **18 个 `test()` / 22 次运行（chromium 18 + webkit 4）**，v2 入口为 16 个 spec / 42 例，`AGENTS.md` 已按此更新。**（2026-09-21 更新）** 该口径此后继续变动：PR #5 整合后 v2 为 16 个 spec / 47 例，新增 `specs-v2/17-last-words.spec.ts` 后为 **17 个 spec / 49 例**；当前数字以本文件「测试状态」一节为准。

## 提醒事项（踩坑记录）

- `NODE_ENV=production` 会跳过 devDependencies → Dockerfile 用 `npm ci --include=dev`
- Docker Hub 直连超时 → 已配 registry-mirrors；npm 用 npmmirror
- 测试构造状态时注意字面量类型：`life: 'dead' as const`，避免宽化为 string 报 TS 错误
- 引擎事件 `committedAsDeath` 等字段更新后务必合并回 night 上下文（曾漏过一次，被测试抓到）
- **大文件写入后立即校验结构**：曾发生 server/app.ts 被混入草稿（语法检查报错行号远超声明行数即征兆）→ 用行数 + 关键符号唯一性（grep `export function createApp`）快速自检
- 测试用假时钟推进夜晚时，`advance(90_000)` 后段一回调同步跑完并开启段二，此时提交段一命令的 code 是 `window_not_open` 而非 `window_closed`（语义区分：同段超时 vs 跨段迟到）
- 容器内可直接用 socket.io-client 做真实连接验证（devDependencies 已装）：`docker compose exec -T app node --input-type=module -e "..."`
- **编排坑**：night-driver.start 内部已调 startNight，rooms 的 onComplete 里不要再手动 startNight 一次（会报"当前状态不能开始夜晚"）
- 白天投票的提前结算是"全员有效投票人已投"，超时结算走窗口回调；两者都进同一条 apply→openNext 路径（避免状态机分叉）
- 跨阶段命令（白天提交夜间命令等）统一由驱动 default 分支返回 `window_not_open`，未知 action 在网络层（toGameCommand）返回 400
- **座位是随机分配的**：测试与脚本不要用"座位号 → 角色"的假设（helpers 的 DEFAULT_SEATS 仅用于纯引擎单测状态构造）；服务端集成测试一律用 roleId 找玩家（review 测试曾因按座位刀人误杀死神而失败）
- API 错误响应结构为 `{ error: { code, message } }`（fail 函数），命令回执则是 `{ requestId, status, code, message }`
- **定时器回调必须带 phase 守卫 + 窗口切换必须取消旧定时器**：day-driver 曾因"投票全员投完提前结算 → 原 vote 定时器到点再次结算"崩溃（M3 修 + 回归）；**2026-09-16 M4d E2E 全流程又发现 speech_order 的漏网之鱼**：天理提前指定后旧定时器触发 `startDefaultSpeechRound` → 引擎拒绝 → 未捕获异常 → **Node 进程退出、容器重启、房间全丢**。系统性修复：`scheduleWindow` 每次切换窗口 `clock.cancel` 旧定时器（白天同一时刻只有一个窗口，可安全取消）+ 该回调补守卫；回归测试 `tests/day-driver.test.ts`。**教训：同类"到点回调"审查要一次性覆盖所有窗口，不要逐个等 E2E 抓**
- 前端构建纳入 Docker 构建链：typecheck（根）→ typecheck:web → 测试 → vite build；web/dist 由 express 静态托管（SPA fallback 排除 /api、/healthz、/socket.io）
- 前端引入后：vite 相关依赖加进根 package.json 的 devDependencies（lock 由容器更新）；web 的类型检查用独立 tsconfig（不要并入根 tsconfig 的 node 环境）
- 本地联调脚本经验（PowerShell 5.1）：Invoke-RestMethod 不能通过 -Headers 传 Cookie（受限头被静默忽略）→ 用 WebRequestSession + CookieContainer；发送中文 JSON 用 UTF-8 字节数组（`Invoke-WebRequest -Body $bytes`），否则昵称乱码
- **窗口固定时长是刻意的防泄露设计**（2026-09-16 决策：不做"无事可做提前结束"）：需求明文"不因隐藏角色死亡、失技或提前确认产生可识别的时长变化"；随机 15–20s 只能模糊秒数、隐藏不了窗口明显变短；逐窗口复核无安全缩短场景（并行窗口 + 技能使用状态保密，水妖回归窗口与还魂曲独立不存在空转）
- **Windows 提交的 `.sh` 会丢可执行位**（100644）→ `git update-index --chmod=+x deploy/xxx.sh`（install/start/stop/update 均已补；以后新脚本一律补）
- **CI flaky 教训**：跨连接的时序断言要 `waitFor` **双方条件都满足**，不能等完 A 同步断言 B；"不该收到"的反向断言留 ~200ms 缓冲（本地快掩盖、CI 高负载暴露）；tests/realtime.test.ts 已按此修
- **中文不要用 `writing-mode: vertical-rl`（2026-09-27 实测，容器 Chromium）**：镜像内 CJK 字体只有 WenQuanYi Zen Hei / Unifont，**缺竖排度量** → 竖排 CJK 的盒高恒为 **0**（9/24/48px 都如此，`Range` 的 ink 盒也为 0），多个汉字**重叠在同一位置**，界面上只看得到一个字；拉丁竖排正常（24px → 32×28.3），横排 CJK 正常（9px → 18×13）；加 `height` / `line-height` / `text-orientation: upright` 都修不好。座位徽标因此改为横排 chip（`BadgeStrip`），并对「盒高 > 0」补了 E2E 回归断言。
- **禁止用 PowerShell 文本 cmdlet 改源码（2026-09-27 再次踩中）**：`(Get-Content -Raw) -replace … | Set-Content -Encoding utf8` 会把该文件的**所有非 ASCII 变成乱码**并加上 BOM（本次毁了 `web-v2/src/features/game/stage.tsx`，靠 `git checkout --` 恢复重做）。改源码只用 `edit` / `write` 工具；确需批量替换时用 Node（显式 `utf8`）并在改后核对：`node -e "…BOM/replacement 字符/关键中文串…"`。
- **ghcr 包默认私有**：GITHUB_TOKEN 推送的容器包需改公开（网页 Settings → Change visibility）；gh CLI 令牌缺 packages scope 时无法用 API 改
- **以下 LiveKit 条目（至"浏览器端语音复现方法"）为 M4b 阶段历史记录；2026-09-19 起语音已替换为声网**
- **LiveKit 部署要点**（M4b）：浏览器必须直连媒体端口（7881/TCP、7882/UDP），HTTP 反代/隧道只能承载网页与信令；NAT 后服务器用托管媒体（Cloud `VOICE_SERVICE_URL=wss://xxx.livekit.cloud`，`VOICE_ADMIN_URL` 留空自动同值）；自托管镜像锁定 `livekit/livekit-server:v1.9.7`；`rtc.udp_port` 单端口复用简化端口暴露（config 里不要同时设 port_range）；Docker Desktop 下启动有 UDP buffer 警告（非致命）
- **compose `COMPOSE_PROFILES` 可来自 `--env-file`**：`.env` 里 `COMPOSE_PROFILES=voice` 即让所有 compose 命令（pull/up/stop）自动包含 livekit 服务，无需改脚本；未启用语音时不写该行则只有 app 服务
- LiveKit 凭证 JWT 用 `nbf`（非 `iat`）表示签发时间；`AccessToken.toJwt()` 为异步；`updateParticipant` 的 permission 是整体覆盖，切权限时必须带全 canPublish/canSubscribe/canPublishData
- **LiveKit `--node-ip` 不覆盖配置里的 `use_external_ip: true`**（实测显式 node-ip 仍被 STUN 结果覆盖）→ 本地（要 127.0.0.1）与公网（要 STUN）必须用两份配置：`livekit.yaml` / `livekit-public.yaml`，由 `.env` 的 `LIVEKIT_CONFIG_FILE` 选择
- **Playwright 点击必须带超时（观战任务教训，2026-09-17）**：E2E 快语速板下视图 2.5s 轮询，按旧视图点已消失的按钮时 `.click()` 默认等 30s；12 上下文用例每轮若命中数次，240s 主循环被拖成 13 分钟并超时。驱动点击统一 `{ timeout: 3000 }` + 外层 catch 跳过（`actFollowing`）
- **观战（v1.2）设计要点**：观众是"绑定玩家的只读第二屏"（信任模型——可见绑定玩家全部信息）；1:1 双向绑定（每玩家最多一名观众）；所有写操作在 HTTP 层 403 `spectator_readonly`；观众计入 LiveKit 计量；同浏览器"玩+看"互斥（单会话 cookie，观战需无痕/另一设备）；换绑 = 退出观战重进
- **踢人（v1.3）设计要点**：踢人 = 清位（被移出者释放席位、可立即重新加入，无黑名单/冷却——朋友局信任模型）；仅大厅期可移出成员，观战者不限阶段；被移除者的清理路径 = 无状态会话无法吊销 → membership 校验 403 `not_member` + 前端 `loadView` 回入口页（新增"被动移除/被动失效"场景必须走这条路径，不要只改服务端）
- **测试策略（阿真要求，2026-09-17，翻车后反思）**：默认只跑**增量测试**（相关单测文件 + 相关 E2E spec）；**全量回归只在阿真明确要求时跑**，不要"顺手"跑全量——测试慢、阿真等待成本高；构建 app 镜像时 Docker 构建链内部跑全部单测属于构建必要部分；汇报如实写明跑了哪些、没跑哪些
- **板子编辑器（v1.4）设计要点**：前端直接引根目录 `rulesets/*`（同一份校验器与默认板，不漂移）；vite `root: 'web'` 下需 `server.fs.allow: ['..']`（dev）；build 无限制；改板只改 `roles` 计数，其余沿用默认板；`mode` 恒为 experimental（大厅横幅自动出现）
- **compose 的 sh 条件传参**：字符串形式 `command` 会被 split 成参数数组（不经 shell）→ 必须用数组形式 `command: ["exec ... $${VAR:+--node-ip $${VAR}}"]` + `entrypoint: ["/bin/sh","-c"]`；且 **`$${VAR:+...}` 读的是容器内环境变量**，compose 变量必须显式注入 `environment`（`LIVEKIT_NODE_IP: "${LIVEKIT_NODE_IP:-}"`）
- LiveKit 1.9.7 无 `--rtc.use-external-ip` 类 CLI flag（只认配置文件）；`--node-ip ""` 空串报 `flag needs an argument`
- **LiveKit 发布权限竞态（M4b 实机验收抓获 + 已修）**：服务端广播 `voice_permission`（Socket.IO，即时）与同步媒体权限（LiveKit admin API，异步）并行，前端在权限于媒体服务落地前调用 `setMicrophoneEnabled(true)` 会被拒（`insufficient permissions to publish`），且旧版把错误静默吞掉 → 表现为"连接正常但谁都没声音、云端 `tracks: []`"。修复：失败自动重试（≤8 次 × 800ms）+ 监听 `RoomEvent.ParticipantPermissionsChanged`（注意签名 `(prevPermissions, participant)`、属性是 `participant.permissions` 复数）触发重发
- **浏览器端语音复现方法（Playwright + 虚拟麦克风）**：`chromium --use-fake-device-for-media-stream --use-fake-ui-for-media-stream`，1 浏览器 + 12 脚本玩家组 13 人局；脚本在 `temp\td-e2e\repro-voice.mjs`（含云端 admin API 校验 tracks/permission）；断言点=云端 `tracks` 出现音频轨（本地 HTTP 服务需重新 `vite build` 才生效）
- **声网替换（2026-09-19，动因：LiveKit Cloud 大陆跨境连接每次十几秒）**：权限模型 = 「连麦鉴权」开启后发布权编码在 AccessToken2 中——加入凭证为订阅角色（可听不可发）；获得发言权由服务端在状态推进时下发**含发布权限、短 TTL（默认 10 分钟，覆盖最长 90s 窗口）**的 token（**注：v2.0.6-alpha（原 v2.0.4-beta）起默认 TTL 已收紧为 150 秒，见该版记录**），前端 `renewToken` 即时生效；收回 = 下发订阅凭证即时降权 + TTL 到期兜底（声网**没有**"服务端实时改权限"API，强制力弱于 LiveKit，靠短 TTL 兜底）。踢人/关房走频道管理 REST（`POST /dev/v1/kicking-rule`：`join_channel` + `time=0` = 一次性踢出可立即重进，语义与"踢人不拉黑"一致；不带 uid = 踢出频道全员，用于终局关房）。uid 分配：玩家=座位号（1-13）、观战者=1000+顺序号（保存在 `RoomSpectator.uid`）。AccessToken2 内容体为压缩编码，离线无法断言权限位（联调实测）。
- **声网集成要点**：REST 鉴权 `Authorization: Basic base64(AppId:AppCertificate)`；中国区接入点 `api.sd-rtn.com`（国际 `api.agora.io`）；npm 包 `agora-token`（服务端签发，导出名 `RtcRole` 而非文档源码里的 `Role`）+ `agora-rtc-sdk-ng`（前端）；`createClient` 的 `codec` 参数是视频编解码器（必填、与音频无关）；频道查询 API 只有"在不在频道"（无发流/权限状态）→ E2E 语音断言降级为"频道在线 + 界面文案 + 无麦克风错误"（见 `e2e/specs/02-voice.spec.ts` 注释）。
- **声网计费**：免费层每月 1 万分钟（按"人×分钟"，13 人 1 小时局约 780 分钟 ≈ 12 局/月），超出 7 元/千分钟；控制台开启「连麦鉴权」是发布权控制生效的前提。
- **声网凭据获取（2026-09-19 实操）**：控制台里 App ID / App 证书均掩码显示——App ID 可点复制图标获取（或用控制台 API `GET /dev/v1/projects` 的 `vendor_key`，本次实测该 API 可用）；**频道管理 REST 用「客户 ID + 客户密钥」基本认证**（控制台「设置 → RESTful API → 添加密钥」，**仅可下载一次** `key_and_secret.txt`），不是 App 证书——`.env` 需 `AGORA_CUSTOMER_KEY/SECRET`；「连麦鉴权」在「全部产品 → 实时互动 RTC → 功能配置」启用（**开启后不可关闭**，约 5 分钟生效）。
- **Node ESM 与 CJS 包（翻车教训）**：`agora-token` 为 CommonJS 包——**vitest 通过不代表 Node 原生运行通过**：命名导入在 vitest（Vite 转换）下能解析、在 Node 原生 ESM 下报 `does not provide an export named 'RtcRole'` 并导致服务启动崩溃。修复：default 导入后解构 + `.d.ts` 声明 default 导出。**教训：改依赖加载方式后用 Node 原生方式实测（`node --input-type=module -e "import('./voice/agora.ts')..."`），不能只信单测。**
- **声网链路实机验证（2026-09-19）**：E2E 语音 3 例全过（01 冒烟加入频道 + 02 发言授权/收回 + 02 夜间禁麦，1.3 分钟），浏览器经真实声网云完成加入与权限切换；本机 `.env` 已配置项目凭据（凭据不入库）。
- **前端产物**：引入 `agora-rtc-sdk-ng` 后单包约 1.86MB（gzip 524KB，vite 提示超 500KB）；单页应用可接受，如需优化可后续 code-split。
- **E2E 基础设施要点（M4d）**：runner 与 app 共享网络命名空间（`network_mode: service:app`）后用 `http://localhost:3000`——**非 localhost 的 http 会被 Chromium HTTPS-First 升级**（`--disable-features=HttpsFirstModeV2,...` 实测压不住，`ERR_SSL_PROTOCOL_ERROR`），localhost 天然安全上下文最稳；虚拟麦克风需 `--unsafely-treat-insecure-origin-as-secure`；`gameId` 只在**大厅视图**有（对局开始后 /api/view 不再返回）；复盘字段是 `players/timeline/winner`（不是 seats）；浏览器注入会话用 cookie `td_session`（`context.addCookies`）；compose 宿主端口冲突（3000 被占）→ `deploy/e2e.env` 用 `APP_PORT=3210`；用例间**不要 `some(async …)`**（async 回调恒真）；Playwright 镜像版本与 `@playwright/test` 精确锁定一致（1.63.0）
