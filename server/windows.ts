import type { GameCommand } from './commands.ts';
import type { LiveWindow, SubmitResult } from './night-driver.ts';

const commandWindows: Record<string, readonly string[]> = {
  SUBMIT_GUARD: ['guard'], SUBMIT_LAIKE: ['laike'], EDIT_PROPOSAL: ['faction'], CONFIRM_PROPOSAL: ['faction'],
  SUBMIT_CHECK: ['check'], SUBMIT_RESCUE: ['rescue'], SUBMIT_REVIVE: ['revive'],
  REGISTER_CANDIDACY: ['election_signup'], WITHDRAW_CANDIDACY: ['election_signup', 'election_speech', 'speech_prepare'],
  END_ELECTION_SPEECH: ['election_speech'], SUBMIT_ELECTION_VOTE: ['election_vote'], DESIGNATE_SPEECH: ['speech_order'],
  END_SPEECH: ['speech_round'], SUBMIT_DAY_VOTE: ['vote'], END_TIE_SPEECH: ['tie_speech'], END_LAST_WORDS: ['last_words'], SUBMIT_HANDOVER: ['handover'], START_SPEECH: ['speech_prepare'],
};
export function windowIssue(command: GameCommand, windows: readonly LiveWindow[], now: number): SubmitResult | null {
  const window = windows.find((w) => w.instanceId === command.windowInstanceId && command.windowInstanceId !== undefined);
  if (!window || !commandWindows[command.type]?.includes(window.id)) return { accepted: false, code: 'stale_window', message: '行动窗口已更换，请刷新状态' };
  if (now >= window.closesAt) return { accepted: false, code: 'window_closed', message: '行动窗口已截止' };
  return null;
}
