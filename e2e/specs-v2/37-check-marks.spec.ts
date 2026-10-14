import { expect, test, type Page } from '@playwright/test';
import { fixtureRoute, loadGameFixture, type GameHarnessFixture } from '../helpers-v2/game.ts';

interface Check { night: number; seat: number; kind: 'is_spirit' | 'in_death_faction'; answer: boolean }

const SELF_SEAT = loadGameFixture('night-spirit-full.json').view.private!.self.seat;

/**
 * 降临者视角夹具：克隆现有 fixture 后把 self 改成降临者并注入 `descender_check_result`
 * （该事件本来就是服务端只发给查验者本人的私有事件，见 engine/night.ts）。
 */
function descenderFixture(checks: Check[], options: { stage?: 1 | 2; sheriffSeat?: number | null } = {}): GameHarnessFixture {
  const fixture = loadGameFixture('night-spirit-full.json');
  fixture.identityReveal = 'seen';
  const seats = fixture.view.public!.seats;
  const seatOf = (number: number) => {
    const found = seats.find(item => item.seat === number);
    if (!found) throw new Error(`夹具缺少 ${number} 号座位`);
    return found;
  };
  fixture.view.private!.self = { ...fixture.view.private!.self, roleId: 'descender' };
  fixture.view.private!.knowledge = { spiritSeats: [] };
  fixture.view.public!.stage = options.stage ?? 1;
  fixture.view.public!.sheriff = {
    enabled: true,
    holderId: options.sheriffSeat === undefined || options.sheriffSeat === null ? null : seatOf(options.sheriffSeat).playerId,
  };
  fixture.view.private!.events = checks.map((check, index) => ({
    cursor: index + 1,
    type: 'descender_check_result',
    dayNumber: check.night,
    stage: check.kind === 'is_spirit' ? 1 : 2,
    payload: { nightNumber: check.night, targetPlayerId: seatOf(check.seat).playerId, targetSeat: check.seat, kind: check.kind, answer: check.answer },
  }));
  return fixture;
}

async function mount(page: Page, fixture: GameHarnessFixture): Promise<void> {
  await fixtureRoute(page, fixture);
  await page.goto('/game-test.html');
  await expect(page.getByRole('region', { name: '玩家舞台' })).toBeVisible();
}

/**
 * 夹具里 4 号是本人座位、13 号是已知魂灵。13 号作为对照（无查验时只有魂灵知识）。 */
const PLAIN_SEAT = 6;

const seatStrip = (page: Page, seatNumber: number) => page.locator(`.seat-main[aria-label^="${seatNumber}号 "] .badge-strip`);

async function stripFacts(page: Page, seatNumber: number) {
  return seatStrip(page, seatNumber).evaluate(element => ({
    labels: Array.from(element.querySelectorAll('.badge-strip__item')).map(item => item.textContent ?? ''),
    tones: Array.from(element.querySelectorAll('.badge-strip__item')).map(item => item.getAttribute('data-badge') ?? ''),
    backgrounds: Array.from(element.querySelectorAll('.badge-strip__item')).map(item => getComputedStyle(item).backgroundColor),
    // 统一尺寸（用户裁定 2026-10-04）：2/3/4 字一律 35 × 12px
    sizes: Array.from(element.querySelectorAll('.badge-strip__item')).map(item => {
      const box = item.getBoundingClientRect();
      return { width: Math.round(box.width), height: Math.round(box.height) };
    }),
    ariaLabel: element.getAttribute('aria-label'),
  }));
}

test('一阶段查验：魂灵 / 非魂灵（含颜色），一个座位只留最近一次，未查验座位无徽标', async ({ page }) => {
  await mount(page, descenderFixture([
    { night: 1, seat: 2, kind: 'is_spirit', answer: true },
    { night: 1, seat: 3, kind: 'is_spirit', answer: false },
    { night: 1, seat: 5, kind: 'is_spirit', answer: true },
    { night: 2, seat: 5, kind: 'is_spirit', answer: false },
  ]));

  const spirit = await stripFacts(page, 2);
  expect(spirit.labels).toEqual(['魂灵']);
  expect(spirit.tones).toEqual(['spirit']);
  expect(spirit.backgrounds).toEqual(['rgb(143, 59, 72)']); // 死神阵营色 --faction-death #8f3b48（用户裁定 2026-10-04）
  expect(spirit.sizes).toEqual([{ width: 35, height: 12 }]); // 2 字「魂灵」与 4 字同盒
  expect(spirit.ariaLabel).toBe('魂灵');

  const notSpirit = await stripFacts(page, 3);
  expect(notSpirit.labels).toEqual(['非魂灵']);
  expect(notSpirit.tones).toEqual(['checked-not-spirit']);
  expect(notSpirit.backgrounds).toEqual(['rgb(102, 113, 127)']); // 灰

  const latest = await stripFacts(page, 5);
  expect(latest.labels).toEqual(['非魂灵']); // 第 2 夜覆盖第 1 夜
  expect(latest.tones).toEqual(['checked-not-spirit']);

  await expect(seatStrip(page, PLAIN_SEAT)).toHaveCount(0);
});

