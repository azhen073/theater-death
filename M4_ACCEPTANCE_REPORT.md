# 《剧院死神》M4 收官验收报告（§15 交付格式）

> **历史快照（2026-09-16）**：本报告固化的是 M4 收官时点的数据与结论（187 单测 / E2E 14/14 / 服务器媒体 = LiveKit Cloud）。此后仓库已并入规则 2.0、账号体系与 v2 体系（需求 v1.7/v1.8），语音媒体于 2026-09-19 由 LiveKit 换为**声网 Agora**（需求 v1.6）。正文按原样保留，不代表当前状态；当前进度与计数见 `PROGRESS.md`，当前工程规格见 `theater_death_development_requirements_v1.1.md`（版本号见该文档表头与文末版本记录）。

- 报告日期：2026-09-16
- 编制：开发协作者（AI 辅助）；人工验收部分由阿真执行
- 规则依据：`theater_death_rulebook_v1.1.md`（含第 09 章 S3 裁定）；工程规格：`theater_death_development_requirements_v1.1.md` §15

## 0 摘要

| 项目 | 结果 |
| --- | --- |
| 单元/集成测试 | **187 / 187 通过**（17 个文件；由镜像构建强制执行） |
| 端到端验收（Playwright） | **14 / 14 通过**（Chromium 10 + WebKit 4；17.9 分钟） |
| 容量（正式板完整日夜循环） | 通过：219.8s、419 条命令、p50 2ms / p95 16.5ms；app 峰值 CPU 4.81%、常驻 61–67MiB |
| 模拟对局完整时间线 | 1 条（8 天、284 事件、death_faction 胜、219.7s），产物已落盘 |
| 真实设备验收（人工） | 通过：台式机 + 手机（4G）双设备语音互听；服务器外网全流程 |
| 本次验收发现并修复 | 1 个生产级崩溃（白天驱动旧定时器；详见 §11） |

**结论**：M1–M4 全部里程碑完成，§15 各组均有自动化或人工验收覆盖；**实验模式配置已于 §8 单独标出，未计入"全部通过"**；未覆盖项见 §9（含替代覆盖说明）。

**动作项（遗留）**：服务器尚未应用崩溃修复镜像（80cb92b 起），建议执行一次 `git pull && ./deploy/update.sh`（详见 §11.4）。

## 1 代码与配置版本

| 项目 | 版本 / 值 |
| --- | --- |
| 代码版本（E2E 全量运行时） | commit `b3ecd4b`（含崩溃修复 `80cb92b`）；其后为文档提交 `5dff53d` 与时间线脚本 `33bb723` |
| 应用镜像（本地验收用） | `ghcr.io/azhen073/theater-death:latest` · digest `sha256:89f7e22e0e9200373575a98eccc9cd04ed569162ab24917e05893a35ca1acc92`（构建于 2026-09-16T09:11:58Z） |
| E2E 运行器镜像 | `theater-death-e2e:latest` · digest `sha256:db54444c80ba608097eff7a52786514b89d873105d65c38a5d4fa3230e25fe96` |
| 基础镜像（锁定） | `node:24.15.0-bookworm-slim`（应用）· `mcr.microsoft.com/playwright:v1.63.0-noble`（E2E）· `livekit/livekit-server:v1.9.7`（自托管媒体） |
| 依赖锁定 | 根 `package-lock.json` 与 `e2e/package-lock.json` 入库；`@playwright/test` 与运行器镜像精确 1.63.0 |
| 正式板配置 | `rulesets/theater-death-13.ts`（rulesetId `theater-death` v1.1，`mode: formal`）；校验器 `rulesets/validate.ts` |
| 服务器媒体 | LiveKit Cloud 托管（Asia 区域，凭证仅在服务器 `.env`，不入库） |
| 服务器部署信息 | Ubuntu + Docker + Cloudflare Tunnel（`theater-death.azhen73.com`）；详见 `deploy/RUNBOOK.md` |

## 2 运行环境

- 宿主（验收机）：Windows 11 + Docker Desktop 29.8.0（WSL2），Linux amd64 容器
- 服务器（真实部署）：阿真的 Ubuntu 服务器，经 Cloudflare Tunnel 子域名对外；语音媒体走 LiveKit Cloud
- 真实设备（人工验收）：台式机（Chromium 内核浏览器）+ 手机（移动网络 4G；浏览器品牌未记录，见 §9）
- 网络：E2E 全部容器内（自托管 LiveKit，无外部依赖）；服务器验收走公网

