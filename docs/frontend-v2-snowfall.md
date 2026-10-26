# 二阶段全局飘雪

## 当前行为

飘雪是纯前端装饰，只读取公开状态，不读取私有任务、身份或行动进度。

出现条件：

```text
room.phase === 'playing'
且存在 gameId 和 public
且 public.phase !== 'ended'
且 public.stage === 2
```

二阶段昼夜均显示；大厅、复盘、一阶段和离场不显示。观战与第二屏看到相同公开效果。减少动画、页面隐藏、离线或离场时卸载动画层。

## 呈现参数

| 项目 | 当前值 |
| --- | --- |
| 实现 | DOM + CSS，仅 `transform` 动画 |
| 直径 | 3–6px |
| 不透明度 | 0.12–0.34 |
| 下落时长 | 11–20 秒 |
| 数量 | `clamp(round(area / 13000), 45, 150)`，窄屏再乘 0.6 |
| 层级 | `z-index: 4`，`pointer-events: none` |

随机种子为 `gameId|roomId|dayNumber`，同一局同一天的刷新、重连和快照推送不会重新排列雪粒。负动画延迟使首帧即分布在整个图层。

实现文件：

- `web-v2/src/presentation/snowfall.ts`
- `web-v2/src/features/game/snowfall-layer.tsx`
- `web-v2/src/styles/snowfall.css`

相关测试：`tests/frontend-v2-snowfall.test.ts`、`e2e/specs-v2/36-snowfall.spec.ts`。
