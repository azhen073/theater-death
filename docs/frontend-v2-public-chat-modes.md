# 公屏写权限档位

## 当前行为

对局内所有阶段均可发送公屏文字，具体范围由房主建房时显式选择：

- `alive_only`：仅存活正式玩家可写；死者只读，本人遗言窗口除外。
- `everyone`：存活和死亡正式玩家均可写。

观众和第二屏始终只读。大厅与复盘不使用对局公屏写权限，复盘内容按归档展示。夜间语音仍按 R-43 全体静音。

建房后档位不可修改。请求缺少 `publicChat` 或取值非法时返回 `invalid_public_chat`。`RoomSnapshot.room.publicChat` 返回当前档位，`capabilities.canPostPublic` 是客户端是否可写的唯一能力信号。

生死判定使用当前公开状态，不能用尚未公告的夜间死亡提前改变写权限，否则可能泄露死讯。

## 实现

- `contracts/v2.ts`：`PublicChatMode` 和房间字段。
- `visibility/chat.ts`：统一权限判定。
- `server/v2/`：建房校验、快照能力和聊天路由使用同一档位。
- `web-v2/`：建房单选、规则摘要、公屏页签和发送状态。
- 阵营交流记录位于公屏页签下方，阵营成员权限独立计算。
- OpenAPI 与 `tests/fixtures/contract-2.2/` 使用契约 2.2。

相关测试：`tests/visibility.test.ts`、`tests/capabilities.test.ts`、`tests/chat-receipts-api.test.ts`、`tests/v2-api.test.ts`。
