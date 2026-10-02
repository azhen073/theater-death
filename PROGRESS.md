# theater_death 进度与交接

更新时间：2026-09-22 · 供上下文压缩（compact）后接续工作使用

## 当前状态

**版本 / 分支**：`2.0.7-alpha`（自 `816f904` = `origin/main` 拉出，**远端已有同名分支**；2026-10-02 本地追加 `94e9d57` 后领先 1 个提交，未推送）；UI 优化批次 #9–#16（8 个 PR）与 v2.0.1-beta–v2.0.6-alpha 均已合并进 main。本分支**全量单测已跑通（98 文件 730 例）**、**镜像已在本地重建（`ghcr.io/azhen073/theater-death:2.0.7-alpha`，未推送注册表）**、**未部署**。

### 已合并特性（功能 + 实现路径）

- **公开死亡粒子与头像常驻星芒**（`feat/public-death-effects` → main `9b94a65`）：公开死亡座位粒子 + 头像常驻星芒，纯前端、复用原合图、公开事件驱动；保留私密边界与重连基线，末次死亡公告可跨到复盘。详见 `docs/frontend-v2-death-effects-verification.md`。

- **公开阶段短转场**（`feat/ui-phase-transitions` → main `b784995`）：只读公开昼夜/轮/阶段，入夜「夜幕降临」、天亮「天光初现」、第二阶段「第二阶段开启」播 2.2s 幕布 + 时钟转场（复用原素材 + CSS）；`sessionStorage` 按 scope/轮/阶段去重，刷新/重连/后台/紧急行动/弹层/减少动画压制或取消且不补播；同批死讯先留窗口再补播。详见 `docs/frontend-v2-phase-transition-verification.md`。

- **发言聚焦与可选提示音**（`feat/ui-speech-attention` → main `4bf179a`）：公开发言者金色高亮 + 原素材光环 +「准备/正在发言」标签；「发言与提醒」条替换旧 `speaker-banner`（天理投票进度行保留），本人准备期突出倒计时与「提前开始发言」；提示音默认关闭、点击解锁、仅本页、刷新复位，公开阶段与本人发言各响一次（`sessionStorage` 去重、不补响），不碰语音权限链路。详见 `docs/frontend-v2-speech-attention-verification.md`。

- **上警名单与公屏可读性**（`feat/ui-election-chat` → main `3cf19c9`）：侧栏新增常驻「上警名单」卡（只用公开候选与公开座位，夜间/复盘不显示）；公屏消息改「N号 · 昵称」+ 字号/行距/历史区高度提升（样式限 `#panel-public`），聊天跟随/未读/分页/草稿逻辑未动。详见 `docs/frontend-v2-election-chat-verification.md`。

- **夜间舞台氛围**（`feat/ui-night-atmosphere` → main `7c426e5`）：只读公开夜晚状态叠银蓝夜景（原素材光晕 + 暗角 + 雾与飘尘），动效数秒后卸载只留静态层，按房间/局/轮去重（刷新/重连不补播），隐藏/离线/离场/减少动画停止；夜间座位与行动卡保持可读。详见 `docs/frontend-v2-night-atmosphere-verification.md`。

- **分阶段身份能力说明**（`feat/ui-phase-identity` → main `4d58eb0`）：九身份 × 两阶段规则摘要（带 R 条款与规则版本，标注「不代表此刻可行动，以服务端舞台任务为准」），只挂授权情报面板与「我的身份」弹窗，观众/错配不显示、第二屏标「当前观察视角」（硬编码文案，规则变更需同步）。详见 `docs/frontend-v2-phase-identity-verification.md`。

- **日间舞台加深与账户亮度**（`feat/account-stage-brightness` → main `67648d1`）：舞台背景改独立 `stage-backdrop` 层（亮度滤镜只作用布景，头像/文字/行动卡不受影响），日间遮罩减弱露出剧院纹理；账户「显示与动画」新增 50–130% 亮度滑杆 + 恢复默认（局内不出现），偏好 `stageBrightness` 本地保存（clamp/迁移安全），`--stage-brightness` 挂根元素。详见 `docs/frontend-v2-stage-brightness.md`。

- **大厅视口铺满与跨屏缩放**（`feat/lobby-viewport-fit` → main `d04125d`）：仅大厅相位 `max-width:none` + `clamp` 留白（阅读页保留 1280 上限），满高用 `calc(100svh / var(--display-scale, 1))` 补偿根 zoom，不猜测屏幕/DPR。详见 `docs/frontend-v2-lobby-viewport.md`。遗留：真实 Windows 物理双屏拖动未实测（留人工验收）。至此 UI 优化批次（#9–#16，8 个 PR）全部整合进 main。

### 2.0.7-alpha（进行中，贡献 kiahir；基线 `816f904`）

