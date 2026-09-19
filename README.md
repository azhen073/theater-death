# 剧院死神：新版前端与账号协议 2.2

13 人社交推理游戏在线法官。新版使用 `server/v2` 与 `web-v2`，规则版本 2.0，客户端契约 2.2。账号、席位控制、公共语音和管理入口由同一服务提供。

## Docker 本地启动

在仓库根目录执行，先将 `.env.frontend-local.example` 复制为 `.env.frontend-local` 并设置管理员密码：

```sh
docker build -f deploy/Dockerfile.dependencies -t theater-death-contract-deps:sharp0354-ajv820 .
docker build -f deploy/Dockerfile.frontend-v2 -t theater-death-frontend-v2:local .
docker compose --env-file .env.frontend-local -f deploy/compose.frontend-local.yml up -d --no-build app
```

访问 http://localhost:5174，管理入口 `/admin`。默认关闭语音；账号库保存在命名数据卷中。

## 技术文档

- [本次 PR 说明](PR_DESCRIPTION.md)
- [账号契约 2.2](docs/client-contract-2.2.md)
- [API OpenAPI](docs/openapi-v2.2.json)
- [管理功能](docs/frontend-v2-admin.md)
- [公共语音与自托管部署](docs/frontend-v2-voice.md)
- [房间退出规则](docs/frontend-v2-room-exit.md)
- [游戏规则](docs/rules-v2-full.md)

`web/`、旧版服务与回归测试保留供兼容维护。默认旧版 release 工作流仍以旧部署入口为目标；新版上线需明确选择 `deploy/Dockerfile.frontend-v2`，不能把旧工作流产物当作新版候选。

交付图片位于 `web-v2/public/assets`，是页面运行所需资源；美术原稿和外层素材库未包含。包内无真实环境配置、账号数据和依赖目录。
