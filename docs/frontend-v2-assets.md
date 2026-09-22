# 新前端素材来源核验

2026-09-19已逐一比对14张交付PNG与用户提供的原文件或ZIP条目的SHA256，全部一致；13产物联验也确认这些图片由实际候选镜像同源返回200。没有生成、重绘或替换角色人物。

九张身份卡的roleId、目标文件、原始文件及哈希见web-v2/public/assets/sources.json。其Art Materials路径相对工作区根目录。

sources.json中theater.png和death-overlay.png的source字段是ZIP内条目路径，不能作为磁盘文件路径直接打开。原压缩包位于工作区 `UI raw materials/7.0 Wraith's Nocturne-20260917T174039Z-1-001.zip`：

| 交付文件 | ZIP条目 | SHA256 |
| --- | --- | --- |
| theater.png | 7.0 Wraith_s Nocturne/UI_Img_ZDAQBookPhotoDialog_PhotoBg.png | af309ed76255db42355d7482819253fe889e5cc684ee36cb5c373f6fc01cec0d |
| death-overlay.png | 7.0 Wraith_s Nocturne/UI_Img_ZDAQBookInfoDialog_Death_03.png | 9b9fdfeb6bce0f950a9925f5b31e52372277c6217d84d46ae478093fc0ff8270 |

另外三张原样复制的图片：

| 交付文件 | 原文件（相对Art Materials） | SHA256 |
| --- | --- | --- |
| avatar-sheet.png | 死亡特效和默认头像.png | fafd03685d7dd377dc86ec2f60d238edf8be7802d886542f51d1f6831e17d73b |
| frames/human.png | IdentityCards/frames/frame_human.png | c6911beb74a8c3fe00f35c621dc7f1edd10e02cc43403ddddd46e34ff470782c |
| frames/death.png | IdentityCards/frames/frame_death.png | 0d4bf34a28bad6814f459b1c20d74a910d7f02b7a0228cb6dafb2f46d66af940 |

默认头像通过SVG viewBox（928,213,472,472）显示合图中的头像区域，原位图保持不变。实际桌面/手机产物截图已核验裁切与布局；截图中的纯黑头像是测试上传的一像素图片，不是默认头像素材。

2026-09-22 死亡特效迭代复用同一合图的主星芒区域（48,110,490,675）作为 `DeathMark`，通过 CSS 渐隐遮罩与 multiply 混合覆盖头像。已重新核实合图与工作区原件 SHA-256 一致；原位图不改动，没有新增或生成美术素材。烟雾与碎片由有数量上限的 Canvas 粒子绘制。旧 `death-overlay.png` 保留为既有资源，但不再用于右上角 48px 死亡提示。
