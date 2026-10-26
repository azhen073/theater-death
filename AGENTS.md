# theater_death 项目规则

《剧院死神》在线法官：13 人、9 身份社交推理游戏的服务端裁决系统。当前工程版本为 `v2.0.8-alpha`，规则版本为 `2.0`，客户端契约为 `2.2`。系统只保留 v2 入口。

## 必读文档

- `README.md`：项目总览、安装、构建和目录。
- `PROGRESS.md`：当前状态与交接。
- `docs/rules-v2-full.md`：现行完整玩法规则。
- `theater_death_development_requirements.md`：现行工程需求与验收边界。
- `docs/client-contract-2.2.md`、`docs/openapi-v2.2.json`：当前客户端契约。

## 架构约束

- 先实现纯规则和获批准的预期测试，再接网络与界面。
- 客户端只能提交意图；身份、权限和结果由服务端解析，不能信任载荷自报。
- 公共状态、个人历史和阵营历史必须先授权再发送，禁止先发全量再由页面隐藏。
- 同一角色的多个连接不能增加行动或票数。
- 引擎为纯函数，不依赖时钟、网络或浏览器；Node.js 直接运行 TypeScript，源码导入带 `.ts` 后缀。
- 默认使用规则 2.0 和契约 2.2，不再提供 v1 回滚入口。
- 公屏文字在对局内所有阶段可写，具体权限由建房时选择的 `alive_only` / `everyone` 决定；观众和第二屏只读。
- 对局内语音按 R-43 和当前阶段授权；大厅与复盘允许正式玩家自由开麦，观众和第二屏只订阅。
- 一套程序支持电脑和第三方托管，不复制规则引擎。
- 不擅自扩充服务器灾难恢复、录音、公开匹配和管理员改判。
- 规则改动必须同步条款引用、测试和当前文档，不能修改正确测试预期来掩盖实现错误。

## Docker 约束

- 构筑、测试和运行都在 Docker 容器内完成，宿主机不承担 Node.js 等运行时依赖。
- 开发、测试和生产使用同一镜像。
- 数据目录、端口、会话秘密和媒体配置通过 Compose 与环境变量注入；镜像不包含真实密钥。
- 标准构建：`docker compose -f deploy/docker-compose.yml build`。
- 依赖变化后在容器内更新 `package-lock.json`，不要在宿主机安装项目依赖。

## 声网资料核对

涉及声网实现的事实必须先在 `https://doc.shengwang.cn/` 或其官方文档 MCP Server 核对。其他域名只能作为参考，不能作为实施依据。官方未覆盖的行为不得凭非官方资料推断。

## 协作约束

- 改代码前先说明方案，得到用户同意后实施。
- 未经用户明确、直接的指令，不得 push 到任何 GitHub 远程仓库，也不得新建、改名、删除远程分支或创建 PR。
- 本地 commit 可以按用户要求执行。
- 报告真实执行的命令和结果；未运行、未覆盖的项目必须明确说明。

## 测试策略

- 默认只跑与改动相关的 Vitest 文件和 Playwright spec，不顺手运行全量 E2E。
- 全量回归只在用户明确要求时运行；标准 Docker 镜像构建链内的全量单元测试属于构建必要步骤。
- 纯文档或只读研究不必运行测试。
- 增量测试示例：

  ```bash
  docker compose -f deploy/compose.frontend.yml run --rm test node scripts/test-incremental.mjs tests/xxx.test.ts
  ```

- v2 E2E 示例：

  ```bash
  docker compose -f deploy/compose.frontend-acceptance.yml --profile acceptance run --rm browser npx playwright test --config=playwright.v2.config.ts specs-v2/xxx.spec.ts
  ```

- 浏览器测试后提供本次改动涉及界面或状态的整页截图，使用 `page.screenshot({ fullPage: true })`。截图是测试产物，不入源码；无法截图时必须说明。