## 3 实际运行命令

以下命令均在验收机上原样执行（PowerShell 中 Docker Desktop 的 PATH 前置略去）：

```sh
# 1) 单元/集成测试（容器内；镜像构建时也会强制执行）
docker run --rm -v "<repo>:/app" -w /app -e NODE_ENV=test node:24.15.0-bookworm-slim \
  sh -c "npx tsc --noEmit && npx tsc --noEmit -p web && npx vitest run && npx vite build"

# 2) 构建应用镜像（含全部测试、类型检查、前端构建）与 E2E 运行器镜像
docker compose -f deploy/docker-compose.yml --env-file deploy/e2e.env build app e2e

# 3) 端到端全量验收（Chromium + WebKit；约 18 分钟）
docker compose -f deploy/docker-compose.yml --env-file deploy/e2e.env --profile e2e \
  run --rm e2e npx playwright test

# 4) 容量：正式板完整日夜循环（13 个 API 机器人；约 4 分钟）
docker compose -f deploy/docker-compose.yml --env-file deploy/e2e.env --profile e2e \
  run --rm e2e node capacity.mjs

# 5) 完整对局时间线捕获（13 个 API 机器人整局；约 4 分钟）
docker compose -f deploy/docker-compose.yml --env-file deploy/e2e.env --profile e2e \
  run --rm e2e node timeline.mjs
```

开发迭代时可在 `run` 上加挂载 `-v "<repo>/e2e:/src:ro"` 并前置 `cp -r /src/. /e2e/`（见 RUNBOOK §9）。

## 4 用例统计

| 套件 | 总数 | 通过 | 失败 | 跳过 |
| --- | --- | --- | --- | --- |
| 单元/集成（vitest） | 187 | 187 | 0 | 0 |
| E2E（Playwright） | 14 | 14 | 0 | 0 |
| 容量场景 | 1 | 1 | 0 | 0 |
| 模拟对局时间线 | 1 | 1 | 0 | 0 |

- E2E 明细（Chromium）：01 冒烟 5.0s、02 语音发布回归 43.9s、02 夜间禁麦 12.4s、03 安全边界 44ms、03 越权反例 316ms、04 十二上下文 UI 覆盖 4.5m、04 十三机器人终局 2.5m、05 刷新恢复 3.2s、05 断网恢复 14.9s、06 泄漏检查 273ms
- E2E 明细（WebKit）：04 UI 覆盖 5.9m、04 机器人终局 2.9m、05 刷新 3.3s、05 断网 15.2s
- **失败动作序列与重现种子**：本轮无失败，不适用；随机装配（座位/角色）未参数化种子（不适用）。首轮曾触发服务端崩溃，序列与修复见 §11（附复现测试）
- 覆盖条款：T-01、T-03–T-17、T-19–T-30、T-34–T-50（引擎/驱动/复盘/实验模式/语音策略/语音 API），另有 T-48 终局复盘与退出/解散

## 5 §15 各组覆盖矩阵

| 组别 | 覆盖方式与证据 |
| --- | --- |
| 命令一致性 | 单测：同 requestId 重放原回执 + 不同身份拒绝（server-api）、旧窗口迟到 `window_not_open`（server-api/day/night-driver）、重复报名/重复投票拒绝（day-driver）、提案重复确认（night-driver）。**未单独覆盖**：同玩家两标签页并发（服务端按会话解析 playerId，同一玩家不重复计票由引擎裁决；无自动化用例，见 §9） |
| 断线与刷新 | E2E 05：刷新后身份/座次/窗口恢复（信息与刷新前一致）；断网 5s 恢复后实时推送与倒计时继续。单测：realtime 会话与推送 |
| 越权反例 | E2E 03：无会话全端点 401、跨房间房间码端点 404、会话视图隔离、大厅提交命令 rejected、未开局签发音令牌 409、非本角色命令 rejected、夜间提交白天命令 rejected、夜间公屏 403、非死神阵营发/收阵营房 403、未终局复盘 403。单测：visibility 投影与权限。**说明**："死神订阅队聊"按 R-34/R-47 属正当功能（死神阵营全阶段共享阵营房），非越权；相关保密性以"非成员 403"覆盖 |
| 泄漏检查 | E2E 06（**服务端投影断言，非 UI 判断**）：同一窗口 `closesAt` 对 13 名玩家完全一致；未翻牌座位 `revealedRoleId` 全为 null；座位投影不含 `roleId` 键；公开事件流不含 `roleId`/`guardHistory`/`abilities` 字段；每个人可见自己的角色。单测：visibility 全套 |
| 语音 | E2E 02：夜间禁麦（云端 `canPublish=false` 且无音轨）+ 发言轮自动重试后音频轨发布成功 + 发言结束权限收回（云端同步）。人工：双设备开麦互听、手动静音、设备切换、"点击启用声音"。单测：R-43 许可策略穷举（含平票者）。**未自动化**：死者开麦（策略单测覆盖 reason=dead_listener）、媒体失败文字继续（见 §9） |
| 部署与容量 | 同一镜像两种部署：服务器（Ubuntu，公网实测）与玩家电脑（Windows Docker Desktop 本机验收环境）；真实不同网络：台式机 + 手机 4G。容量：13 脚本客户端完整日夜循环 219.8s，命令延迟 p50 2ms / p95 16.5ms / max 52.7ms，app 峰值 CPU 4.81%、常驻 61–67MiB（不凭硬件型号作结论） |
| 浏览器 | 自动化：Chromium（含虚拟麦克风媒体链路）+ WebKit（界面流程）；**真实设备另行列出**（§6），二者分开报告（Playwright WebKit ≠ 品牌 Safari） |

