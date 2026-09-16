# theater_death 进度与交接

更新时间：2026-09-16 · 供上下文压缩（compact）后接续工作使用

## 当前状态

| 里程碑 | 状态 | 说明 |
| --- | --- | --- |
| 文档 | ✅ | 规则书 v1.1 + 需求文档 v1.1，Q-01–Q-08 全量定值（规则书第 09 章） |
| M1 规则与数据 | ✅ | 纯规则引擎 + 默认板配置 + 验证器；74 个单测容器内全过 |
| M2 文字闭环 | ✅ | M2a 引擎补全 + visibility · M2b 夜间窗口驱动 + HTTP 会话/命令 · M2c Socket.IO 实时推送；124 测试全过 + 容器内实时握手验证 |
| M3 白天与复盘前端 | ✅ | M3a 引擎 + M3b 驱动编排 + M3c 复盘 + M3d 网页前端；158 测试 + 浏览器全流程实机验收 |
| M4 语音与部署 | ⬜ | 未开始 |

## 接续指引（compact 后先读这里）

1. 读本文件 + `AGENTS.md`（项目规则与 Docker 约束）即可接上状态。
2. 规则细节查 `theater_death_rulebook_v1.1.md`（第 09 章 = S3 裁定）；
   工程规格查 `theater_death_development_requirements_v1.1.md`。
