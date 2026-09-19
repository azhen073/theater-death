# theater_death 进度与交接

更新时间：2026-09-19 · 供上下文压缩（compact）后接续工作使用

## 当前状态

| 里程碑 | 状态 | 说明 |
| --- | --- | --- |
| 文档 | ✅ | 规则书 v1.1 + 需求文档 v1.2（v1.1 + 观战增补），Q-01–Q-08 全量定值（规则书第 09 章） |
| M1 规则与数据 | ✅ | 纯规则引擎 + 默认板配置 + 验证器；74 个单测容器内全过 |
| M2 文字闭环 | ✅ | M2a 引擎补全 + visibility · M2b 夜间窗口驱动 + HTTP 会话/命令 · M2c Socket.IO 实时推送；124 测试全过 + 容器内实时握手验证 |
| M3 白天与复盘前端 | ✅ | M3a 引擎 + M3b 驱动编排 + M3c 复盘 + M3d 网页前端；158 测试 + 浏览器全流程实机验收 |
| M4 语音与部署 | ✅ | **全部完成**：M4a 规则收尾 · M4b 语音（发布竞态修复 + 服务器实机双设备验收）· M4c 部署（服务器上线 + Tunnel + CI 镜像 + 退出/解散）· M4d E2E 验收（14/14，含容量；发现并修复白天驱动崩溃）· **M4e 收官报告**（`M4_ACCEPTANCE_REPORT.md`，§15 格式） |
| 观战（v1.2 增补） | ✅ | 绑定玩家只读第二屏：入口选择目标、只读大厅/对局、语音旁听、终局复盘同权；194 单测 + E2E 16/16 |
| 房主踢人（v1.3 增补） | ✅ | 大厅期移出成员（清位、可重进）、移出观战者（不限阶段、连带语音参与者移除）；204 单测 + E2E 18/18 |
| 板子编辑器（v1.4 增补） | ✅ | 入口页「自定义板子…」：只改角色数量、实时校验（复用服务端校验器）、强制实验模式；204 单测 + E2E 09 增量通过 |
| 语音媒体服务（声网替换） | 🚧 | LiveKit（Cloud 跨境连接慢）→ **声网 Agora 免费层**：服务端签发短期 token（订阅/发布/降权）、前端换 `agora-rtc-sdk-ng`、踢人走频道管理 REST；代码/单测/部署配置已完成，**待阿真凭据联调 + E2E 实测** |

## 接续指引（compact 后先读这里）

1. 读本文件 + `AGENTS.md`（项目规则与 Docker 约束）即可接上状态。
2. 规则细节查 `theater_death_rulebook_v1.1.md`（第 09 章 = S3 裁定）；
   工程规格查 `theater_death_development_requirements_v1.1.md`（v1.3：§07 旁观者小节 + 文末版本记录）。
