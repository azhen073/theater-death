import { useState } from 'react';
import type { ReactNode } from 'react';
import type { CatalogDTO } from '../../../../contracts/catalog.ts';
import { Modal } from '../../components/ui.tsx';

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) => part.startsWith('**') && part.endsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : part.startsWith('`') && part.endsWith('`') ? <code key={index}>{part.slice(1, -1)}</code> : part);
}

/** Render the rulebook's small Markdown vocabulary; raw HTML is always plain text. */
export function RuleMarkdown({ markdown }: { markdown: string }) {
  return <div className="rule-markdown">{markdown.trim().split(/\r?\n\s*\r?\n/).map((block, index) => {
    const lines = block.split(/\r?\n/);
    const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
    if (lines.length > 1 && lines[0]!.trim().startsWith('|') && /^\s*\|?[\s:|\-]+\|?\s*$/.test(lines[1]!)) {
      return <div className="table-scroll" key={index}><table><thead><tr>{cells(lines[0]!).map((cell, i) => <th key={i}>{inline(cell)}</th>)}</tr></thead><tbody>{lines.slice(2).map((line, row) => <tr key={row}>{cells(line).map((cell, i) => <td key={i}>{inline(cell)}</td>)}</tr>)}</tbody></table></div>;
    }
    if (lines.every(line => /^\s*[-*] /.test(line))) return <ul key={index}>{lines.map((line, i) => <li key={i}>{inline(line.replace(/^\s*[-*] /, ''))}</li>)}</ul>;
    if (lines.every(line => /^\s*\d+[.)] /.test(line))) return <ol key={index}>{lines.map((line, i) => <li key={i}>{inline(line.replace(/^\s*\d+[.)] /, ''))}</li>)}</ol>;
    if (lines.length === 1 && /^#{1,6} /.test(block)) return <h3 key={index}>{inline(block.replace(/^#{1,6} /, ''))}</h3>;
    return <p key={index}>{inline(block)}</p>;
  })}</div>;
}

export function RulesBook({ catalog, onClose, context, roleId, phase }: { catalog: CatalogDTO; onClose: () => void; context?: ReactNode; roleId?: string; phase?: string }) {
  const [chapterId, setChapterId] = useState(catalog.rulebook.chapters[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const chapter = catalog.rulebook.chapters.find(item => item.id === chapterId);
  const matches = query.trim() ? catalog.rulebook.chapters.filter(item => `${item.title}\n${item.markdown}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) : [];
  const roleChapter = roleId ? ['door', 'laike'].includes(roleId) ? 'chapter-04' : ['water', 'descender'].includes(roleId) ? 'chapter-05' : 'chapter-06' : null;
  const phaseChapter = phase === 'night' ? 'chapter-03' : phase === 'day' || phase === 'morning' ? 'chapter-09' : null;
  const jump = (id: string) => { if (id !== chapterId) setHistory(old => [...old, chapterId]); setChapterId(id); setQuery(''); };
  return <Modal title={`完整规则 · ${catalog.rulebook.version}`} onClose={onClose} context={context}>{history.length > 0 && <button className="text-button" onClick={() => { const previous = history.at(-1)!; setHistory(old => old.slice(0, -1)); setChapterId(previous); setQuery(''); }}>返回上一章节</button>}<label className="select-field">章节<select aria-label="规则章节" value={chapterId} onChange={event => jump(event.target.value)}>{catalog.rulebook.chapters.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
    <div className="button-row">{roleChapter && catalog.rulebook.chapters.some(item => item.id === roleChapter) && <button className="button" onClick={() => jump(roleChapter)}>当前角色规则</button>}{phaseChapter && catalog.rulebook.chapters.some(item => item.id === phaseChapter) && <button className="button" onClick={() => jump(phaseChapter)}>当前阶段规则</button>}</div>
    <label className="select-field">搜索规则<input type="search" aria-label="搜索规则" value={query} onChange={event => setQuery(event.target.value)} placeholder="角色、条款编号或关键词"/></label>
    {query.trim() && <section aria-label="规则搜索结果"><p className="muted">找到 {matches.length} 个章节</p>{matches.map(item => {
      const index = item.markdown.toLocaleLowerCase().indexOf(query.trim().toLocaleLowerCase());
      return <button key={item.id} className="event-row" onClick={() => jump(item.id)}><strong>{item.title}</strong><span>{item.markdown.slice(Math.max(0, index - 35), Math.max(0, index - 35) + 130)}</span></button>;
    })}</section>}
    <p className="muted">正式版型的通用规则。实验房间的人数与角色组成以本房间冻结配置为准。</p>
    {chapter ? <article aria-label={chapter.title}><h2>{chapter.title}</h2><RuleMarkdown markdown={chapter.markdown.replace(/^##[ \t]+[^\r\n]+(?:\r?\n|$)/, '')}/></article> : <p>暂未找到该规则章节。</p>}
  </Modal>;
}