## 6 真实设备验收（与自动化分开）

| 项目 | 结果 |
| --- | --- |
| 服务器外网（公网） | 通过：/healthz 200、首页 200、未登录 401、Socket.IO 公网握手、浏览器会话恢复进大厅 |
| 台式机浏览器（核心操作） | 通过：创建/加入房间、13 人开局、完整日夜循环、竞选/发言/投票、终局复盘 |
| 双设备语音（台式机 + 手机 4G） | 通过：各自加入语音、发言轮开麦、双向互听（服务器媒体 = LiveKit Cloud） |
| 手机端浏览器 | 参与上表语音验收；**浏览器品牌/版本未记录**（见 §9） |
| 真实桌面 Safari（macOS） | **未测**（无设备）；WebKit 自动化结果不替代，见 §9 |

## 7 模拟对局交付（可重复运行 + 完整时间线）

- **可重复运行的脚本客户端**：`e2e/helpers/bot.ts`（读视图→提交合法意图）、`e2e/capacity.mjs`（正式板容量）、`e2e/timeline.mjs`（整局+复盘落盘）；命令见 §3 第 4/5 条
- **完整时间线**（2026-09-16 运行，产物 `e2e-results/timeline-*.json`）：
  - 房间 `9AK326`；13 名机器人加入 → 发身份（13 条 `role_assigned`）→ 阵营房建立 → 8 个夜晚（8 次 `attack_events`、6 次 `dying_list`、6 次查验结果、8 次还魂曲弃权）→ **1 次阶段转换（`stage_changed`）** → 7 个白天（竞选/发言 50 轮/投票 47 条进度、平票发言与重投 1 次、6 次放逐、5 次死亡公告、2 次翻牌）→ 科研员公告 1 次 → 终局（death_faction 胜：科研员当前死亡且所有神职出局）→ 全量复盘（284 事件）
  - **本局未触发"复活（深海召回）"**：触发需水妖死亡且满足召回条件，本局水妖（3 号）死亡时点不满足；复活路径由单测 T-20/T-21/T-24 覆盖（engine-morning / engine-night）
  - 时间线含公共信息与全量交流（R-53 复盘披露策略）；私有字段仅进入各自视图（E2E 06 已断言）

## 8 实验模式配置（单独标出，不计入"全部通过"）

- E2E 功能用例使用两块**实验模式**板：`e2e-fast`（流程覆盖）与 `e2e-voice`（语音组），各窗口缩至 6–30 秒；房间创建经 `POST /api/rooms` 的实验模式 API（T-49），大厅显示醒目横幅
- 实验板**仅缩短时长**，角色配置与正式板一致；**正式板真实时长**的验收仅由容量测试（§4）覆盖（219.8s 完整日夜循环）
- 本报告"14/14 全部通过"指规则正确性；**实验模式的时长参数不代表正式板体验**，按需求要求单独标明

## 9 未覆盖 / 未运行（如实）

