import { LegalDocumentDto } from '../apiTypes';

export type DocumentSection = { title: string; paragraphs?: string[]; bullets?: string[] };

export type PublicDocumentViewState =
  | { kind: 'loading' }
  | { kind: 'loaded'; heading: string; meta: string; sections: DocumentSection[] }
  | { kind: 'not-found' }
  | { kind: 'network-error' };

const stripEmphasis = (text: string) => text.replace(/\*\*(.+?)\*\*/g, '$1');

/**
 * A small, deliberately non-general Markdown-ish renderer for the Legal
 * Platform's stored document content (see scripts/seed-legal-documents.ts):
 * `## heading` starts a new section, `- ` lines become bullets, blank lines
 * separate paragraphs, everything else is a paragraph. `**bold**` markers
 * are stripped rather than rendered, since this content is read top-to-
 * bottom rather than skimmed for emphasis. Not a full Markdown engine —
 * intentionally, to avoid pulling in a dependency for four documents whose
 * structure is this simple.
 */
export function sectionsFromMarkdown(content: string): DocumentSection[] {
  const lines = content.split('\n');
  const sections: DocumentSection[] = [];
  let current: DocumentSection = { title: '', paragraphs: [] };
  let paragraphBuffer: string[] = [];
  const hasContent = (section: DocumentSection) => Boolean(section.title || section.paragraphs?.length || section.bullets?.length);
  const flushParagraph = () => {
    const text = paragraphBuffer.join(' ').trim();
    if (text) (current.paragraphs ??= []).push(stripEmphasis(text));
    paragraphBuffer = [];
  };
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith('## ') || line.startsWith('### ')) {
      flushParagraph();
      if (hasContent(current)) sections.push(current);
      current = { title: line.replace(/^#{2,3}\s+/, ''), paragraphs: [] };
    } else if (line.startsWith('- ')) {
      flushParagraph();
      (current.bullets ??= []).push(stripEmphasis(line.slice(2).trim()));
    } else if (line === '') {
      flushParagraph();
    } else {
      paragraphBuffer.push(line);
    }
  }
  flushParagraph();
  if (hasContent(current)) sections.push(current);
  return sections;
}

export function viewStateFromDocument(doc: LegalDocumentDto): PublicDocumentViewState {
  const meta = doc.publishedAt
    ? `Version ${doc.version} — published ${new Date(doc.publishedAt).toLocaleDateString()}`
    : `Version ${doc.version}`;
  return { kind: 'loaded', heading: doc.title.toUpperCase(), meta, sections: sectionsFromMarkdown(doc.content) };
}

export function errorViewState(kind: string): PublicDocumentViewState {
  return kind === 'not-found' ? { kind: 'not-found' } : { kind: 'network-error' };
}
