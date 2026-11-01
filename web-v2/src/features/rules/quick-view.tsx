import type { CatalogDTO } from '../../../../contracts/catalog.ts';
import type { RoomSnapshot } from '../../../../contracts/v2.ts';
import type { RoleId } from '../../../../rulesets/types.ts';
import { COPY } from '../../presentation/copy.ts';
import { actionLabels, publicPhaseLabel } from '../../presentation/labels.ts';
import { currentTask } from '../actions/model.ts';
import { phaseAbility } from '../game/phase-ability-model.ts';
import '../../styles/rules.css';

export function playerRuleChapters(catalog: CatalogDTO) {
  return catalog.rulebook.chapters.filter(chapter => chapter.id !== 'chapter-10');
}

export function currentOperation(view: RoomSnapshot): string[] {
  if (view.viewer.readOnly) return ['你正在观战，只能查看当前视角。'];
  const tasks = view.tasks.filter(task => currentTask(view, task));
  if (tasks.length > 0) return tasks.map(task => actionLabels[task.action]);
  if (view.capabilities.canPublishVoice) return ['可以开麦发言'];
  return [COPY.action.idleTitle];
}

export function RulesQuickView({ catalog, roleId, view, onChapter }: {
  catalog: CatalogDTO; roleId?: RoleId; view?: RoomSnapshot; onChapter: (chapterId: string) => void;
}) {
  const role = roleId ? catalog.roles.find(item => item.roleId === roleId) : undefined;
  const ability = role ? phaseAbility(role, view?.public?.stage ?? 1) : null;
  const roleChapter = roleId ? ['door', 'laike'].includes(roleId) ? 'chapter-04' : ['water', 'descender'].includes(roleId) ? 'chapter-05' : 'chapter-06' : null;
  const links = [
    { title: role ? '我的角色技能' : '身份与角色', chapter: roleChapter ?? 'chapter-06' },
    { title: '昼夜流程', chapter: 'chapter-03' },
    { title: '竞选与投票', chapter: 'chapter-09' },
    { title: '死亡与回归', chapter: 'chapter-07' },
    { title: '公屏与语音', chapter: 'chapter-08' },
    { title: '胜负条件', chapter: 'chapter-01' },
  ];
  return <div className="rules-quick">
    <section className="rules-quick__hero" aria-label="当前角色与阶段">
      <span className="eyebrow">NOW PLAYING</span>
      <h2>{role ? `你的身份：${role.name}` : '公开观战'}</h2>
      {view && <p className="rules-quick__phase">{publicPhaseLabel(view)}</p>}
      {role && <><p className="rules-quick__ability">{ability?.current}</p><p className="rules-quick__victory"><strong>胜利目标</strong><span>{role.victory}</span></p></>}
      {!role && <p>你可以查看公开对局、记录和规则，但不会获得私人身份与行动权限。</p>}
    </section>
    {view && <section className="rules-quick__actions" aria-label="当前操作提示"><h3>现在该做什么</h3>{currentOperation(view).map(operation => <p key={operation}>{operation}</p>)}<small>实际操作与倒计时以舞台和服务端状态为准。</small></section>}
    <section aria-label="快速查询规则"><h3>快速查规则</h3><div className="rules-quick__links">{links.map(link => <button type="button" className="rules-quick__link" key={link.title} onClick={() => onChapter(link.chapter)}><span>{link.title}</span><span aria-hidden="true">→</span></button>)}</div></section>
  </div>;
}
