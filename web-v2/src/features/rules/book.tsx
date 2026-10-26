import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { CatalogDTO } from '../../../../contracts/catalog.ts';
import type { RoomSnapshot } from '../../../../contracts/v2.ts';
import type { RoleId } from '../../../../rulesets/types.ts';
import { Modal } from '../../components/ui.tsx';
import { playerRuleChapters, RulesQuickView } from './quick-view.tsx';
import { RuleSearchResults } from './search.tsx';

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) => part.startsWith('**') && part.endsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : part.startsWith('`') && part.endsWith('`') ? <code key={index}>{part.slice(1, -1)}</code> : part);
}

/** Render the rulebook's small Markdown vocabulary; raw HTML is always plain text. */
export function RuleMarkdown({ markdown, focusBlock = null }: { markdown: string; focusBlock?: number | null }) {
  return <div className="rule-markdown">{markdown.trim().split(/\r?\n\s*\r?\n/).map((block, index) => {
    const lines = block.split(/\r?\n/);
    const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
    let content: ReactNode;
    if (lines.length > 1 && lines[0]!.trim().startsWith('|') && /^\s*\|?[\s:|\-]+\|?\s*$/.test(lines[1]!)) {
      content = <div className="table-scroll"><table><thead><tr>{cells(lines[0]!).map((cell, i) => <th key={i}>{inline(cell)}</th>)}</tr></thead><tbody>{lines.slice(2).map((line, row) => <tr key={row}>{cells(line).map((cell, i) => <td key={i}>{inline(cell)}</td>)}</tr>)}</tbody></table></div>;
    } else if (lines.every(line => /^\s*[-*] /.test(line))) content = <ul>{lines.map((line, i) => <li key={i}>{inline(line.replace(/^\s*[-*] /, ''))}</li>)}</ul>;
    else if (lines.every(line => /^\s*\d+[.)] /.test(line))) content = <ol>{lines.map((line, i) => <li key={i}>{inline(line.replace(/^\s*\d+[.)] /, ''))}</li>)}</ol>;
    else if (lines.length === 1 && /^#{1,6} /.test(block)) content = <h3>{inline(block.replace(/^#{1,6} /, ''))}</h3>;
    else content = <p>{inline(block)}</p>;
    return <div id={`rule-block-${index}`} className={focusBlock === index ? 'rule-block rule-block--focus' : 'rule-block'} key={index}>{content}</div>;
  })}</div>;
}

export function RulesBook({ catalog, onClose, context, roleId, phase, view }: {
  catalog: CatalogDTO; onClose: () => void; context?: ReactNode; roleId?: RoleId; phase?: string; view?: RoomSnapshot;
}) {
  const chapters = playerRuleChapters(catalog);
  const [mode, setMode] = useState<'quick' | 'chapter'>('quick');
  const [chapterId, setChapterId] = useState(chapters[0]?.id ?? '');
  const [focusBlock, setFocusBlock] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const chapter = chapters.find(item => item.id === chapterId);
  const roleChapter = roleId ? ['door', 'laike'].includes(roleId) ? 'chapter-04' : ['water', 'descender'].includes(roleId) ? 'chapter-05' : 'chapter-06' : null;
  const phaseChapter = phase === 'night' ? 'chapter-03' : phase === 'day' || phase === 'morning' ? 'chapter-09' : null;
  const jump = (id: string, block: number | null = null) => {
    if (id !== chapterId) setHistory(old => [...old, chapterId]);
    setChapterId(id); setFocusBlock(block); setQuery(''); setMode('chapter');
  };
  useEffect(() => {
    if (mode !== 'chapter' || focusBlock === null) return;
    const frame = requestAnimationFrame(() => document.getElementById(`rule-block-${focusBlock}`)?.scrollIntoView({ block: 'start' }));
    return () => cancelAnimationFrame(frame);
  }, [mode, chapterId, focusBlock]);
  return <Modal title={`规则与玩法 · ${catalog.rulebook.version}`} onClose={onClose} context={context} className="rules-modal">
    <div className="rules-view-switch" aria-label="规则查看方式">
      <button className="button" aria-pressed={mode === 'quick' && !query} onClick={() => { setMode('quick'); setQuery(''); }}>现在怎么玩</button>
      <button className="button" aria-pressed={mode === 'chapter' && !query} onClick={() => { setMode('chapter'); setQuery(''); }}>完整条款</button>
    </div>
    <label className="select-field rules-search">搜索规则<input type="search" aria-label="搜索规则" value={query} onChange={event => setQuery(event.target.value)} placeholder="角色、条款编号或关键词"/></label>
    {query.trim() ? <RuleSearchResults catalog={catalog} query={query.trim()} onSelect={jump}/> : mode === 'quick' ? <RulesQuickView catalog={catalog} roleId={roleId} view={view} onChapter={jump}/> : <>
      {history.length > 0 && <button className="text-button" onClick={() => { const previous = history.at(-1)!; setHistory(old => old.slice(0, -1)); setChapterId(previous); setFocusBlock(null); }}>返回上一章节</button>}
      <label className="select-field">章节<select aria-label="规则章节" value={chapterId} onChange={event => jump(event.target.value)}>{chapters.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <div className="button-row">{roleChapter && chapters.some(item => item.id === roleChapter) && <button className="button" onClick={() => jump(roleChapter)}>当前角色规则</button>}{phaseChapter && chapters.some(item => item.id === phaseChapter) && <button className="button" onClick={() => jump(phaseChapter)}>当前阶段规则</button>}</div>
      <p className="muted">正式版型的通用规则。实验房间的人数与角色组成以本房间冻结配置为准。</p>
      {chapter ? <article className="rules-chapter" aria-label={chapter.title}><h2>{chapter.title}</h2><RuleMarkdown markdown={chapter.markdown.replace(/^##[ \t]+[^\r\n]+(?:\r?\n|$)/, '')} focusBlock={focusBlock}/></article> : <p>暂未找到该规则章节。</p>}
    </>}
  </Modal>;
}