3. 进度断点：**M3 全部完成**（M3d 前端 158 测试全过 + 浏览器实机验收：创建房间 → 13 人开局 → 昼夜循环 → 投票 → 终局复盘）；下一步 **M4：语音与部署**——开工前需阿真拍板两件事（语音服务选型 / 实验模式形态，见"下一步计划"）。
4. 工作方式：先讲方案、阿真批准后动手；全部构筑/测试/运行在 Docker 容器内；测试必须真实运行，不许只写不跑。

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
├─ theater_death_rulebook_v1.1.md
├─ theater_death_development_requirements_v1.1.md
├─ package.json / package-lock.json / tsconfig.json / vitest.config.ts
├─ .env.example / .gitignore / .dockerignore
├─ deploy/  Dockerfile（node:24.15.0-bookworm-slim 锁定）· docker-compose.yml
├─ engine/  index · types · events · emit · random · setup · proposal · night · victory · morning · stage · day
├─ rulesets/ index · types · roles · theater-death-13 · validate
├─ visibility/  index · context · deliver · rooms · chat · errors · projection · review
├─ server/  index.ts（express + Socket.IO 装配启动）· health.ts · app · session · rooms · log-store
│           · realtime · clock · commands · night-driver · day-driver
├─ tests/   smoke · rulesets(18) · engine-setup(6) · engine-proposal(8) · engine-night(25)
│           · engine-morning(17) · engine-info(10) · visibility(12) · night-driver(13)
│           · server-api(9) · realtime(6) · engine-day(22) · day-driver(8) · review(2) · server-test-utils
├─ vite.config.ts               前端构建配置（root=web，产物 web/dist）
├─ web/  index.html · tsconfig.json（独立 DOM 环境与 JSX）
│        src/ main.tsx · app.tsx · game.tsx · review.tsx · api.ts · format.ts · types.ts · styles.css · vite-env.d.ts
├─ voice/       空（M4：VoiceAdapter 与 R-43 发言许可）
└─ data/        SQLite 落盘位置（compose 挂载 ../data:/app/data）
```

## 测试状态

158 passed / 14 files（容器内 `npm run test`，由镜像构建强制执行；镜像同时执行 `typecheck`（服务端）、`typecheck:web`（前端）与 `vite build`）。
已覆盖：T-01、T-03–T-16、T-19–T-30、T-34、T-35、T-37–T-45、T-46（引擎与驱动）、T-47、白天下令/窗口/编排冒烟（夜→日→夜）、T-48 终局复盘（身份/状态/胜负/时间线/含加入前历史的交流/无密钥）。
未覆盖（属后续阶段）：T-17、T-36（引擎样例）；T-49（实验模式）与 T-50（天理莱莱可决胜票）待 M4 核对补齐；§15 的 Playwright/真实设备/容量验收（M4；M3d 已做浏览器手测全流程）。

真实运行验证记录：
- 2026-09-16：`docker compose up -d` → /healthz 正常、创建房间、SQLite 落盘。
- 2026-09-16：容器内 socket.io-client 连接（会话 cookie）→ 收到 hello { gameId, playerId, roomCode }。
- 2026-09-16（M3d）：浏览器实机 13 人全流程（12 名脚本玩家 + 1 名浏览器玩家）：创建/加入 → 准备 → 开局 → 首夜 → 遗言/竞选/发言/投票/计票公示 → 第二夜 → 科研员出局终局 → 复盘（身份/时间线/交流）全通过；夜间同屏验证窗口倒计时与个人流；公屏发言经 Socket.IO 回显正常。

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

### M4 语音与部署（细化；开工前需阿真拍板 2 件事）
- **待拍板**：① 媒体服务选型（需求禁止自动开通付费资源；候选：自托管 LiveKit @ Docker / 暂不接媒体只留适配接口 + 明确"文字测试模式"）；② 实验模式（R-54 / T-49）的入口形态（创建房间时选变体？API 参数？）
- **M4a 规则收尾（引擎）**：核对并补齐 T-49（正式仅默认 13 人预设；实验模式大厅醒目标记并保存实验值）、T-50（天理为禁投莱莱可时决胜票不生效、按剩余票重新判断）；顺带 T-17/T-36 视情补样例
- **M4b VoiceAdapter（公共白天语音，§10）**：
  - 服务端实施发言许可（R-43：竞选候选发言轮 / 发言轮当前发言者 / 遗言者可开麦；投票期全体禁麦；夜间全体静音）；不得只做前端置灰
  - 短期最小权限媒体凭证；voice/ 模块放适配层与许可逻辑
  - 前端：加入语音/授权、静音、设备选择、文字模式、清晰状态反馈；死者公共旁听；断线重连重校验资格
  - 失败语义：语音失败不改变胜负、不暂停计时；公屏白天照常；夜间不得为降级开放全体公屏；未接媒体时页面明确"文字测试模式"标记
  - 验收 = §15 语音组（未授权、手动静音、死者开麦、夜间发送、结束发言、重连旧凭证、媒体失败文字继续）
- **M4c 部署与运行手册（§12）**：
  - .env.example 补全（PUBLIC_BASE_URL、语音开关、媒体地址与密钥占位；不提交真实密钥）；compose 加媒体配置位
  - 启动脚本（首次安装与日常启动分开）+ 启动输出实际访问入口与邀请信息
  - Cloudflare Tunnel 玩家电脑托管验证（出站隧道，无需公网 IP）；**从真实不同网络验证可达性**（非本机回环）
  - 运行手册：支持系统与版本、安装/启动/停止、入口失效排查、日志位置与删除/导出、秘密注入、媒体关闭与失败提示
- **M4d 浏览器与容量验收（§15）**：
  - Playwright（Chromium + WebKit）：13 个浏览器上下文全角色操作（覆盖 M3d 遗留的夜间角色面板与阵营房 UI）；越权反例与泄漏检查；断线刷新恢复
  - 容量：13 脚本客户端完整日夜循环 + 资源/延迟记录（可脚本化重跑）；报告分开列自动化与真实设备
  - 真实桌面/手机 Safari + 麦克风由阿真人工验收，与自动化结果分开列出
  - 运行方式候选：单独 E2E 镜像/compose profile（不污染生产镜像）或宿主 Playwright——遵守 Docker 约束前提下由阿真定
- **M4e 收官报告（§15 交付格式）**：实际运行命令、代码/配置版本、环境、用例总数与通过/失败/跳过、失败序列与重现种子、证据路径、未测设备、未覆盖 Q 条款；实验模式配置单独标出，不计入"全部通过"
- 建议顺序：M4a → M4c（部署先能用）→ M4b（媒体接入）→ M4d → M4e；M3d 遗留的 UI 补测并入 M4d

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
- **定时器回调必须带 phase 守卫**：day-driver 曾因"投票全员投完提前结算 → 原 vote 定时器到点再次结算"导致引擎抛错、生产进程退出（158 测试前只覆盖单一情形）；已修 + 回归测试。night-driver 的到点回调本就带守卫
- 前端构建纳入 Docker 构建链：typecheck（根）→ typecheck:web → 测试 → vite build；web/dist 由 express 静态托管（SPA fallback 排除 /api、/healthz、/socket.io）
- 前端引入后：vite 相关依赖加进根 package.json 的 devDependencies（lock 由容器更新）；web 的类型检查用独立 tsconfig（不要并入根 tsconfig 的 node 环境）
- 本地联调脚本经验（PowerShell 5.1）：Invoke-RestMethod 不能通过 -Headers 传 Cookie（受限头被静默忽略）→ 用 WebRequestSession + CookieContainer；发送中文 JSON 用 UTF-8 字节数组（`Invoke-WebRequest -Body $bytes`），否则昵称乱码
