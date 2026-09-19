// 部署入口：默认启动新版（v2）体系；ENTRY=v1 时启动旧版（回滚用，旧版 E2E 用例依赖）。
if (process.env.ENTRY === 'v1') {
  await import('./legacy-index.ts');
} else {
  await import('./v2/index.ts');
}
