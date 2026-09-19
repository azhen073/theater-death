# 后端 v2 本机运行与交付

开发基线cc3e48e。旧3000部署保持固定镜像及data，v2使用3001与独立data-v2。本文记录的是 **v2 后端候选阶段**（当时新前端尚未开发，打开3001只会看到API信息）；该体系已于 2026-09-19 随需求 v1.8 准入 main，web-v2 前端与声网语音均已交付，本文仅作候选阶段历史与运维参考。当前部署方式见 `deploy/RUNBOOK.md`。

## 开发和增量验证

在仓库根目录运行，先启动Docker Desktop：

```powershell
docker compose -f deploy/compose.v2.yml run --rm --no-deps test node scripts/test-incremental.mjs tests/v2-api.test.ts
docker compose -f deploy/compose.v2.yml run --rm --no-deps test npm run typecheck
docker compose -f deploy/compose.v2.yml --profile app up -d app
```

测试容器只读挂载当前源码，依赖镜像固定。锁文件语义变化时测试入口会拒绝运行，需要刷新依赖镜像，而不是继续测试旧依赖。不开全量E2E。gpt-5.6-luna测试子代理负责约定的增量集合，主代理审阅证据。

## 候选镜像

```powershell
docker build -f deploy/Dockerfile.v2 -t theater-death-v2:<源码提交SHA> .
```

只在候选构建执行一次全量单元/API门禁。构建后记录本地image ID和Docker实际返回的摘要。containerd镜像存储可能为本地构建记录RepoDigest；这不代表镜像已经上传注册表，不能将本地摘要冒充远端发布记录。

把本地已验证标签写入不入库的 `.env.v2` 中的 `V2_IMAGE`，其余配置参考 `.env.v2.example`。先停止占用3001的开发app，再启动候选：

```powershell
docker compose -f deploy/compose.v2.yml --profile app stop app
powershell -NoProfile -ExecutionPolicy Bypass -File deploy/v2.ps1 -Action start
powershell -NoProfile -ExecutionPolicy Bypass -File deploy/v2.ps1 -Action status
```

维护账号（命令会输出邀请/重置凭证，应私下传递给对应玩家）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File deploy/v2.ps1 -Action invite
powershell -NoProfile -ExecutionPolicy Bypass -File deploy/v2.ps1 -Action revoke-invite -Value <邀请ID>
powershell -NoProfile -ExecutionPolicy Bypass -File deploy/v2.ps1 -Action reset-password -Value <账号名>
```

启动器也支持logs/stop。不要把.env.v2、data-v2、测试fixture或邀请码提交到Git。备份前先停止v2服务，备份整个data-v2目录（含SQLite的WAL/SHM，如仍存在）；恢复时只能恢复匹配的数据库schema与镜像版本。账号与日志分别在accounts.sqlite和audit.sqlite。邀请制首版不提供网页管理员或邮件服务。

## 容量验收

使用compose.v2.load.yml叠加配置：load-app限2核/4GB、端口3002、专用data-v2-load，外置load-client容器。seed脚本拒绝非空账号库；100个账号使用负载专用凭证，登录性能不计入普通游戏指标。结果文件test-results-v2/capacity.json不含凭证；load-fixture.json含测试凭证，保持Git忽略。

```powershell
docker compose -f deploy/compose.v2.yml -f deploy/compose.v2.load.yml --profile load run --rm --no-deps load-client node scripts/v2-capacity-seed.ts
docker compose -f deploy/compose.v2.yml -f deploy/compose.v2.load.yml --profile load up -d load-app
docker compose -f deploy/compose.v2.yml -f deploy/compose.v2.load.yml --profile load run --rm --no-deps load-client
```

两个13人房间与24名公开观众，共50连接，持续5分钟；默认玩法计时不缩短。合格目标：普通API P95<300ms、event-loop P99<100ms、RSS<1GB，无异常5xx/断线/越权或幂等错误。测试完成后停止load-app；不要用compose down误停开发服务。

## 发布与回滚

功能分支CI根据改动选择测试；只做文档变更不运行测试，未映射的运行代码或共享测试helper变更要求补充明确测试集合。候选Dockerfile保留完整单测门禁；当前没有推送或触发GitHub Actions，远端CI仍需实际PR后确认。

本次只提供本地候选，不切换旧3000入口。新前端完成并通过联调后，在无进行中对局时发布。回滚使用记录的旧镜像及匹配数据库备份；数据库迁移采用新增表/列，不用旧镜像读未知新版schema。公网部署再配置HTTPS/WSS即可（2026-09-19 起媒体为**声网 Agora 托管**：客户端出站连接，不需要媒体入站端口，也不需要 LiveKit 签名 Webhook），媒体需要独立双设备验收。