3. 进度断点（2026-09-19）：**语音媒体服务已替换为声网并全链路验证**——代码推送 `32d1e02`（4 笔提交），CI success、新镜像已发布 ghcr；E2E 语音 3 例在真实声网云全过；控制台已完成（项目 theater-death、连麦鉴权开启、RESTful 密钥生成）。**遗留动作（重要）**：服务器更新——`cd ~/theater-death && git pull` → `.env` 加 `AGORA_APP_ID` / `AGORA_APP_CERTIFICATE` / `AGORA_CUSTOMER_KEY` / `AGORA_CUSTOMER_SECRET`（删旧 LiveKit 行；`PUBLIC_BASE_URL` / `SESSION_SECRET` / `SESSION_COOKIE_SECURE` 保持服务器值不动）→ `./deploy/update.sh`。此次一并应用白天驱动崩溃修复、观战、踢人、板子编辑器与终局退出。此前里程碑：M1–M4 + 观战 + 踢人 + 板子编辑器 + 终局退出（PR#2）全部完成。`deploy/livekit.yaml` / `livekit-public.yaml` 为旧配置残留（compose 服务已移除），待确认后删除。
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
├─ .env.example / .gitignore / .dockerignore / .gitattributes
├─ .github/workflows/release.yml   CI：构建（含测试）并发布 ghcr 镜像
├─ deploy/  Dockerfile（node:24.15.0-bookworm-slim 锁定）· docker-compose.yml（image 指向 ghcr）
│           · install/start/stop/update × {ps1,sh} · RUNBOOK.md（运行手册）
│           · （livekit.yaml / livekit-public.yaml 为旧自托管配置，待删除）
├─ engine/  index · types · events · emit · random · setup · proposal · night · victory · morning · stage · day
├─ rulesets/ index · types · roles · theater-death-13 · validate
├─ visibility/  index · context · deliver · rooms · chat · errors · projection · review
├─ server/  index.ts（express + Socket.IO 装配启动）· health.ts · app · session · rooms · log-store
│           · realtime · clock · commands · night-driver · day-driver
├─ voice/   policy（R-43 许可策略，纯函数）· agora（声网适配：订阅/发布/降权 token 签发、踢人/关房 REST）
├─ tests/   17 个文件共 187 用例（见"测试状态"）：smoke · rulesets · engine-setup · engine-proposal
│           · engine-night · engine-morning · engine-info · engine-day · visibility · night-driver
│           · server-api · realtime · day-driver · review · voice-policy · voice-agora
│           · voice-api（+ server-test-utils 工具）
├─ e2e/      Playwright 端到端验收：specs/（01 冒烟·02 语音·03 越权·04 全流程·05 恢复·06 泄漏）
│           · helpers/（api·bot·cloud·driver·ui·board·env）· capacity.mjs · package.json（配套镜像 deploy/Dockerfile.e2e 与 compose e2e profile）
├─ vite.config.ts               前端构建配置（root=web，产物 web/dist）
├─ web/  index.html · tsconfig.json（独立 DOM 环境与 JSX）
│        src/ main.tsx · app.tsx · game.tsx · review.tsx · voice.tsx（语音条与控制器）· api.ts · format.ts · types.ts · styles.css · vite-env.d.ts
└─ data/        SQLite 落盘位置（compose 挂载 ../data:/app/data）
```

## 测试状态

208 passed / 18 files（容器内 `npm run test`，由镜像构建强制执行；镜像同时执行 `typecheck`（服务端）、`typecheck:web`（前端）与 `vite build`）。
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
- **E2E 用例口径提醒**：静态清点为 17 个 `test()`（chromium 全跑 17 + webkit 匹配 04/05 各 2 = **21 次运行**）；`AGENTS.md` 此前记的「18/18」与静态清点差 1，未跑全量故未定论，需要时以一次全量运行核对

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
- **声网替换（2026-09-19，动因：LiveKit Cloud 大陆跨境连接每次十几秒）**：权限模型 = 「连麦鉴权」开启后发布权编码在 AccessToken2 中——加入凭证为订阅角色（可听不可发）；获得发言权由服务端在状态推进时下发**含发布权限、短 TTL（默认 10 分钟，覆盖最长 90s 窗口）**的 token，前端 `renewToken` 即时生效；收回 = 下发订阅凭证即时降权 + TTL 到期兜底（声网**没有**"服务端实时改权限"API，强制力弱于 LiveKit，靠短 TTL 兜底）。踢人/关房走频道管理 REST（`POST /dev/v1/kicking-rule`：`join_channel` + `time=0` = 一次性踢出可立即重进，语义与"踢人不拉黑"一致；不带 uid = 踢出频道全员，用于终局关房）。uid 分配：玩家=座位号（1-13）、观战者=1000+顺序号（保存在 `RoomSpectator.uid`）。AccessToken2 内容体为压缩编码，离线无法断言权限位（联调实测）。
- **声网集成要点**：REST 鉴权 `Authorization: Basic base64(AppId:AppCertificate)`；中国区接入点 `api.sd-rtn.com`（国际 `api.agora.io`）；npm 包 `agora-token`（服务端签发，导出名 `RtcRole` 而非文档源码里的 `Role`）+ `agora-rtc-sdk-ng`（前端）；`createClient` 的 `codec` 参数是视频编解码器（必填、与音频无关）；频道查询 API 只有"在不在频道"（无发流/权限状态）→ E2E 语音断言降级为"频道在线 + 界面文案 + 无麦克风错误"（见 `e2e/specs/02-voice.spec.ts` 注释）。
- **声网计费**：免费层每月 1 万分钟（按"人×分钟"，13 人 1 小时局约 780 分钟 ≈ 12 局/月），超出 7 元/千分钟；控制台开启「连麦鉴权」是发布权控制生效的前提。
- **声网凭据获取（2026-09-19 实操）**：控制台里 App ID / App 证书均掩码显示——App ID 可点复制图标获取（或用控制台 API `GET /dev/v1/projects` 的 `vendor_key`，本次实测该 API 可用）；**频道管理 REST 用「客户 ID + 客户密钥」基本认证**（控制台「设置 → RESTful API → 添加密钥」，**仅可下载一次** `key_and_secret.txt`），不是 App 证书——`.env` 需 `AGORA_CUSTOMER_KEY/SECRET`；「连麦鉴权」在「全部产品 → 实时互动 RTC → 功能配置」启用（**开启后不可关闭**，约 5 分钟生效）。
- **Node ESM 与 CJS 包（翻车教训）**：`agora-token` 为 CommonJS 包——**vitest 通过不代表 Node 原生运行通过**：命名导入在 vitest（Vite 转换）下能解析、在 Node 原生 ESM 下报 `does not provide an export named 'RtcRole'` 并导致服务启动崩溃。修复：default 导入后解构 + `.d.ts` 声明 default 导出。**教训：改依赖加载方式后用 Node 原生方式实测（`node --input-type=module -e "import('./voice/agora.ts')..."`），不能只信单测。**
- **声网链路实机验证（2026-09-19）**：E2E 语音 3 例全过（01 冒烟加入频道 + 02 发言授权/收回 + 02 夜间禁麦，1.3 分钟），浏览器经真实声网云完成加入与权限切换；本机 `.env` 已配置项目凭据（凭据不入库）。
- **前端产物**：引入 `agora-rtc-sdk-ng` 后单包约 1.86MB（gzip 524KB，vite 提示超 500KB）；单页应用可接受，如需优化可后续 code-split。
- **E2E 基础设施要点（M4d）**：runner 与 app 共享网络命名空间（`network_mode: service:app`）后用 `http://localhost:3000`——**非 localhost 的 http 会被 Chromium HTTPS-First 升级**（`--disable-features=HttpsFirstModeV2,...` 实测压不住，`ERR_SSL_PROTOCOL_ERROR`），localhost 天然安全上下文最稳；虚拟麦克风需 `--unsafely-treat-insecure-origin-as-secure`；`gameId` 只在**大厅视图**有（对局开始后 /api/view 不再返回）；复盘字段是 `players/timeline/winner`（不是 seats）；浏览器注入会话用 cookie `td_session`（`context.addCookies`）；compose 宿主端口冲突（3000 被占）→ `deploy/e2e.env` 用 `APP_PORT=3210`；用例间**不要 `some(async …)`**（async 回调恒真）；Playwright 镜像版本与 `@playwright/test` 精确锁定一致（1.63.0）