- **竞选投票阶段本人提示**：无资格者（候选 / 重投平票者 / 死者 / 票权冻结）给出原因，投票后给「已投给 N号 昵称 / 已弃票」；判定镜像 `engine/day.ts` 的 `submitElectionVoteIssue`（已退选按 R-42 恢复投票权、不提示），回执只认当前 `election_vote` 窗口；界面「上警名单」→「竞选名单」。详见 `docs/frontend-v2-election-vote-notes.md`。
- **提示音开关移入账户「显示与动画」**：持久偏好 `attentionSound`（默认关），局内任意手势自动解锁，未解锁时给一行可点兜底。
- **团队攻击合并为单按钮**：标签即载荷——未改草稿「同意方案 v(n)」、有目标「发布并确认方案」、本地目标为空「发布并确认空刀」（要先「清空选择」），空刀不再与方案并列；团队刀人目标改为点击切换（再点取消，`maxTargets`＝不同目标数上限），界面不再表达"同一目标多刀"，服务端/引擎/契约未改。
- **草稿与生效文案口径**：生效行「此刻截止会执行」→「窗口截止将采用」+ 三态依据（全队已确认这一版 / 没有全票版本，采用最后一份由在场成员提交的草稿 / 没有可采用的草稿）；空目标一律说「空刀」（`v{n} · 空刀（今晚不出刀）`、无生效版本「当前无草稿（空刀）」、最新草稿行同口径），「空选择」只留给本地选择为空。
- **草稿目标配色区分**：座位上「我的选择」＝浅蓝实线、「当前草稿目标」＝浅青虚线 +「草稿」角标（重合＝实线 + 浅青环），方案面板给图例、`aria-label` 补「在队伍草稿中」；删除 `night-atmosphere.css` 的夜间覆盖，三态改由 `main.css` 的 `--seat-selected*` / `--seat-draft*` 统一定义（描边 token `--seat-selected-line` / `--seat-draft-line`），不靠颜色单独承载信息。
- **契约文档维护**：`docs/openapi-v2.2.json` 的 voice/token 改为实现形状 `{appId, channel, uid, token}`、补 `/voice/receipt`、`/voice/webhook` 标 `deprecated`（未挂载）；`private.voice.delivery` 抽成共用 `VoiceDelivery`（审计项 ① 已修）。
- **公屏写权限档位（Q-10，规则 + 契约变更）**：公屏文字改为对局内所有阶段可写（覆盖 S2「夜间禁发」原裁定；夜间语音仍按 R-43 全静音）；房主建房时必须显式选择、无默认值、创建后不可改——`alive_only`（仅存活正式玩家可写，死者只读、本人遗言期仍可写）/ `everyone`（存活与死者全体）。实现：`contracts/v2.ts` 新增 `PUBLIC_CHAT_MODES`/`PublicChatMode` 与 `RoomSnapshot.room.publicChat`；`server/v2/app.ts` 的 `POST /rooms` 必填校验（缺失/非法 → 400 `invalid_public_chat`）；`visibility/chat.ts` 的 `canPostPublic(state, playerId, policy)` 改三档（`legacy_day_only` 为 v1 旧行为默认值），经 `server/capabilities.ts` 透传到 v2 快照与聊天路由；`web-v2` 建房表单新增必选「公屏权限」单选，大厅「本局规则」与侧栏公屏页签展示档位；同批「阵营交流记录」从「情报」移到「公屏」页签（未读圆点＝`unread.public + unread.faction`）。v1 入口仍「仅白天」（已知不对称）。详见 `docs/frontend-v2-public-chat-modes.md`。
- **死亡公告横幅与窄屏 HUD**：`.death-notice` 不再写死 `top`，改由 `GameScene` 用 `ResizeObserver` + rAF 节流把 HUD 当前下沿写入 `--hud-bottom`，CSS 用 `top: calc(var(--hud-bottom, 112px) + 8px)`（≤680px 为 HUD 之下全宽条）；≤680px 下滑 >120px 时 HUD 收成约 44px（只留阶段/倒计时 +「更多」，四操作移入面板、回顶展开，桌面永不收起），E2E `specs-v2/29-hud-compact.spec.ts`，点 HUD 操作前统一调 `helpers-v2/rooms.ts` 的 `revealHudActions(page)`。
- **白天「自由发言」阶段（Q-11）**：`POST /rooms` 必填布尔 `freeSpeech`（缺失/非布尔 → 400 `invalid_free_speech`）并冻结进本局规则（`timersSeconds.freeSpeech = 120`，引擎门控 `freeSpeechSeconds(state) !== null`）；每个白天在发言轮之后、放逐投票之前插入固定 120 秒、不提前结束；存活玩家可开麦（死者仍只订阅）、无「当前发言者」、`autoMic` 不自动开麦，界面按远端电平显示「谁在说话」并照常下发送达回执。落点 `rulesets/{types,theater-death-13-v2,validate}.ts`、`engine/{types,day}.ts`、`server/day-driver.ts`、`voice/policy.ts`、`server/v2/media.ts`、`contracts/v2.ts`；`PublicGameDTO.voice.uids`（Q-12 起移到顶层 `RoomSnapshot.voice`）；行动卡文案由 `web-v2/src/features/game/free-speech-note.ts` 覆盖（缺私有视图退回通用文案）。1.1 预设与 v1 入口没有该阶段。详见 `docs/frontend-v2-free-speech.md`。
- **座位徽标（BadgeStrip）**：抽出 `web-v2/src/presentation/badges.ts`（色调注册表 + 纯函数）、`components/badge-strip.tsx`、`features/game/seat-badges.ts`（顺序固定 身份 → 天理 → 魂灵），落点＝座位号行内、多徽标共用底色框按色调等分；身份徽标只在本人座位（第二屏同显，公开观众不显示），底色按阵营取 `--faction-human` / `--faction-death`（同一对变量供身份弹窗/开局身份卡/复盘 `.faction-tag`）；排版恒定单排 8px，≤359px 走两列网格。详见 `docs/frontend-v2-stage-ux.md` §4。
- **座位左下角「濒死」标记**：新增可选私有字段 `private.knowledge.dyingSeats`，由 `server/v2/view.ts` 的 `dyingSeatsFor()` 与 `engine/night.ts` 的 `dying_list` 授权逐条对齐（一阶段 + 夜间 + 名单已产生 + 本人在世；降临者全部、水妖仅未用还魂曲者；其余身份/二阶段/白天/本人已死亡/公开视图与观众省略该字段）；前端 `features/game/seat-dying.ts` 只读渲染左下角角标，`aria-label` 追加「，濒死」，不改公开 `alive`。详见 `docs/frontend-v2-stage-ux.md` §5。
- **大厅与复盘自由开麦（Q-12）**：大厅与复盘不属于对局 → R-43 只约束对局内（对局内链路未改）；仅正式玩家可发布、观众与第二屏只订阅、无房主开关/准备门槛/送达回执，复盘同样可开麦。新增独立房间频道 `l_<roomId>`（大厅 + 复盘共用，对局仍用 `gameId`）。实现：`voice/policy.ts` 新增 `roomVoicePermission`、新文件 `server/v2/room-voice.ts`（主体＝memberId）、`media.ts` 抽 `VoiceScope`（`matchScope`/`roomScope`）、顶层必有字段 `RoomSnapshot.voice = {channel,uids}`（移除 `PublicGameDTO.voice`）、`startMatch` 关房间频道、`releaseControl` 撤房间身份、对账覆盖双频道、`/voice/token` 的 `gameId` 变可选；客户端 `session.ts` 按 `scope` 切频道、`bar.tsx` 三相位渲染但只有对局内自动开麦、大厅成员卡「正在说话」光环。详见 `docs/frontend-v2-voice.md`。
- 未做：重投标题、`speechOrder`、候选徽标、进度行 aria；v1 入口保持「仅白天」旧行为（已知不对称）。

