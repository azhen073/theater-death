import type { Page } from '@playwright/test';

/** 发言/遗言类：出现即立刻结束（加速流程）。 */
const END_SPEECH = [/结束遗言/, /结束竞选发言/, /结束平票发言/, /结束发言/];

/** 需要选择目标后确认的行动（按优先级尝试；按钮禁用时先点第一个座位）。 */
const ACTION_CONFIRM = [
  /确认刺杀/,
  /使用还魂曲/,
  /深海召回/,
  /查验/,
  /提交守护/,
  /投给选中者/,
  /指定继承/,
  /升序指定/,
  /提交草稿/,
  /确认草稿/,
];

/** 无需目标的兜底行动（低优先）。 */
const FALLBACK = [/弃权/, /空守/, /放弃刺杀/, /不使用/, /放弃移交/, /^放弃$/];

async function visible(page: Page, pattern: RegExp): Promise<boolean> {
  return page
    .getByRole('button', { name: pattern })
    .first()
    .isVisible()
    .catch(() => false);
}

async function clickFirst(page: Page, pattern: RegExp): Promise<void> {
  await page.getByRole('button', { name: pattern }).first().click();
}

/**
 * 跟随式机器人：检查页面当前可用的行动按钮并执行一个动作。
 * 覆盖全部角色面板（守护/刺杀/提案/查验/还魂/竞选/发言/投票/移交），
 * 返回执行的动作描述或 null。
 */
export async function actFollowing(page: Page): Promise<string | null> {
  // 1. 结束发言类（最高优先：加速窗口推进）
  for (const pattern of END_SPEECH) {
    if (await visible(page, pattern)) {
      await clickFirst(page, pattern);
      return String(pattern);
    }
  }

  // 2. 竞选报名
  if (await visible(page, /报名竞选天理/)) {
    await clickFirst(page, /报名竞选天理/);
    return '报名竞选天理';
  }

  // 3. 目标确认类行动
  for (const pattern of ACTION_CONFIRM) {
    const button = page.getByRole('button', { name: pattern }).first();
    if (!(await button.isVisible().catch(() => false))) {
      continue;
    }
    if (await button.isDisabled()) {
      const chip = page.locator('.picker button.chip').first();
      if (await chip.isVisible().catch(() => false)) {
        await chip.click();
      }
    }
    if (!(await button.isDisabled().catch(() => true))) {
      await button.click();
      return String(pattern);
    }
  }

  // 4. 无目标兜底
  for (const pattern of FALLBACK) {
    if (await visible(page, pattern)) {
      await clickFirst(page, pattern);
      return String(pattern);
    }
  }

  return null;
}
