# 前端资源

身份卡和两种卡框原样复制自工作区 Art Materials/IdentityCards；九个英文文件名对应契约 roleId。theater.png 与 death-overlay.png 原样取自用户提供的 UI 原始 zip，来源和 SHA256 见 sources.json。没有生成或替换人物。

avatar-sheet.png 是原始默认头像/死亡特效展示合图。Avatar 组件使用 SVG viewBox 显示大号头像区域（928,213,472,472）；DeathMark 使用左侧主星芒区域（48,110,490,675），配合 CSS 椭圆遮罩与 multiply 混合覆盖已公开死亡的头像。不显示合图中的说明文字，不修改或复制原位图。死亡烟雾和碎片在 Canvas 中按有界粒子预算绘制，无新增图片依赖。素材中的角色信息只用于已授权的身份视图，普通玩家席位使用账号头像。

本目录不包含真实玩家上传文件、邀请码或账号数据。
