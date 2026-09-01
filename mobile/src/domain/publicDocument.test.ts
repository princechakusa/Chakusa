import { describe, expect, it } from 'vitest';
import { LegalDocumentDto } from '../apiTypes';
import { errorViewState, sectionsFromMarkdown, viewStateFromDocument } from './publicDocument';

const doc: LegalDocumentDto = {
  type: 'PRIVACY_POLICY',
  version: 3,
  title: 'Privacy Policy',
  content: [
    'Draft dated 2026-09-01. Not yet reviewed by a licensed attorney.',
    '',
    '## Who this covers',
    'This policy covers **business accounts** and customer accounts.',
    '',
    '## Information we collect',
    'Some intro text.',
    '- Account information',
    '- Business information',
  ].join('\n'),
  summary: null,
  effectiveAt: null,
  publishedAt: '2026-09-01T18:00:00.000Z',
};

describe('public document domain', () => {
  it('groups an untitled leading paragraph before the first heading', () => {
    const sections = sectionsFromMarkdown(doc.content);
    expect(sections[0]).toEqual({ title: '', paragraphs: ['Draft dated 2026-09-01. Not yet reviewed by a licensed attorney.'] });
  });

  it('starts a new section on ## or ### and strips bold markers rather than rendering them', () => {
    const sections = sectionsFromMarkdown(doc.content);
    const who = sections.find(s => s.title === 'Who this covers');
    expect(who?.paragraphs).toEqual(['This policy covers business accounts and customer accounts.']);
  });

  it('collects consecutive "- " lines as bullets on the current section, not new paragraphs', () => {
    const sections = sectionsFromMarkdown(doc.content);
    const collect = sections.find(s => s.title === 'Information we collect');
    expect(collect?.paragraphs).toEqual(['Some intro text.']);
    expect(collect?.bullets).toEqual(['Account information', 'Business information']);
  });

  it('builds a heading and a version/publish-date meta line from a loaded document', () => {
    const state = viewStateFromDocument(doc);
    expect(state).toMatchObject({ kind: 'loaded', heading: 'PRIVACY POLICY' });
    expect(state.kind === 'loaded' && state.meta).toContain('Version 3');
  });

  it('falls back to just the version number when nothing is published yet to date', () => {
    const state = viewStateFromDocument({ ...doc, publishedAt: null });
    expect(state).toMatchObject({ kind: 'loaded', meta: 'Version 3' });
  });

  it('maps a missing document to not-found and anything else to a retryable network error', () => {
    expect(errorViewState('not-found')).toEqual({ kind: 'not-found' });
    expect(errorViewState('network')).toEqual({ kind: 'network-error' });
    expect(errorViewState('server')).toEqual({ kind: 'network-error' });
  });
});