test('二阶段查验：人类阵营（身份徽标同源蓝）/ 死神阵营（死神阵营色）', async ({ page }) => {
  await mount(page, descenderFixture([
    { night: 4, seat: 6, kind: 'in_death_faction', answer: false },
    { night: 4, seat: 7, kind: 'in_death_faction', answer: true },
  ], { stage: 2 }));

  const human = await stripFacts(page, 6);
  expect(human.labels).toEqual(['人类阵营']);
  expect(human.tones).toEqual(['checked-human']);
  expect(human.backgrounds).toEqual(['rgb(61, 107, 156)']); // --faction-human
  expect(human.sizes).toEqual([{ width: 35, height: 12 }]);

  const death = await stripFacts(page, 7);
  expect(death.labels).toEqual(['死神阵营']);
  expect(death.tones).toEqual(['checked-death']);
  expect(death.backgrounds).toEqual(['rgb(143, 59, 72)']); // 与魂灵统一取死神阵营色 --faction-death
  expect(death.sizes).toEqual([{ width: 35, height: 12 }]);
});

test('本人座位：查验过自己时抑制身份徽标；天理 + 查验共存；观众视角无徽标', async ({ page }) => {
  const fixture = descenderFixture([{ night: 1, seat: SELF_SEAT, kind: 'is_spirit', answer: true }], { sheriffSeat: SELF_SEAT });
  await mount(page, fixture);
  const own = await stripFacts(page, SELF_SEAT);
  expect(own.labels).toEqual(['天理', '魂灵']);
  expect(own.tones).toEqual(['sheriff', 'spirit']);

  const spectator = structuredClone(fixture);
  spectator.view.viewer = { ...spectator.view.viewer, kind: 'public_spectator', readOnly: true };
  spectator.view.private = null;
  spectator.view.public!.sheriff = { enabled: true, holderId: null }; // 天理是公开信息，这里只验证私有查验结果不外泄
  await mount(page, spectator);
  await expect(page.locator('.badge-strip')).toHaveCount(0);
});

test('排版：四档视口下查验徽标保持单排、卡片不变高、无横向溢出（含本人座位 + 天理 + 4 字）', async ({ page }, testInfo) => {
  await mount(page, descenderFixture([
    { night: 1, seat: SELF_SEAT, kind: 'in_death_faction', answer: false },
    { night: 1, seat: 7, kind: 'in_death_faction', answer: true },
    { night: 1, seat: 8, kind: 'is_spirit', answer: true },
  ], { stage: 2, sheriffSeat: SELF_SEAT }));

  for (const viewport of [{ width: 320, height: 720 }, { width: 390, height: 844 }, { width: 844, height: 700 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    const facts = await page.evaluate((seats: { own: number; plain: number; checked: number[] }) => {
      const read = (seatNumber: number) => {
        const card = Array.from(document.querySelectorAll<HTMLElement>('.seat-main'))
          .find(item => item.getAttribute('aria-label')?.startsWith(`${seatNumber}号 `));
        if (!card) return null;
        const row = card.querySelector<HTMLElement>('.seat-number')!;
        return {
          labels: Array.from(card.querySelectorAll('.badge-strip__item')).map(item => item.textContent ?? ''),
          rowHeight: Number(row.getBoundingClientRect().height.toFixed(2)),
          cardHeight: Number(card.getBoundingClientRect().height.toFixed(2)),
          // 只量徽标行自身：main 的 P1 给 .seat-main 加了 inset:-1px 的 ::before 装饰卡框（不占布局、pointer-events:none），
          // 会让整卡恒有 1px 装饰性溢出——实测所有座位、四档视口均为 1px，含没有任何徽标的对照座位，与徽标排版无关。
          rowOverflow: row.scrollWidth - row.clientWidth,
        };
      };
      return { own: read(seats.own)!, plain: read(seats.plain)!, checked: seats.checked.map(read) };
    }, { own: SELF_SEAT, plain: PLAIN_SEAT, checked: [SELF_SEAT, 7, 8] });

    expect(facts.own.labels).toEqual(['天理', '人类阵营']); // 身份徽标被抑制，4 字查验徽标 + 天理同排
    for (const item of facts.checked) {
      expect(item!.rowHeight).toBeLessThanOrEqual(facts.plain.rowHeight + 1);
      expect(item!.rowOverflow).toBeLessThanOrEqual(0);
    }
    expect(facts.checked.filter(item => item!.cardHeight !== facts.plain.cardHeight)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  // AGENTS.md「测试策略」：汇报用截图必须是整页（fullPage），不要只截视口或元素局部。
  await page.screenshot({ path: `/results/check-marks-${testInfo.project.name}.png`, fullPage: true });
});