| 里程碑 | 状态 | 说明 |
| --- | --- | --- |
| 文档 | ✅ | 规则书 v1.1（含 Q-09 移交时机与规则 2.0 命名预设；合并版 `docs/rules-v2-full.md`）+ 需求文档 **v2.0.7-alpha**；Q-01–Q-08 全量定值（规则书第 09 章） |
| M1–M4 里程碑 | ✅ | M1 规则引擎与数据 · M2 文字闭环（引擎 + visibility + 夜间窗口驱动 + HTTP/Socket.IO）· M3 白天与复盘 + React/Vite 网页前端 · M4 语音与部署（发布竞态修复 + 双设备验收、服务器 + Tunnel + CI 镜像、**M4d** 容器化 E2E、**M4e** 收官报告 `M4_ACCEPTANCE_REPORT.md`，§15） |
| 增补 v1.2–v1.5 | ✅ | 观战（绑定玩家只读第二屏、语音旁听、复盘同权）· 房主踢人（大厅期移出成员/观战者）· 板子编辑器（只改角色数量 + 实时校验 + 强制实验模式）· 终局退出（释放席位、房主不解散、空房销毁；对局中仍 409） |
| 文档一致性整理（v1.9） | ✅ | 全仓库 24 个 md 逐项核对（LiveKit 残留、版本号与计数、失效链接、R-54 正文），**无玩法变更** |
| 解散与遗弃回收（v2.0.1-beta） | ✅ | 解散改**任意阶段**立即生效（仅房主，对局中按 `aborted` 记账）；房主离开＝大厅即解散 / 对局中暂离 / 复盘普通离开（房主继任）；大厅房主操作只留「解散房间」；遗弃房间 **24 小时回收**（v2 全员离线 / v1 无活动） |
| 语音媒体服务（LiveKit → 声网 Agora） | ✅ | 服务端签发短期 token（订阅/发布/降权）、前端 `agora-rtc-sdk-ng`、踢人走频道管理 REST；真实云联调与 E2E 语音通过；服务器更新待执行（见接续指引） |
| PR#3 / PR#5（贡献 syhneversigh） | ✅ | A 组公开知识泄露修复 + 目标与能力查询 + 加固模块；B 组天理夜死移交时机 + 规则 2.0 命名预设；D 组账号 / v2 房间模型 / `server/v2` / `web-v2` / 契约；PR #5 舞台行动 UX 与 `EDIT_PROPOSAL` 原子「发布并确认本人」（R-47 语义不变） |
| 2.0.2-beta / 2.0.3-alpha（贡献 kiahir） | ✅ | 遗言顺序明文化（R-45「同日多名出局者按座位号升序、每人 60 秒」，无行为变更）+ 账户「显示与动画」F2/F5 修复 + md 审计（未决 F1/F3/F4、`lastWords.firstNight`/`otherNights` 死配置）；局内语音音量显示与调节（`d669426`）：自己的 5 段电平、发言者「N号 正在发言 · X%」（静音时「已静音」）、输出音量 0–100 + 一键静音、麦克风增益 0–150（>125 关 AGC 并重建采集轨道），本地偏好受 R-43 时段门控；未实现座位卡电平环与每玩家音量 |
| 2.0.4-alpha（竞选投票资格修正 + 夜间公开时钟 + 死神知识 + 语音自动化） | ✅ | **规则变更 R-42**：候选与平票者不得投票、无投票人时无天理、退选恢复投票权（同步规则书 / `docs/rules-v2-full.md` / V2-02 / 目录夹具 / `electionVoters`）；`public.night.closesAt` 夜间公开时钟（只给当前段截止）；`private.knowledge.spiritSeats` + 座位「魂灵」徽标 + 身份弹窗「已知身份」；进对局自动加入语音（**Q-12 起大厅/复盘也自动加入房间频道，自动开麦仍只在对局内**）+ `autoMic` 轮到自己自动开麦；已进 main（`f2005ec`） |
| 2.0.5-alpha（开局身份揭示，贡献 syhneversigh） | ✅ | 正式玩家每局首次入场显示一次身份卡（`sessionStorage` 按房间/局/玩家去重；观战/第二屏/复盘排除；10 秒内行动优先）；已进 main（`8ea46ca`，保留 `7d4a40a`）；02 实验房间仍有既有 presence 断言失败 |
| 2.0.6-alpha（声网语音可靠性收口 + 送达回执 / 频道对账 + 凭据链补齐，贡献 kiahir） | ✅ | 已进 main（`20ccd06`）：媒体回收与 `enqueue` 队列可靠性、频道管理 REST 超时/退避重试、发布凭证 TTL 600s → 150s、客户端连接可靠性五类、`POST /voice/receipt` + `private.voice.delivery`（只下发当前发言者，界面「已送达 N/M」）、频道轮询对账（5 秒、只踢未知 uid，不使用 NCS）、部署面凭据链补齐与缺凭据降级、关房「官方调用 + 逐个补踢」；详见 `docs/proposal-voice-delivery-observability.md` |

