# 2.1 前端联调示例

以下示例随2.1候选交付；实施进度以进度文档为准。示例不包含前端UI，不替代OpenAPI和共享DTO。

可直接导入的最小辅助代码见 [contract-client.ts](examples/contract-client.ts)：统一HTTP发送、按账号/房间接收快照、单调时钟倒计时与头像版本保护。用户切换账号/房间时创建新的SnapshotCursor；收到需要清除授权的control时调用clear，关闭旧Socket。updated且gameChanged时清除旧局草稿，再渲染新的完整快照。

## 同源开发代理

Vite开发服务器示例：

```ts
export default {
  server: {
    port: 5173,
    proxy: {
      '/api/v2': { target: 'http://127.0.0.1:3003', changeOrigin: true, ws: true },
    },
  },
};
```

后端 `PUBLIC_BASE_URL` 设置为浏览器实际的前端origin `http://localhost:5173`，不是代理目的地址。`changeOrigin` 不会替你修改浏览器Origin。Cookie的Path覆盖HTTP与Socket路径；生产使用HTTPS/WSS与Secure Cookie。不要在代码中读取或拼接HttpOnly Cookie。

## 请求与未知结果

```ts
async function post(path: string, intent: object) {
  const response = await fetch(`/api/v2${path}`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(intent),
  });
  const body = await response.json();
  if (!response.ok) throw body.error;
  return body;
}

const intent = {
  requestId: crypto.randomUUID(), gameId: snapshot.gameId,
  windowInstanceId: task.windowInstanceId,
  action: task.action, targets: [...selectedPlayerIds],
};
// 保存这一份intent用于确认结果；一次重试不能换ID或目标。
const receipt = await post(`/rooms/${roomCode}/command`, intent);
// status为accepted/rejected；网络错误则结果未知，不能当作rejected。
```

网络错误后查询：

```ts
const url = `/api/v2/rooms/${roomCode}/games/${intent.gameId}/receipts/${encodeURIComponent(intent.requestId)}`;
const response = await fetch(url, { credentials: 'include' });
const receipt = await response.json();
// not_seen/pending: 继续确认；not_seen不等于执行失败。
// 必须重发时只重发上面的同一intent。
// 游戏已切换或授权已撤销：关闭旧局交互，不向新局重放旧意图。
```

## Socket与快照

```ts
import { io } from 'socket.io-client';
const socket = io({
  path: '/api/v2/socket.io',
  auth: { roomId }, withCredentials: true,
});
let latest = null;
let clockSample = { serverTime: 0, localTime: 0 };
socket.on('view_updated', (view) => {
  if (view.roomId !== activeRoomId || view.viewer.userId !== activeUserId) return;
  if (latest && view.viewVersion < latest.viewVersion) return;
  // 即使内容版本没变，仍可重新校准计时；UI状态只接收更新版本。
  if (view.serverTime >= clockSample.serverTime) {
    clockSample = { serverTime: view.serverTime, localTime: performance.now() };
  }
  if (latest && view.viewVersion <= latest.viewVersion) return;
  if (latest && view.gameId !== latest.gameId) clearGameDraftsAndPrivateCaches();
  latest = view;
  renderFromAuthorizedView(view);
});
const estimatedServerNow = () => clockSample.serverTime + performance.now() - clockSample.localTime;
const remainingMs = (window) => Math.max(0, window.closesAt - estimatedServerNow());
```

HTTP `/view` 响应也进入同一版本比较逻辑；不要让较慢的旧HTTP响应覆盖新Socket快照。网络传输存在时差，到零时显示等待同步，服务端决定窗口是否关闭。Socket断线只显示连接异常，不主动调用leave。重连后请求完整view；重新登录若返回takeover_required，等待用户明确接管。

切换账号或房间时同时清空latest与clockSample，并关闭旧Socket。服务端重启不会恢复原房间；room_not_found进入恢复入口，不沿用旧版本计数。

`control` 中的 host_changed/review_ended 会紧接完整快照；被移出、解散、接管或会话失效时立即清除旧授权界面，停止使用旧请求。screen_revoked 清除私人视角，公开观众身份由新快照确认，不继续使用旧角色或阵营缓存。

## 头像二进制上传

```ts
// croppedBlob来自前端裁剪确认，取消裁剪不发请求。
const response = await fetch('/api/v2/me/avatar', {
  method: 'PUT', credentials: 'include',
  headers: { 'Content-Type': croppedBlob.type },
  body: croppedBlob,
});
if (response.ok) {
  const profile = await response.json();
  // 丢弃切换账号后迟到的响应；旧版本不能覆盖较新的已确认资料。
  if (profile.userId === activeUserId && profile.profileVersion >= currentProfile.profileVersion) {
    replaceLocalProfile(profile);
  }
}
// 失败保留旧profile；avatarUrl为null时使用前端静态默认头像。
```

不要用JSON或Base64包装图片，也不要给上传请求设置JSON Content-Type。头像URL由服务端返回；不以用户文件名构造路径。取消本地选择不同于取消已经提交的服务器写入；上传响应未知时重新读取/auth/me确认最终资料。
