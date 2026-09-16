export interface ProposalVersion {
  readonly revision: number;
  readonly targetPlayerIds: readonly string[];
  readonly authorId: string;
  readonly confirmedBy: readonly string[];
}

export interface ProposalState {
  readonly versions: readonly ProposalVersion[];
}

export function createProposalState(): ProposalState {
  return { versions: [] };
}

export function editProposal(
  state: ProposalState,
  activeMemberIds: readonly string[],
  actorId: string,
  targetPlayerIds: readonly string[],
): ProposalState {
  assertActiveMember(activeMemberIds, actorId);

  const lastRevision = state.versions.length > 0 ? state.versions[state.versions.length - 1].revision : 0;
  const version: ProposalVersion = {
    revision: lastRevision + 1,
    targetPlayerIds: [...targetPlayerIds],
    authorId: actorId,
    confirmedBy: activeMemberIds.length === 1 ? [actorId] : [],
  };

  return { versions: [...state.versions, version] };
}

export function confirmProposal(
  state: ProposalState,
  activeMemberIds: readonly string[],
  actorId: string,
  revision: number,
): ProposalState {
  assertActiveMember(activeMemberIds, actorId);

  const index = state.versions.findIndex((version) => version.revision === revision);
  if (index === -1) {
    throw new Error(`方案版本 ${revision} 不存在`);
  }

  const version = state.versions[index];
  if (version.confirmedBy.includes(actorId)) {
    return state;
  }

  const updated: ProposalVersion = {
    ...version,
    confirmedBy: [...version.confirmedBy, actorId],
  };
  const versions = state.versions.map((item, itemIndex) => (itemIndex === index ? updated : item));
  return { versions };
}

export function lockedVersion(
  state: ProposalState,
  activeMemberIds: readonly string[],
): ProposalVersion | null {
  if (activeMemberIds.length === 0) return null;

  let best: ProposalVersion | null = null;
  for (const version of state.versions) {
    const allConfirmed = activeMemberIds.every((memberId) => version.confirmedBy.includes(memberId));
    if (allConfirmed && (best === null || version.revision > best.revision)) {
      best = version;
    }
  }
  return best;
}

function assertActiveMember(activeMemberIds: readonly string[], actorId: string): void {
  if (!activeMemberIds.includes(actorId)) {
    throw new Error(`成员 ${actorId} 当前没有行动资格`);
  }
}
