export type NightCommand =
  | {
      readonly type: 'SUBMIT_GUARD';
      readonly playerId: string;
      readonly targetIds: readonly string[];
    }
  | {
      readonly type: 'SUBMIT_LAIKE';
      readonly playerId: string;
      readonly targetId: string | null;
    }
  | {
      readonly type: 'EDIT_PROPOSAL';
      readonly playerId: string;
      readonly targets: readonly string[];
    }
  | {
      readonly type: 'CONFIRM_PROPOSAL';
      readonly playerId: string;
      readonly revision: number;
    }
  | {
      readonly type: 'SUBMIT_CHECK';
      readonly playerId: string;
      readonly targetId: string;
    }
  | {
      readonly type: 'SUBMIT_RESCUE';
      readonly playerId: string;
      readonly targetId: string | null;
    }
  | {
      readonly type: 'SUBMIT_REVIVE';
      readonly playerId: string;
      readonly targetId: string | null;
    };

export type NightCommandType = NightCommand['type'];

export type DayCommand =
  | {
      readonly type: 'END_LAST_WORDS';
      readonly playerId: string;
    }
  | {
      readonly type: 'REGISTER_CANDIDACY';
      readonly playerId: string;
    }
  | {
      readonly type: 'WITHDRAW_CANDIDACY';
      readonly playerId: string;
    }
  | {
      readonly type: 'END_ELECTION_SPEECH';
      readonly playerId: string;
    }
  | {
      readonly type: 'SUBMIT_ELECTION_VOTE';
      readonly playerId: string;
      readonly targetId: string | null;
    }
  | {
      readonly type: 'DESIGNATE_SPEECH';
      readonly playerId: string;
      readonly startPlayerId: string;
      readonly direction: 'asc' | 'desc';
    }
  | {
      readonly type: 'END_SPEECH';
      readonly playerId: string;
    }
  | {
      readonly type: 'SUBMIT_DAY_VOTE';
      readonly playerId: string;
      readonly targetId: string | null;
    }
  | {
      readonly type: 'END_TIE_SPEECH';
      readonly playerId: string;
    }
  | {
      readonly type: 'SUBMIT_HANDOVER';
      readonly playerId: string;
      readonly targetId: string | null;
    };

export type DayCommandType = DayCommand['type'];

export type GameCommand = NightCommand | DayCommand;

export type GameCommandType = GameCommand['type'];