| 项目 | 状态 | 说明与替代覆盖 |
| --- | --- | --- |
| 手动静音（媒体侧断言） | 未自动化 | 人工验收通过；本地静音为前端行为，不改变服务端发布权（设计如此） |
| 死者尝试开麦 | 未自动化 | 需构造死亡+加语音流程；语音策略单测覆盖 `dead_listener`（无发布权） |
| 媒体失败"文字继续"降级 | 未自动化 | 语音禁用/失败时前端显示"文字测试模式"（人工可见）；接口层由 voice-api 单测覆盖 |
| 同玩家两标签页并发 | 未自动化 | 服务端以会话解析 playerId，同一玩家不重复行动/计票由引擎裁决；无专门用例 |
| 旧凭证重连独立场景 | 未自动化 | 单测：凭证固定 `canPublish=false`、权限由服务端按当前窗口动态同步；E2E 刷新/断网恢复间接覆盖 |
| 真实桌面 Safari（macOS） | 未测 | 无设备；WebKit 自动化不等价于品牌 Safari（需求原文） |
| 手机浏览器品牌/版本 | 未记录 | 人工语音验收通过，但未记录 UA；如需正式报告口径请补充 |
| 复活（深海召回）E2E 路径 | 未触发 | 本局未满足条件；单测 T-20/T-21/T-24 覆盖 |
| 已知风险 | — | 服务器镜像尚未含崩溃修复（§11.4） |

## 10 证据路径

- Playwright 报告：`e2e-results/html/index.html`；机器可读：`e2e-results/results.json`
- 截图与 trace：`e2e-results/artifacts/`（含 `smoke-voice.png`、`voice-speech.png`、`ui-flow.png`、`flow-review.png`、`bot-review.png` 及失败留痕）
- 容量：`e2e-results/capacity-2026-09-16T09-00-02-958Z.json`
- 时间线：`e2e-results/timeline-2026-09-16T10-46-40-205Z.json`
- 说明：上述目录为运行产物，未入库（`.gitignore`），保留在验收机本地；服务器验收记录见 `PROGRESS.md`"运行验证记录"

## 11 本次验收发现并修复的问题

### 11.1 白天驱动进程崩溃（严重，已修复）

- **现象**：E2E 全量首跑第 7 个用例起连续 `fetch failed`；服务器日志显示 Node 进程以未捕获异常退出、容器重启，**内存中的全部房间丢失**
- **根因**：天理在"指定发言顺序"窗口内**提前指定**后，该窗口的**旧超时定时器仍会触发**并调用 `startDefaultSpeechRound`，此时发言轮已开始 → 引擎抛错 → 未捕获 → 进程退出。代码审查发现 `scheduleWindow` 从不取消旧定时器，且该回调缺少其它窗口都有的 `phase` 守卫
- **修复**：`scheduleWindow` 切换窗口时 `clock.cancel` 旧定时器（白天同一时刻仅一个窗口，语义安全）+ 该回调补 `phase` 守卫
- **回归**：先写复现测试（`tests/day-driver.test.ts`，修复前精确复现"发言轮已经开始"抛错），修复后 187 测试全过；E2E 全量重跑 14/14
- **同类审查**：夜驱动全部到点回调均已带守卫；白天其余窗口回调经排查均有守卫（此前 M3 已修过 vote 提前结算同类问题）

### 11.2 语音发布权限竞态（M4b 期间，已修复）

服务端广播许可与媒体侧权限同步并行，客户端抢跑发布被拒且旧版静默吞错 → "连接正常但谁都没声音"。修复：失败自动重试 + 权限事件驱动；E2E 02 现作为回归守卫（云端音频轨断言）。

### 11.3 验收基础设施问题（已解决，非产品缺陷）

Chromium HTTPS-First 升级、`gameId` 仅存于大厅视图、复盘字段名、compose 端口冲突、Playwright 镜像版本一致性等，详见 `PROGRESS.md`"提醒事项"。

### 11.4 遗留动作

服务器当前运行的镜像（ghcr latest）**尚未包含崩溃修复**（80cb92b 起）。请执行 `cd ~/theater-death && git pull && ./deploy/update.sh` 后确认；在此之前服务器仅供体验、不适合长时间对局。

## 12 结论

- §15 七组要求全部有覆盖（自动化 + 人工），覆盖矩阵见 §5；所有"未运行/未覆盖"项按需求**如实列出**（§9），并提供替代覆盖依据
- 未通过修改测试预期的方式掩盖任何实现问题；验收过程反哺修复了 1 个生产级崩溃（附复现与回归）
- 实验模式配置未计入"全部通过"（§8）
