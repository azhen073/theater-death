export const COPY = {
  action: {
    idleTitle: '现在不需要你操作',
    idleSummary: '等待其他玩家行动，阶段会自动继续。',
    idleStatus: '无需操作',
    noAvailable: '当前没有可执行的操作',
    recentAccepted: (label: string) => `最近操作：「${label}」已提交，等待本阶段结算。`,
    recentRejected: (label: string) => `最近操作：「${label}」未被接受。`,
    emptyProposal: '提交“不攻击”方案',
    confirmEmptyProposal: '确认今晚不攻击',
  },
  chat: {
    offlineDraft: '连接恢复后可继续发送，草稿已保留。',
    readOnly: '你现在只能查看，暂时不能发言。',
  },
  spectator: {
    private: '私人观战视角',
    public: '公开观战视角',
    currentIdentity: '你正在查看的身份',
    identityDetails: '查看身份详情',
  },
  game: {
    alive: '存活',
  },
} as const;