## 接续指引（compact 后先读这里）

1. 读本文件 + `AGENTS.md`（项目规则与 Docker 约束）即可接上状态。
2. 规则细节查 `theater_death_rulebook_v1.1.md`（第 09 章 = S3 裁定）；
   工程规格查 `theater_death_development_requirements_v1.1.md`（最新 v2.0.7-alpha：v1.6 声网替换 · v1.7 规则 2.0 与移交时机 · v1.8 账号与 v2 体系准入 · v1.9 文档一致性整理 · v2.0.1-beta 解散与遗弃回收 · v2.0.2-alpha 舞台行动 UX 整合 · v2.0.2-beta 遗言顺序明文 + 账户显示设置修复 + 文档审计 · v2.0.3-alpha 局内语音音量显示与调节 · v2.0.4-alpha 竞选投票资格修正 + 夜间公开时钟 + 死神知识呈现 + 语音自动化 · v2.0.5-alpha 开局身份揭示 · v2.0.6-alpha 声网语音可靠性收口（媒体回收 / 发布 TTL / 客户端 / 送达回执 / 频道对账）+ 真机验收与鉴权实测 · v2.0.7-alpha 竞选投票阶段本人提示（无资格说明 / 投票回执）+「上警名单 → 竞选名单」重命名 + 团队攻击单按钮 / 点击切换 / 草稿配色昼夜一致修正 / 空目标一律说「空刀」+ 公屏写权限档位（Q-10）+ 白天自由发言阶段（Q-11）+ 座位徽标体系（BadgeStrip / 阵营配色 / 恒定单排 8px / 本人身份徽标）+ 座位「濒死」标记（私有 `private.knowledge.dyingSeats`）+ 大厅与复盘自由开麦（Q-12），见文末版本记录）。
