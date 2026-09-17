import { expect, test } from '@playwright/test';
import { api, getView, setReady, setupLobby, startGame } from '../helpers/api.ts';
import { botStep, botView } from '../helpers/bot.ts';
import { spectateViaUi } from '../helpers/ui.ts';
import { FAST_BOARD } from '../helpers/board.ts';

const ROLE_NAMES: Record<string, string> = {
  laike: '莱莱可',
  door: '门先生',
  water: '水妖',
  descender: '降临者',
  researcher: '科研员',
  civilian: '平民',
  death: '死神',
  spirit: '魂灵',
  mourner: '丧亲者',
};

function errorCode(body: Record<string, unknown>): unknown {
  return (body.error as { code?: unknown } | undefined)?.code;
}

/**
 * 用例一：大厅期观战——入口页选择绑定目标，进入只读大厅，退出观战。
 */
test('大厅期观战：入口选择目标、只读大厅、退出观战', async ({ browser }) => {
  test.setTimeout(120_000);
  const lobby = await setupLobby({});

  const context = await browser.newContext();
  const page = await context.newPage();
  await spectateViaUi(page, {
    nickname: '观众',
    roomCode: lobby.roomCode,
    bindLabel: '玩家1',
  });

  await page.getByText(/观战模式（只读）/).waitFor({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: '准备', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '开始对局' })).toHaveCount(0);
  await expect(page.getByText('已有观众')).toHaveCount(0);
  await page.screenshot({ path: 'results/artifacts/spectate-lobby.png', fullPage: true });

  // 同一目标不可被第二个观众绑定
  const second = await api.post(`/api/rooms/${lobby.roomCode}/watch`, {
    nickname: '观众2',
    bindPlayerId: lobby.clients[0]!.playerId,
  });
  expect(second.status).toBe(409);
  expect(errorCode(second.json)).toBe('player_already_watched');

  await page.getByRole('button', { name: '退出观战' }).click();
  await page.getByRole('button', { name: '创建房间' }).waitFor({ timeout: 15_000 });
  await context.close();
});

/**
 * 用例二：对局中观战——视角与绑定玩家一致（服务端投影比对）、全量只读，
 * 机器人快进至终局后观众可查看同一份复盘。
 */
test('对局中观战：视角与绑定玩家一致、只读、终局复盘', async ({ browser }) => {
  test.setTimeout(480_000);
  const lobby = await setupLobby({ ruleset: FAST_BOARD });
  for (const client of lobby.clients) {
    await setReady(lobby.roomCode, client);
  }
  await startGame(lobby.roomCode, lobby.host);

  const bind = lobby.clients[0]!;
  const bindResponse = (await getView(bind)) as unknown as {
    view: { self: { roleId: string; seat: number; nickname: string }; seats: unknown; room: unknown };
  };
  const bindSelf = bindResponse.view.self;

  const context = await browser.newContext();
  const page = await context.newPage();
  await spectateViaUi(page, {
    nickname: '观众',
    roomCode: lobby.roomCode,
    bindLabel: bindSelf.nickname,
  });

  await page.getByText('绑定玩家的身份').waitFor({ timeout: 20_000 });
  await expect(page.locator('.me')).toContainText('观战');
  await expect(page.locator('.identity')).toContainText(bindSelf.nickname);
  await expect(page.locator('.identity')).toContainText(ROLE_NAMES[bindSelf.roleId] ?? bindSelf.roleId);
  await expect(page.getByText('你的行动')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '退出观战' })).toBeVisible();
  await expect(page.locator('.chat input')).toHaveAttribute('placeholder', '观战只读');
  await page.screenshot({ path: 'results/artifacts/spectate-game.png', fullPage: true });

  // 服务端投影一致性：观众视图的自身身份/座次/阵营房与绑定玩家逐字段一致
  // （事件游标与 serverTime 随时间前进，此处只比对不随时间变化的隐私核心面）
  const cookies = await context.cookies();
  const sessionValue = cookies.find((cookie) => cookie.name === 'td_session')?.value ?? '';
  const spectatorCookie = `td_session=${sessionValue}`;
  const spectatorView = (await api.get('/api/view', spectatorCookie)).json as unknown as {
    view: { self: unknown; seats: unknown; room: unknown };
    spectating: { bindPlayerId: string } | null;
    voice: { permission: { reason: string } };
  };
  expect(spectatorView.view.self).toEqual(bindResponse.view.self);
  expect(spectatorView.view.seats).toEqual(bindResponse.view.seats);
  expect(spectatorView.view.room).toEqual(bindResponse.view.room);
  expect(spectatorView.spectating?.bindPlayerId).toBe(bind.playerId);
  expect(spectatorView.voice.permission.reason).toBe('spectator');

  // 只读：命令与发言被拒
  const command = await api.post(
    '/api/command',
    { requestId: `e2e-sp-${Date.now()}`, action: 'REGISTER_CANDIDACY' },
    spectatorCookie,
  );
  expect(command.status).toBe(403);
  expect(errorCode(command.json)).toBe('spectator_readonly');
  const chat = await api.post('/api/chat', { channel: 'public', text: '不该发出去' }, spectatorCookie);
  expect(chat.status).toBe(403);
  expect(errorCode(chat.json)).toBe('spectator_readonly');

  // 机器人快进至终局
  const deadline = Date.now() + 360_000;
  let ended = false;
  while (Date.now() < deadline && !ended) {
    for (const client of lobby.clients) {
      const view = await botView(client);
      if (view.phase === 'ended') {
        ended = true;
        break;
      }
      await botStep(client, view).catch(() => null);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    if (!ended) {
      const hostView = await botView(lobby.host);
      if (hostView.phase === 'ended') {
        ended = true;
      } else {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
  }
  expect(ended, '对局应在时限内结束').toBe(true);

  // 观众的复盘与玩家同权（终局后），页面可打开复盘
  const review = await api.get('/api/review', spectatorCookie);
  expect(review.status).toBe(200);
  await page.getByRole('button', { name: '查看复盘' }).click({ timeout: 60_000 });
  await page.getByText(/阵营/).first().waitFor({ timeout: 20_000 });
  await page.screenshot({ path: 'results/artifacts/spectate-review.png', fullPage: true });

  await page.getByRole('button', { name: '关闭' }).click();
  await page.getByRole('button', { name: '退出观战' }).click();
  await page.getByRole('button', { name: '创建房间' }).waitFor({ timeout: 15_000 });
  await context.close();
});
