import { command, getView, type Client } from './api.ts';

export interface BotSeat {
  playerId: string;
  seat: number;
  alive: boolean;
}

export interface BotProposal {
  revision: number;
  confirmedBy: string[];
  locked: boolean;
}

export interface BotView {
  phase: string;
  windows: Array<{ id: string }>;
  hints: { speakerSeat: number | null; sheriffSeat: number | null; candidateSeats: number[] };
  proposal: BotProposal | null;
  view: {
    self: { playerId: string; seat: number; roleId: string; life: string };
    seats: BotSeat[];
  };
}

export async function botView(client: Client): Promise<BotView> {
  return (await getView(client)) as unknown as BotView;
}

/**
 * API 机器人的一步行动：按视图选择一个合法动作提交（rejected 不影响流程）。
 * `candidacy` 控制是否报名竞选（默认仅 1、2 号报名，保证唯一/少数候选人）。
 */
export async function botStep(
  client: Client,
  view: BotView,
  options: { candidacy?: boolean } = {},
): Promise<string | null> {
  if (view.phase !== 'night' && view.phase !== 'day' && view.phase !== 'morning') {
    return null;
  }
  const windowIds = new Set(view.windows.map((window) => window.id));
  const self = view.view.self;
  const aliveOthers = view.view.seats
    .filter((seat) => seat.alive && seat.playerId !== self.playerId)
    .map((seat) => seat.playerId);
  const target = aliveOthers[0] ?? null;
  const alive = self.life === 'alive';

  const fire = async (action: string, extra: Record<string, unknown> = {}): Promise<string> => {
    await command(client, action, extra);
    return action;
  };

  if (windowIds.has('faction') && (self.roleId === 'death' || self.roleId === 'spirit')) {
    if (view.proposal === null) {
      return null;
    }
    if (view.proposal.revision === 0) {
      return target !== null ? fire('EDIT_PROPOSAL', { targets: [target] }) : null;
    }
    if (!view.proposal.confirmedBy.includes(self.playerId)) {
      return fire('CONFIRM_PROPOSAL', { revision: view.proposal.revision });
    }
    return null;
  }
  if (windowIds.has('guard') && self.roleId === 'door') {
    return fire('SUBMIT_GUARD', { targets: target !== null ? [target] : [] });
  }
  if (windowIds.has('laike') && self.roleId === 'laike') {
    return target !== null ? fire('SUBMIT_LAIKE', { target }) : null;
  }
  if (windowIds.has('check') && self.roleId === 'descender') {
    return target !== null ? fire('SUBMIT_CHECK', { target }) : null;
  }
  if (windowIds.has('rescue') && self.roleId === 'water') {
    return fire('SUBMIT_RESCUE', { target: null });
  }
  if (windowIds.has('revive') && self.roleId === 'water') {
    return fire('SUBMIT_REVIVE', { target: null });
  }
  if (windowIds.has('last_words')) {
    return fire('END_LAST_WORDS');
  }
  if (windowIds.has('election_signup') && alive && (options.candidacy ?? self.seat <= 2)) {
    return fire('REGISTER_CANDIDACY');
  }
  if (windowIds.has('election_speech')) {
    return fire('END_ELECTION_SPEECH');
  }
  if (windowIds.has('election_vote') || windowIds.has('election_revote')) {
    const candidate = view.hints.candidateSeats[0];
    const targetId =
      candidate === undefined
        ? null
        : view.view.seats.find((seat) => seat.seat === candidate)?.playerId ?? null;
    return alive ? fire('SUBMIT_ELECTION_VOTE', { target: targetId }) : null;
  }
  if (windowIds.has('speech_order')) {
    return null;
  }
  if (windowIds.has('speech_round')) {
    return fire('END_SPEECH');
  }
  if (windowIds.has('tie_speech')) {
    return fire('END_TIE_SPEECH');
  }
  if (windowIds.has('vote') || windowIds.has('vote_revote')) {
    return alive ? fire('SUBMIT_DAY_VOTE', { target }) : null;
  }
  if (windowIds.has('handover')) {
    return fire('SUBMIT_HANDOVER', { target: null });
  }
  return null;
}