3. 历史迁移断点（2026-09-19，PR#3 移植，外部贡献 syhneversigh）：A 组公开知识泄露修复（`visibility/knowledge.ts` 先裁剪后发送）+ `engine/targets.ts` 目标查询 + 加固模块；B 组天理夜死移交时机对齐 R-46/T-40 字面 + 规则 2.0 命名预设 `THEATER_DEATH_13_V2`；D 组账号体系 / `server/rooms.ts` 稳定房间模型 / `server/v2` + `contracts/` + `web-v2/` + `e2e/specs-v2/` 准入，v2 语音改造为声网（uid 稳定映射 + token 权限模型），旧 LiveKit 残留已删除。**入口切换**：镜像默认启动 v2 体系与新前端（`server/index.ts` 分发、`server/legacy-index.ts` + `ENTRY=v1` 回滚、`WEB_ROOT=web-v2/dist`、数据目录 `data-v2`）。
4. 工作方式：先讲方案、阿真批准后动手；全部构筑/测试/运行在 Docker 容器内；测试必须真实运行，不许只写不跑。

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
├─ tests/   98 个测试文件（见"测试状态"）：v1 引擎与驱动（smoke · rulesets · engine-* · visibility
│           · night-driver · day-driver · server-api · realtime · spectator · review · voice-*）
│           · v2 体系（v2-api · v2-config · v2-realtime · v2-media · v2-timers · v2-victory · account-*
│             · avatars* · stable-room · room-* · screen-grants · empty-rooms · receipts · frontend-v2-*
│             · contract-* · knowledge · targets · capabilities 等）
│           · fixtures/contract-2.1（29 份 JSON 快照 + full-index）
├─ e2e/     容器化 Playwright 验收：specs/（v1 入口 10 个：01 冒烟·02 语音·03 越权·04 全流程·05 恢复
│           · 06 泄漏·07 观战·08 踢人·09 板子编辑器·10 终局退出）
│           · specs-v2/（v2 入口 33 个：账号·房间·行动·夜行·情报·公屏·复盘·展示·全流程·恢复·特殊行动·治理重连·发布冒烟·账号失败·管理·语音·遗言·语音电平·身份揭示·死亡特效·阶段转场·夜景氛围·发言聚焦·身份能力·竞选名单·舞台亮度·大厅视口·送达回执·竞选投票提示·窄屏 HUD·自由发言·濒死标记·大厅语音）
│           · helpers/ 与 helpers-v2/ · capacity.mjs · timeline.mjs · playwright.config.ts / playwright.v2.config.ts
│           · （配套镜像 deploy/Dockerfile.e2e 与 compose e2e profile）
├─ vite.config.ts / vite.v2.config.ts   前端构建配置（产物 web/dist 与 web-v2/dist）
├─ web/  index.html · tsconfig.json（独立 DOM 环境与 JSX）
│        src/ main.tsx · app.tsx · game.tsx · review.tsx · voice.tsx（语音条与控制器）· api.ts · format.ts · types.ts · styles.css · vite-env.d.ts
├─ web-v2/  index.html · tsconfig.json（默认入口新前端）：src/ app · features/（账号·大厅·行动·情报·公屏·观战·复盘·语音·管理）· transport · presentation · styles
└─ data/ + data-v2/   SQLite 落盘位置（旧 `../data` 与新 `../data-v2`，由 `.env` 的 ENTRY 决定）
```

## 测试状态

**头条数字**
- **最近一次全量实测**（2026-10-02，`2.0.7-alpha` 分支，含本批修复的 Q-11 / Q-12 过期断言）：镜像构建链内 `vitest run` **98 文件 730 例全过**，同批四个 typecheck 与 `build:web` / `build:web:v2` 通过；上一次（2026-09-23，含 v2.0.6-alpha 声网语音可靠性收口）：容器内 `vitest run` **93 文件 643 例全过**（14.6s）；较上一版 603 例新增 40 例（送达回执 / 频道对账 / REST 超时与重试 / 缺凭据降级 / 客户端凭证续期与重连，含维护方补的「无客户凭据不暴露频道查询」1 例）。
- 更早一次全量实测（2026-09-22，含 v2.0.5-alpha 与 UI 优化批次）：**92 文件 603 例全过**。
- **当前静态清点**（`it(`/`test(` 正则清点，未跑全量核对）：`tests/` **98 文件 / 721 例**（全量实跑 730 例，差额为「正则清点」口径）、`e2e/specs-v2` **33 spec / 106 例**。
- **2.0.7-alpha 分支**：**全量单测已跑通**（2026-10-02，98 文件 730 例，镜像构建链内）并**已在本地重建镜像** `ghcr.io/azhen073/theater-death:2.0.7-alpha`（本地标签，**未推送注册表**）；**未部署**；四个 typecheck 与逐 spec E2E 双浏览器批次均通过，**未跑全量 E2E / v1 E2E**。

**2.0.7-alpha 增量（容器内，2026-09-23 起；各批均以「还原对照」验证改动有效性）**
- 竞选投票本人提示：新增 `tests/frontend-v2-election-vote-notes.test.ts`（20 例）；E2E `28-election-vote-notes`（新，双浏览器 10/10）+ `24-election-chat` + `03-actions`。详见 `docs/frontend-v2-election-vote-notes.md`。
- 提示音开关移入账户：`tests/frontend-v2-display-model.test.ts`（新增 `attentionSound` 用例）；E2E `22-speech-attention` + `08-display` + `01-account`。
- 团队攻击单按钮 + 刀人点击切换：`tests/frontend-v2-actions.test.ts` / `frontend-v2-draft-reconciliation.test.ts`；E2E `03-actions`（含重写空刀用例）、真实服务端 `04-night-actions` / `10-recovery`。
- 生效文案与「空刀」口径：E2E `03-actions` 覆盖「全票／最后合法草稿／空刀草稿／无草稿」四态与「最新草稿 v3：空刀」。
- 契约文档维护：`tests/contract-openapi.test.ts` 新增形状断言（拒绝 LiveKit 形状、身份字段不得入载荷）。
- 公屏写权限档位（Q-10）：`visibility` / `capabilities` / `v2-api` / `chat-receipts-api` / `frontend-v2-*` / `contract-openapi`；E2E `02-rooms`（含「未选不可提交」）与 `06-chat-screen-real`（真实服务端夜间活人可发）。
- 阵营交流记录并入公屏页签：E2E `06` + `05-information` + `10-recovery`（含「导航往返保留 faction 草稿」）。
- 死亡公告横幅 + 窄屏 HUD：E2E `20-death-effects`（新增横幅 y ≥ HUD 下沿、滚动后再验）、新增 `29-hud-compact`，回归 `02/03/05/06/07/08/10/21/22/23/25` 双浏览器。
- 白天「自由发言」（Q-11）：新增 `tests/v2-free-speech.test.ts`，`v2-timers` / `v2-media` / `v2-api` / `frontend-v2-voice-levels` 各 +1，契约夹具补 `freeSpeech`；新增 E2E `30-free-speech`（HUD、提醒条、不自动开麦、手动开麦后「已送达 1/1」、电平光环与保持期、建房未选时提交禁用）。
- 自由发言行动卡文案：新增 `tests/frontend-v2-free-speech-note.test.ts`（还原 `idleText` 即失败）；E2E `30-free-speech`。
- 座位徽标（BadgeStrip）：新增 `tests/frontend-v2-badges.test.ts`；E2E `05-information`（320 两列网格、盒高 > 0 闸门、多徽标共存、与「草稿/已选」角标零重叠）。
- 座位「濒死」标记：`tests/knowledge.test.ts` 新增授权矩阵与 `dying_list` 集合一致 5 例、新增 `tests/frontend-v2-dying-mark.test.ts`；E2E `31-dying-mark`。
- 大厅/复盘开麦（Q-12）：`voice-policy` / `v2-media` / `v2-voice-api` / `frontend-v2-voice-session`；新增 E2E `32-lobby-voice`，回归 `30-free-speech` / `18-voice-levels` / `05-information` / `07-review` / `27-voice-delivery`。

**v2.0.6-alpha 增量与真机验收（2026-09-21 ~ 09-23，贡献 kiahir）**
- 增量：后端 `voice-agora` / `v2-media` / `voice-policy` / `voice-api` / `v2-voice-api` / `v2-voice-delivery-api` 与客户端 `frontend-v2-voice-session` / `frontend-v2-voice-levels`，四个 typecheck 通过；E2E `18-voice-levels` / `27-voice-delivery` 双浏览器全过；镜像重建通过（构建链内含全量单测，**未单独复跑全量**）。
- 真机（本机 `.env` 真实凭据）：`16-voice` 13 客户端入频道、候选开麦发布、接收方远端电平正常；C/D 后发言者页「已送达 12/12」、听众页无送达行。客户 ID/密钥补验：对账 `rounds` 递增且 `failures` 为 0、自签未知 uid 被对账踢出、踢人 REST 只踢目标 uid、关房后频道清空、v1 `02-voice` 通过。
- **鉴权实测（已接受的风险，用户决定 2026-09-21）**：加入强制校验 token（无 token / 错证书均被拒），但**发布权限位无约束力**——订阅 token 在 rtc 与 live 下均能发麦、短 TTL 凭证过期后仍能发麦，即本项目「连麦鉴权」未生效（复测同）；缓解 = 服务端签发/撤回（依赖客户端 `renewToken`）+ 发布 TTL 150 秒上限。

**更早批次（摘要）**
- v2.0.2-beta ~ v2.0.5-alpha 与 UI 优化批次 #9–#16：每批均跑增量单测 + 四个 typecheck + `build:web:v2` + 分批双浏览器 E2E（v2.0.4-alpha 另含契约夹具重导出；v2.0.5-alpha 由 GPT-5.6-Luna 独立执行）。既有失败见下节。

**已覆盖**：T-01、T-03–T-17、T-19–T-30、T-34–T-50（引擎与驱动，含实验模式 T-49、天理莱莱可决胜票 T-50）、白天下令/窗口/编排冒烟（夜→日→夜）、T-48 终局复盘、实验模式房间（正式拒绝/实验开局/实验值落盘）、退出与解散、语音许可策略（各窗口穷举 + 平票者开麦）与声网适配（token 签发/踢人/关房 REST）、语音 API（开关/大厅/开局/同步/推送/竞选发言候选获得发布权）。

**未覆盖 / 未验（如实记录）**
- 真实设备 WebKit/Safari 深度路径与麦克风（由阿真双设备人工验收补足）；「旧凭证重连」独立场景（单测 + 刷新/断网恢复间接覆盖）；媒体失败「文字继续」降级（单测/集成覆盖）；§15 的 Playwright / 真实设备 / 容量验收已由 M4d 完成。
- 2.0.7-alpha：真实声卡多人同时开麦、真实凭据下的大厅/复盘互听（按 `16-voice` 口径补）；`everyone` 档真实浏览器死者夜间发言（由单测与服务端用例覆盖）；真实媒体增益/AGC 听感、`publish_audio` 兜底（未启用）、`16-voice` 对送达行无断言（仅截图）。
- 遗留未做：v1 无自动重连且 uid = 座位号（多标签页 `UID_CONFLICT`）；重投标题、`speechOrder`、候选徽标、进度行 aria；v1 入口仍「仅白天」（已知不对称，v1 大厅/复盘语音仍 409）。

**既有失败（非本版引入，main 基线同样复现）**
- `02-rooms` 实验房间 presence 状态断言：期望 `offline`、实得 `reconnecting`（v2.0.5-alpha 起记录，与本版需求无关）。
- `12-governance-reconnect`：仅 AC09/AC19 失败。
- v2 入口全量运行受验收服务 **IP 限流**影响（登录/注册 30 次/分钟）→ 登录 **429** 级联失败，须按增量策略分批跑；`06-chat-screen-real` 的「真实转日公屏」用例依赖手动推进假时钟（超时）。
- `05-information` 的「聊天/事件历史」用例在 **webkit** 上 `scrollTop` 断言失败（期望 ≤1、实得 5790）——还原侧栏改动后同样失败。

**E2E 环境门控**（不在编排内运行）：`13-release-smoke`（需 `FRONTEND_BASE_URL`）、`15-admin`（需 `ADMIN_TEST_PASSWORD`）、`16-voice`（需语音配置）。
**v1 入口**：2026-09-21 全量通过（chromium 18 + webkit 4）；规则变更只跑受影响路径，均通过。

真实运行验证记录（要点）：
- 2026-09-16：`docker compose up -d` → `/healthz` 正常、创建房间、SQLite 落盘；容器内 socket.io-client（会话 cookie）握手收到 `hello { gameId, playerId, roomCode }`。
- 2026-09-16（M3d）：浏览器实机 13 人全流程（12 名脚本玩家 + 1 名浏览器玩家）通过：创建/加入 → 准备 → 开局 → 首夜 → 遗言/竞选/发言/投票/计票公示 → 第二夜 → 科研员出局终局 → 复盘（身份/时间线/交流）；夜间同屏验证窗口倒计时与个人流，公屏发言经 Socket.IO 回显正常。
- 2026-09-16（M4c）：**服务器部署**（Ubuntu + Docker + Cloudflare Tunnel 子域名）：外网 `/healthz` 200、首页 200、未登录 API 401、Socket.IO 公网握手 200、会话恢复进入大厅正常；CI（GitHub Actions → ghcr 镜像 → 服务器拉取更新）验证通过。
- 2026-09-16（M4b，LiveKit 阶段；媒体方案已于 v1.6 替换为声网 Agora）：本地 LiveKit 容器链路（签发凭证经 TokenVerifier 验证，createRoom / syncRoom / closeRoom 正常）、家宽公网自托管可行性、LiveKit Cloud 链路与服务器双设备语音验收（阿真电脑 + 手机 4G）全部通过；期间抓获并修复发布竞态（Playwright 虚拟麦克风复现 `tracks:[]` → 修复后云端出现音频轨）。

## 里程碑与增补（历史归档，均已整合进 main）

### M1–M4 里程碑（全部完成）

- **M1–M3**：rulesets 默认板与验证器、纯引擎（开局/团队确认/夜晚/晨间/胜负）、visibility 授权投影、夜间与白天窗口驱动、HTTP/Socket.IO、React + Vite 前端（同镜像交付，默认入口 v2）；接口速查与文件清单见上两节。
- **M4a 规则收尾**：实验模式（`POST /api/rooms` 可传完整 ruleset，经 `rulesets/validate.ts` 的 `validateRuleset` 校验；正式预设变体拒绝）→ 大厅醒目横幅 + 板子快照落 SQLite（`server/log-store.ts` 的 `rooms` 表），房间全流程使用自己的板子（`Room.ruleset`）；`GET /api/view` 加 `rulesetMode` / `requiredPlayers`。
- **M4b 语音（历史）**：当时实现为 LiveKit（`voice/policy.ts` 许可穷举 + 短期凭证 + 服务端 `syncRoom` 权限同步 + `web/src/voice.tsx` 语音条）；**2026-09-19（v1.6）起替换为声网 Agora**，现行实现见 `voice/agora.ts` 与「语音关键约束」。
- **M4c 部署与运行手册**：`deploy/install|start|stop|update.{ps1,sh}`、`deploy/RUNBOOK.md`、`README.md`；大厅退出 / 解散（`POST /api/rooms/:code/leave`，对局中 409）；GitHub Actions → `ghcr.io/azhen073/theater-death:latest`；服务器部署 + Cloudflare Tunnel 外网验证。
- **M4d 容器化验收**：`e2e/`（v1 `specs/`、v2 `specs-v2/`；runner 与 app 共享网络命名空间）+ `deploy/Dockerfile.e2e`（Playwright 版本锁定）+ compose `e2e` profile。**收获并修复生产级崩溃**：提前结算后原窗口定时器到点重复结算 → 引擎抛错 → Node 进程退出（修法：`scheduleWindow` 切换窗口时 `clock.cancel` 旧定时器 + 所有到点回调补 phase 守卫；回归 `tests/day-driver.test.ts`）。
- **M4e 收官报告**：`M4_ACCEPTANCE_REPORT.md`（§15 格式，属 2026-09-16 时点快照）。
- 遗留动作：服务器更新镜像并改配声网凭据（`git pull` → `.env` 换 `AGORA_*` → `./deploy/update.sh`）。

### 增补需求 v1.2–v1.5（均已完成，细节见需求文档对应版本记录）

- **v1.2 观战**：观众绑定一名玩家（1:1、昵称必填）得到**只读第二屏**。服务端 `SessionPayload.kind='spectator'`、`Room.spectators`（`watchRoom` / `removeSpectator`，玩家离开大厅连带清理）、`POST /api/rooms/:code/watch`、`POST /api/spectate/leave`、公开成员名单（不含身份字段）；`/api/view`、聊天、复盘与语音凭证按**绑定玩家**解析，写操作一律 403 `spectator_readonly`；socket 只入公共频道 + 绑定玩家个人频道；语音只旁听（`SPECTATOR_PERMISSION`）。测试 `tests/spectator.test.ts`、E2E `07-spectator.spec.ts`。
- **v1.3 房主踢人**：仅**未开局大厅期**可移出成员（清位语义：释放席位、可重新加入、无黑名单），观战者不限阶段；`RoomRegistry.kickMember` / `kickSpectator`、`POST /api/rooms/:code/kick`（body 恰好一个目标）；被移除者靠 membership 校验 403 `not_member` 回入口页。测试 `tests/server-api.test.ts`、E2E `08-kick.spec.ts`。
- **v1.4 实验模式板子编辑器**：`web/src/board-editor.tsx` 只改角色数量（其余沿用默认板）、不本地保存；直接复用 `rulesets/validate.ts` 与 `THEATER_DEATH_13`，`mode` 恒为 experimental。E2E `09-board-editor.spec.ts`。
- **v1.5 终局退出**：仅**终局后**可退出（对局中 409 `game_started`）；任何人退出只释放自己席位、房主退出**不解散**、最后一名成员退出时销毁房间；`server/rooms.ts::leaveRoom` 守卫改「非终局才拒绝」，`/api/view` 对局形态补 `roomCode`。测试 `tests/server-api.test.ts`、E2E `10-end-exit.spec.ts`。
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
