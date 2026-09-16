import { describe, expect, it } from 'vitest';
import {
  confirmProposal,
  createProposalState,
  editProposal,
  lockedVersion,
} from '../engine/proposal.ts';

const members = ['a', 'b', 'c'] as const;

describe('团队确认机制（R-47）', () => {
  it('全员确认同一版本后锁定', () => {
    let state = createProposalState();
    state = editProposal(state, members, 'a', ['t1']);
    state = confirmProposal(state, members, 'a', 1);
    state = confirmProposal(state, members, 'b', 1);
    expect(lockedVersion(state, members)).toBeNull();

    state = confirmProposal(state, members, 'c', 1);
    expect(lockedVersion(state, members)?.targetPlayerIds).toEqual(['t1']);
  });

  it('编辑产生新版本，旧版本的确认不会迁移到新版本', () => {
    let state = createProposalState();
    state = editProposal(state, members, 'a', ['t1']);
    state = confirmProposal(state, members, 'a', 1);
    state = confirmProposal(state, members, 'b', 1);
    state = confirmProposal(state, members, 'c', 1);

    state = editProposal(state, members, 'b', ['t2']);
    expect(lockedVersion(state, members)?.targetPlayerIds).toEqual(['t1']);

    state = confirmProposal(state, members, 'c', 2);
    expect(lockedVersion(state, members)?.targetPlayerIds).toEqual(['t1']);
  });

  it('新版本重新全员确认后取最新版本', () => {
    let state = createProposalState();
    state = editProposal(state, members, 'a', ['t1']);
    for (const member of members) {
      state = confirmProposal(state, members, member, 1);
    }
    state = editProposal(state, members, 'b', ['t2']);
    for (const member of members) {
      state = confirmProposal(state, members, member, 2);
    }
    expect(lockedVersion(state, members)?.revision).toBe(2);
    expect(lockedVersion(state, members)?.targetPlayerIds).toEqual(['t2']);
  });

  it('重复确认幂等', () => {
    let state = createProposalState();
    state = editProposal(state, members, 'a', ['t1']);
    state = confirmProposal(state, members, 'a', 1);
    const again = confirmProposal(state, members, 'a', 1);
    expect(again).toBe(state);
  });

  it('单人池提交即视为全员确认（死神一阶段）', () => {
    let state = createProposalState();
    state = editProposal(state, ['solo'], 'solo', ['t1']);
    expect(lockedVersion(state, ['solo'])?.targetPlayerIds).toEqual(['t1']);
  });

  it('成员死亡后按当前有资格成员重算锁定', () => {
    let state = createProposalState();
    state = editProposal(state, members, 'a', ['t1']);
    state = confirmProposal(state, members, 'a', 1);
    state = confirmProposal(state, members, 'b', 1);
    expect(lockedVersion(state, members)).toBeNull();

    expect(lockedVersion(state, ['a', 'b'])?.targetPlayerIds).toEqual(['t1']);
  });

  it('没有任何全员确认版本时截止取空方案', () => {
    let state = createProposalState();
    state = editProposal(state, members, 'a', ['t1']);
    state = confirmProposal(state, members, 'a', 1);
    expect(lockedVersion(state, members)).toBeNull();
  });

  it('非成员不能编辑或确认', () => {
    const state = createProposalState();
    expect(() => editProposal(state, members, 'x', ['t1'])).toThrow();
    const withVersion = editProposal(state, members, 'a', ['t1']);
    expect(() => confirmProposal(withVersion, members, 'x', 1)).toThrow();
  });
});
