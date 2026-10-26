# 竞选投票阶段本人提示

## 当前行为

竞选投票阶段，行动卡向本人说明无投票资格的原因或已提交结果：

- 候选人：本轮不参与投票。
- 重投平票者：重投轮不参与投票。
- 死者：本轮不参与投票。
- 票权冻结：本轮不参与投票。
- 已投票：显示目标座位与昵称。
- 已弃票：明确显示弃票。

已退选者按 R-42 恢复投票权，不显示候选人禁投提示。目标座位无法解析时只显示“已投票”，不编造昵称。

提示只读取当前 `election_vote` 窗口实例的提交状态。重投使用新窗口，不复用首轮回执。

## 实现

`engine/day.ts` 统一计算禁投原因，`server/v2/view.ts` 通过 `private.electionVote.blockedReason` 提供。`web-v2/src/features/game/election-vote-notes.ts` 只读取原因码和当前窗口回执，行动展示层在通用等待提示之前使用；没有特殊提示时保持通用文案。

界面统一使用“竞选名单”，客户端不再复制投票资格判断。

相关测试：`tests/frontend-v2-election-vote-notes.test.ts`、`e2e/specs-v2/28-election-vote-notes.spec.ts`。
