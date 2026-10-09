# Web v2 竞选投票阶段本人提示（v2.0.7-alpha）

日期：2026-09-23
分支：`2.0.7-alpha`（本地，未推送）
性质：**纯客户端呈现增补**——不引入服务端接口、契约字段或规则变更。

## 背景（来自一次竞选 UI/UX 检查）

1. **无资格者得不到解释**：服务端只给有资格的玩家下发 `SUBMIT_ELECTION_VOTE` 任务（`server/capabilities.ts:45` 要求 `submitElectionVoteIssue(...) === null`；`server/v2/snapshots.ts:142` 的 `tasks` 只由 `allowedCommands` 派生）。候选人、重投平票者、死者、莱莱可翻牌冻结票权者因此**没有任务**，行动卡落到 `presentation.ts` 的 idle 分支，只显示「本阶段无需操作 / 等待其他玩家或服务端推进阶段。」——既不说明原因，也不提 R-42 / R-44。
2. **投票后没有回执**：投票被接受后 `already_voted` 使任务消失，卡片回到 idle；而 idle 分支只渲染 `summary`，`recentOutcome` 被关在 `{task && …}` 里，玩家看不到「已投给谁」，只能靠公开进度行推断。

## 方案

- **新增纯函数** `web-v2/src/features/game/election-vote-notes.ts`（无副作用、不读时间）：
  - `electionVoteNote(view)` → `receipt`（含 `skipped` / `seat` / `nickname`）| `blocked`（`candidate` / `tied` / `dead` / `vote_frozen`）| `null`；
  - `electionVoteNoteText(note)` → `{ title, summary }`（文案集中在一处，便于后续改词）。
- **唯一接线**：`web-v2/src/features/actions/presentation.ts` 的 idle 分支（第 2 段）用该文案替换 `title` / `summary`；`null` 时逐字保持原样。渲染零改动——idle 卡本来就渲染 `summary`。
- **判定顺序镜像引擎** `engine/day.ts` 的 `submitElectionVoteIssue`：死者 → 票权冻结（莱莱可翻牌禁投，R-44）→ 重投平票者（R-42）→ **未退选**候选人（R-42）。已退选者按 R-42 恢复投票权，不出提示（引擎用 `activeCandidates` = 候选 − 已退选）。
- **回执作用域**：只认 `view.windows` 里当前 `election_vote` 窗口实例的 `submissionState`；重投是新窗口实例，不复用首轮回执；`targets` 为空 = 弃票；目标座位查不到时退化为「已投票」，不编造昵称。
- **术语统一**：界面「上警名单」→「竞选名单」（`election-roster.tsx` 的 `h2` 与 `aria-label`，同步 `e2e/specs-v2/24-election-chat.spec.ts` 的 region 名）。规则书用「竞选 / 报名 / 天理」（R-41、R-42），不含「上警」一词。

## 文案（极简、不带条款号）

| 情形 | 标题（行动卡 h2） | 正文 |
| --- | --- | --- |
| 候选人 | 你是候选人 | 本轮不参与投票，等待其他玩家与结算。 |
| 重投平票者 | 你是平票者 | 重投轮不参与投票，等待结算。 |
| 死亡 | 你已死亡 | 本轮不参与投票，等待结算。 |
| 票权冻结 | 票权已冻结 | 本轮不参与投票，等待结算。 |
| 已投票 | 已投给 3号 昵称 | 不可更改，结算后公开票型。 |
| 已弃票 | 已弃票 | 不可更改，结算后公开票型。 |
| 目标座位查不到 | 已投票 | 不可更改，结算后公开票型。 |

## 隐私与边界

- 只读本人的私有字段（`private.self.life` / `voteFrozen`）与公开竞选字段，且只渲染在**本人的行动卡**上；公共竞选名单卡不包含资格信息，观众与第二屏不受影响（只读视角仍走「你正在只读观战」）。
- 首日竞选先于晨间公告（v2 命名预设）时，死者身份只对本人可见，不构成泄露。
- **结算后不保留回执**：`phase` 变为 `done` 或窗口关闭后回到通用文案。若要求结算后仍回看本人投票记录，需服务端在 `private` 中下发（属协议改动，本版不做）。

## 验证（2026-09-23，容器内实测）

环境：Docker Desktop（需先 `Start-Service com.docker.service` 再启动 Desktop，否则引擎管道不出现）；Compose project `theater-death-election-notes`；镜像 `theater-death-contract-deps:sharp0354-ajv820`、`theater-death-frontend-e2e:pw1630-ts`。

- **增量单测：3 文件 45 例全过**（`frontend-v2-election-vote-notes` 20 / `frontend-v2-action-presentation` 15 / `frontend-v2-room-model` 10），`vitest_exit=0`。
  `docker compose -p theater-death-election-notes -f deploy/compose.frontend.yml run --rm test node scripts/test-incremental.mjs tests/frontend-v2-election-vote-notes.test.ts tests/frontend-v2-action-presentation.test.ts tests/frontend-v2-room-model.test.ts`
- **类型检查与构建**：`typecheck:web:v2` exit 0、`typecheck:web:v2-tests` exit 0、`build:web:v2` exit 0（115 模块；`index.html` 0.59 kB + CSS 41.45 kB + JS 1991.84 kB，仅既有的「chunk > 500 kB」提示）。
- **E2E（验收栈 api+web，chromium + webkit）**：`28-election-vote-notes` + `24-election-chat` + `03-actions` **30 passed（39.2s，`playwright_exit=0`）**；新增 `28` 双浏览器 **10/10**。
  - 首轮 `28` 有 2 例失败（两浏览器各 1）：只读观众那例用 `getByRole('region', { name: '舞台行动' })` 定位行动卡，而只读视角下该卡 `aria-label` 是「观察玩家当前行动」→ **测试定位器错误**（非产品缺陷），改为同时匹配两个名字后双浏览器 10/10。
- **回归有效性对照**：把 `presentation.ts` idle 分支的接线临时还原（保留纯函数）后，`tests/frontend-v2-election-vote-notes.test.ts` **2 例失败**——正是「接入行动卡」组的「候选人说明」与「投票回执」两例；同组另 2 例断言的是通用文案（还原后仍成立），故不失败。恢复接线后 3 文件 45 例全过。
- **静态清点**（`it(` / `test(` 正则计数）：`tests/` **94 文件 / 654 例**（同口径较上一版 +1 文件 / +20 例；与维护方记录的 93 文件 643 例相差 9 例属计数方法差异，**未跑全量核对**）；`e2e/specs-v2` **29 文件 / 95 例**（维护方上一版 28 / 90，+1 spec / +5 例）。
- **收尾**：验收栈 `down -v`（容器 / 网络 / 卷均已删除）；临时备份文件已删除；测试只在本机 Docker 内运行。

**未跑**：全量 Vitest、全量 E2E、v1 入口 E2E、真实服务端流程的竞选用例（本版无服务端与契约改动）、镜像重建、部署。

## 未覆盖 / 未做

- 结算后回执保留（需协议改动）；真实服务端 E2E 的文案断言（本版改动为纯客户端派生，夹具驱动已覆盖）。
- 检查中列出的其余项未在本版处理：重投阶段标题区分（P3）、`election.speechOrder` 未用于界面（P4）、候选座位缺「候选」徽标（P5）、投票进度行的类名与 `aria-live`（P6）、v1 入口的竞选 UI 不对称（P8）。
