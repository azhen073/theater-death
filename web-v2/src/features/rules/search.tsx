import type { ReactNode } from 'react';
import type { CatalogDTO } from '../../../../contracts/catalog.ts';
import { playerRuleChapters } from './quick-view.tsx';

export interface RuleSearchResult {
  chapterId: string;
  chapterTitle: string;
  blockIndex: number;
  title: string;
  excerpt: string;
}

function plainText(markdown: string): string {
  return markdown
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/[|*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function excerpt(markdown: string, query: string): string {
  const text = plainText(markdown);
  const index = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  const start = Math.max(0, index - 45);
  const end = Math.min(text.length, Math.max(index + query.length + 85, 130));
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

export function searchRules(catalog: CatalogDTO, input: string): RuleSearchResult[] {
  const query = input.trim();
  if (!query) return [];
  const normalized = query.toLocaleLowerCase();
  const results: RuleSearchResult[] = [];
  for (const chapter of playerRuleChapters(catalog)) {
    const blocks = chapter.markdown.split(/\r?\n\s*\r?\n/);
    const headingOffset = /^##\s/.test(blocks[0] ?? '') ? 1 : 0;
    blocks.forEach((block, blockIndex) => {
      if (blockIndex === 0 && headingOffset) return;
      if (!block.toLocaleLowerCase().includes(normalized)) return;
      const clause = /R-\d{2}｜/.exec(block)?.[0]?.replace('｜', '');
      results.push({
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        blockIndex: blockIndex - headingOffset,
        title: clause ?? (plainText(block).split(/[。；]/)[0]?.slice(0, 32) || chapter.title),
        excerpt: excerpt(block, query),
      });
    });
  }
  return results.slice(0, 30);
}

export function Highlight({ text, query }: { text: string; query: string }) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return text;
  const parts: ReactNode[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const index = text.toLocaleLowerCase().indexOf(normalized, cursor);
    if (index < 0) { parts.push(text.slice(cursor)); break; }
    if (index > cursor) parts.push(text.slice(cursor, index));
    parts.push(<mark key={index}>{text.slice(index, index + normalized.length)}</mark>);
    cursor = index + normalized.length;
  }
  return parts;
}

export function RuleSearchResults({ catalog, query, onSelect }: {
  catalog: CatalogDTO; query: string; onSelect: (chapterId: string, blockIndex: number) => void;
}) {
  const results = searchRules(catalog, query);
  return <section className="rules-search-results" aria-label="规则搜索结果">
    <p className="muted">找到 {results.length} 条相关规则{results.length === 30 ? '（仅显示前 30 条）' : ''}</p>
    {results.length === 0 ? <p>没有找到相关内容，可以尝试角色名、阶段名或 R 条款号。</p> : results.map(result => <button type="button" className="rules-search-result" key={`${result.chapterId}/${result.blockIndex}`} onClick={() => onSelect(result.chapterId, result.blockIndex)}>
      <span className="rules-search-result__title"><strong><Highlight text={result.title} query={query}/></strong><small>{result.chapterTitle}</small></span>
      <span><Highlight text={result.excerpt} query={query}/></span>
    </button>)}
  </section>;
}
