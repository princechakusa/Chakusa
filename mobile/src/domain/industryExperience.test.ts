import { describe, expect, it } from 'vitest';
import { INDUSTRY_EXPERIENCES, industryExperience } from './industryExperience';

describe('industry experience', () => {
  it('provides a unique, usable configuration for every supported industry', () => {
    expect(INDUSTRY_EXPERIENCES.length).toBeGreaterThanOrEqual(18);
    expect(new Set(INDUSTRY_EXPERIENCES.map(item => item.id)).size).toBe(INDUSTRY_EXPERIENCES.length);
    expect(INDUSTRY_EXPERIENCES.every(item => item.services.length >= 4 && item.emptyLeadCopy.length > 0)).toBe(true);
  });
  it('finds a selected industry without inventing an unknown fallback', () => {
    expect(industryExperience('plumber')?.label).toBe('Plumber');
    expect(industryExperience('not-a-real-industry')).toBeNull();
  });
});
