# 前端素材来源

当前素材位于 `web-v2/public/assets/`。身份卡、人物、卡框和特殊叠加素材来自用户提供的美术目录与 UI 压缩包，没有使用 AI 生成人物。

## 来源

- `cards/`：九张身份卡，英文文件名对应契约 `roleId`。
- `frames/human.png`、`frames/death.png`：两类身份卡框。
- `avatar-sheet.png`：默认头像与死亡特效合图，来自工作区 `Art Materials/死亡特效和默认头像.png`。
- `theater.png`、`death-overlay.png`：来自工作区 `UI raw materials/` 中的原始 UI 压缩包。
- `ui-phase/`、`ui-night/`、`ui-speech/`：阶段转场、夜间氛围和发言光环素材。

`avatar-sheet.png` 使用固定区域裁切：默认头像为 `[928,213,472,472]`，主死亡星芒为 `[48,110,490,675]`，其他区域用于死亡粒子、碎片和消散。原位图不修改。

`death-overlay.png` 是保留资源，不作为当前座位死亡星芒的来源。死亡烟雾和碎片由有预算上限的 Canvas 粒子绘制。

## 核验

`web-v2/public/assets/sources.json` 登记原始来源、裁切区域和 SHA-256。修改或替换素材时必须同步该清单，并确认：

- 文件确实来自声明的原始素材。
- 角色图片只出现在已授权身份视图或复盘中。
- 普通座位使用账号头像，不泄露身份卡。
- 不包含真实玩家上传文件、账号数据、邀请码或密钥。
