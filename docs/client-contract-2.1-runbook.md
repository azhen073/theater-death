# 契约 2.1 开发与候选维护

契约2.1候选已部署到本机3001，[验收记录](client-contract-2.1-acceptance.md)固定源码、镜像与测试结果。完整计划见 [实施计划](client-contract-2.1-plan.md)，逐步证据见 [进度](client-contract-2.1-progress.md)。本次不部署前端或公网服务。

## 隔离开发

旧网页3000使用固定上游镜像。3001现运行2.1候选，旧候选镜像与升级前数据仍保留。开发3003使用独立 `data-contract-2.1` 与 Cookie `td_account_contract_21`；因为浏览器Cookie不按端口隔离，不能改成3001同名Cookie。账号迁移先用副本验证；禁止把开发副本覆盖到正式目录。

```powershell
docker compose -f deploy/compose.contract.yml run --rm --no-deps test node scripts/test-incremental.mjs tests/room-membership.test.ts
docker compose -f deploy/compose.contract.yml run --rm --no-deps test npm run typecheck
docker compose -f deploy/compose.contract.yml --profile app up -d app
```

测试使用工作树的只读挂载。只有依赖发生变化才更新依赖镜像；不能用运行中的发布容器测试其内部旧源码来证明当前修改。构建/运行均在Docker中，不在Windows安装npm依赖。候选镜像只挂载数据，源码固定为候选SHA。

开发app使用普通Node启动，没有热重载。每次经过验证的源码更新后，执行 `docker compose -f deploy/compose.contract.yml --profile app restart app` 才会加载新模块；这会结束开发实例的内存对局。一次性测试容器每次都重新读取只读源码，不依赖这个长期开发进程的版本。

## Windows Docker启动问题

本次启动日志确认 `Docker/run/sailor-ingest.sock` 和 `docker-secrets-engine/engine.sock` 失效。停止失败的Desktop/backend进程，核对目录只含运行socket后，将这两个目录改名留存，再重建空目录并启动即可恢复。未使用factory reset，未删除虚拟磁盘或镜像。这个动作只适用于已确认的相同错误，不能把所有Docker启动失败都按此处理。

日志位置：`C:/Users/xumat/AppData/Local/Docker/log/host/com.docker.backend.exe.log*`（包含轮转文件）。本机Docker路径：`C:/Users/xumat/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe`。如果代理沙箱账号的LOCALAPPDATA不同，应使用实际安装路径。启动时使用隐藏窗口，界面需要用户操作时另行说明。

