# 白天自由发言阶段

规则 2.0 的可选白天阶段，规则依据为 `rules-v2-full.md` 的 R-41 / R-43。

## 当前行为

- 房主建房时必须显式选择是否开启，没有默认值；选择冻结在本局规则中。
- 开启后，每个白天在发言轮之后、放逐投票之前插入固定 120 秒阶段。
- 阶段不提前结束。全体存活玩家可同时开麦，死者只能旁听。
- 没有唯一当前发言者，`autoMic` 不自动开麦。
- 界面根据本机远端电平显示正在说话的座位光环。
- 送达回执照常工作，按窗口和发布者集合聚合，不计发布者自己的回执。
- `RoomSnapshot.public.day.step` 为 `free_speech`，公开窗口 ID 为 `free_speech`。

## 契约与实现

- 建房请求必须包含布尔 `freeSpeech`，缺失或类型错误返回 `invalid_free_speech`。
- 开启时冻结 `timersSeconds.freeSpeech = 120`；关闭时不保留该键。
- `engine/day.ts` 负责阶段进入与推进，`server/day-driver.ts` 负责计时窗口。
- `voice/policy.ts` 决定发布权限，`server/v2/media.ts` 聚合送达状态。
- `web-v2/src/features/game/free-speech-note.ts` 按本人生死显示行动提示；缺少私有视图时退回通用文案，不猜测身份或生死。

相关测试：`tests/v2-free-speech.test.ts`、`tests/v2-media.test.ts`、`tests/frontend-v2-free-speech-note.test.ts`、`e2e/specs-v2/30-free-speech.spec.ts`。