2026-09-19补充：正常CLI重启也复现了Ingest socket错误，因此上述处理只能称为临时恢复，不能认为已根治。5174现在有专用 `deploy/frontend-local.ps1` 启动/健康检查入口和 `deploy/recover-docker-sockets.ps1` 保守恢复入口；限制、预览及操作说明见 [前端交付手册](frontend-v2-handoff.md#日常启动和-docker-故障恢复)。不将恢复操作放进正常启动脚本，也不对正常运行的引擎隔离socket目录。

## 切换与回滚约束

切换只发生在确认无进行中对局之后。先保存当前部署镜像SHA/摘要，对 `data-v2` 做新的完整备份；数据库在线备份必须使用SQLite备份API，或先停该服务再复制整个目录（包括WAL/SHM）。迁移仅增加列/表，不迁移旧匿名Cookie为账号。有效账号会话保持，内存房间不恢复。

2.1候选切到3001时使用正常Cookie `td_account_v2`。回滚同时恢复旧镜像与对应备份数据库；旧AccountStore会拒绝高于其认识范围的schema，不能只回滚代码。保留3000服务供旧网页使用；最终前端入口切换是后续任务。

候选镜像、标签、schema、备份路径与实际命令在发布步骤完成后记录到进度/验收文档。没有这些证据时，本手册中的发布流程不等于已经部署完成。

本次切换前旧3001各账号/审计表均为空，没有进行中对局。旧库及配置备份在 `D:/myApps/暴风雪剧院/v2-data-backup-20260919-before-contract-2.1`。新旧镜像分别读取升级副本/原备份副本的检查已完成。冷备份WAL库在完全只读目录中可能无法创建临时锁文件；做验证时先复制一份到可写临时目录，保留原备份不变。

审计库新迁移使用 `PRAGMA user_version=1`，新增聊天消息和客户端关联ID列；历史消息列值为空，原记录保持。账号库有独立的 `schema_migrations` 版本表，两者的版本号不能混用。回滚的备份必须来自切换前同一时间段，不能拿早期开发副本替代。

## 头像依赖依据（供步骤11实现核对）

2026-09-18核对Sharp官方版本记录，当前选择固定版本0.35.4；它支持本项目Node24运行时。安装和锁文件更新在Linux Docker中执行，避免把Windows平台二进制写进运行依赖。依赖镜像单独更新，不触发发布全量门禁。[版本记录](https://sharp.pixelplumbing.com/changelog/v0.35.4/) · [安装条件](https://sharp.pixelplumbing.com/install/)

准备记录：隔离目录生成Sharp0.35.4/Ajv8.20.0锁文件并完成依赖层构建；214个原锁条目中已有包版本变化为0，新锁共249条目。测试及开发实例已切换到 `theater-death-contract-deps:sharp0354-ajv820`，manifest `sha256:ff3d66fe93bf9145f565b8b5bb983b49a4d0ab253fdecd5e88783554b44f3768`。业务验证范围以progress为准，依赖安装成功本身不是头像或契约验收。

依赖层切换使用仓库的 `deploy/Dockerfile.dependencies` 与现有锁文件；`docker compose -f deploy/compose.contract.yml build test` 仅构建依赖，不执行候选全量门禁。候选才使用 `deploy/Dockerfile.v2`。增量入口会检查容器内锁文件和只读工作树锁的语义一致性，不能把改过的package挂到旧依赖镜像后忽略检查。

2.1功能PR使用backend-v2-check增量工作流；只有手动运行backend-v2-candidate时才执行候选完整单元/API镜像门禁，不自动推送镜像或部署。原仓库旧版main发布工作流保留，不能将其输出当作2.1后端候选。镜像revision标签通过VCS_REF记录真实源码提交；本地候选同样传入完整SHA。

采用输入像素上限和严格无效数据处理，图片任务另设并发上限。Sharp的concurrency控制每张图片的处理线程，不等同于请求并发限制。metadata中的pages可识别WebP多帧；PNG动画还需检查APNG控制块，不能假设pages覆盖所有格式。[构造参数](https://sharp.pixelplumbing.com/api-constructor/) · [输入元数据](https://sharp.pixelplumbing.com/api-input/) · [线程控制](https://sharp.pixelplumbing.com/api-utility/)

输出重编码为256×256 WebP，不调用keepMetadata/withMetadata；Sharp默认移除元数据。验证仍须覆盖伪装格式、过量像素、动画以及写入失败后旧引用保留。[输出元数据策略](https://sharp.pixelplumbing.com/api-output/#keepmetadata)

契约验证采用Ajv的2020-12导出校验OpenAPI3.1中的JSON Schema及实际响应样例；不能把草稿07验证器直接当成2020-12验证器。[Ajv版本支持](https://ajv.js.org/json-schema)

动画输入在解码前检查PNG的acTL/fcTL/fdAT和WebP的ANIM/ANMF/VP8X动画标志，同时由解码器验证格式和页数。块长度也必须有效；不能只检查扩展名或HTTP Content-Type。[PNG第三版规范](https://www.w3.org/TR/png-3/) · [WebP容器规范](https://developers.google.com/speed/webp/docs/riff_container)

## 本机启动与账号维护

在PowerShell进入仓库。已保存的.env.v2使用固定镜像摘要，下面的up只启动该候选，不执行发布构建：

```powershell
Set-Location 'D:/myApps/暴风雪剧院/theater-death'
$dockerCli = 'C:/Users/xumat/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe'
& $dockerCli compose --env-file .env.v2 -f deploy/compose.v2.release.yml up -d app
& $dockerCli compose --env-file .env.v2 -f deploy/compose.v2.release.yml ps
& $dockerCli compose --env-file .env.v2 -f deploy/compose.v2.release.yml logs --tail 50 app
```

账号需要一次性注册邀请；无游客入口、没有网页管理员。以下命令在当前候选内操作账号库，输出token供注册或密码重置接口使用：

```powershell
& $dockerCli compose --env-file .env.v2 -f deploy/compose.v2.release.yml exec -T app node server/v2/admin.ts invite
& $dockerCli compose --env-file .env.v2 -f deploy/compose.v2.release.yml exec -T app node server/v2/admin.ts revoke-invite INVITATION_ID
& $dockerCli compose --env-file .env.v2 -f deploy/compose.v2.release.yml exec -T app node server/v2/admin.ts reset-password USERNAME
```

注册邀请默认7天，重置token默认30分钟。注册预检不消费token；账号创建时一次性消费。重置完成后全部旧会话失效。使用3003开发环境时将compose文件换为compose.contract.yml，确保操作的是独立开发账号库。

停止服务使用同一compose的stop app。重启保留账号、会话、头像和审计，进行中的内存对局不会恢复，因此先确认没有进行中对局。

## 配套回滚示例

此操作会回到备份时点；先保留当前数据，以便处理切换后新增的账号/头像。只在需要回滚时执行，本文没有对已上线候选实际执行回滚。

```powershell
$ErrorActionPreference = 'Stop'
$scopeRoot = [System.IO.Path]::GetFullPath('D:/myApps/暴风雪剧院')
$repoPath = Join-Path $scopeRoot 'theater-death'
$activeData = Join-Path $repoPath 'data-v2'
$preservedData = Join-Path $scopeRoot ('v2-preserved-after-contract21-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$backupRoot = Join-Path $scopeRoot 'v2-data-backup-20260919-before-contract-2.1'
foreach ($targetPath in @($activeData, $preservedData)) {
  $resolvedPath = [System.IO.Path]::GetFullPath($targetPath)
  if (-not $resolvedPath.StartsWith($scopeRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw '路径越出工作区' }
}
if (Test-Path -LiteralPath $preservedData) { throw '保留目录已经存在' }
if (-not (Test-Path -LiteralPath (Join-Path $backupRoot 'data/accounts.sqlite'))) { throw '备份不完整' }
if ((Get-Item -LiteralPath $activeData).Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw '数据目录为链接，先核对真实位置' }
Set-Location $repoPath
$dockerCli = 'C:/Users/xumat/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe'
& $dockerCli compose --env-file .env.v2 -f deploy/compose.v2.release.yml stop app
if ($LASTEXITCODE -ne 0) { throw '服务停止失败' }
Move-Item -LiteralPath $activeData -Destination $preservedData
Copy-Item -LiteralPath (Join-Path $backupRoot 'data') -Destination $activeData -Recurse
Copy-Item -LiteralPath (Join-Path $backupRoot 'deployment.env.v2') -Destination (Join-Path $repoPath '.env.v2')
$env:V2_IMAGE = 'sha256:c08b5617b6e018479f1c50d902d42114561d55483e8cca047db9292ba248e913'
& $dockerCli compose --env-file .env.v2 -f deploy/compose.v2.release.yml up -d --no-deps app
if ($LASTEXITCODE -ne 0) { throw '旧候选启动失败' }
```

回滚后检查health与对应schema；保留新数据目录和备份。不要仅换旧镜像而继续挂载schema2，旧程序已实测会拒绝启动。
