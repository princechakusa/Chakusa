import { describe, expect, it } from 'vitest';
import { permissionDisclosure } from './permissionDisclosure';

describe('permissionDisclosure', () => {
  it('states what missed-call detection sends and what it never does', () => {
    const { body } = permissionDisclosure('detection');
    expect(body).toMatch(/caller's number and the time/);
    expect(body).toMatch(/does not record calls/);
    expect(body).toMatch(/contacts/);
    expect(body).toMatch(/never uploads/);
  });

  it('explains contact access without implying the address book is read', () => {
    const { body } = permissionDisclosure('contactCoverage');
    expect(body).toMatch(/never uploads, copies or reads your address book/);
  });

  it('offers an explicit decline', () => {
    expect(permissionDisclosure('detection').decline).toBe('Not now');
    expect(permissionDisclosure('contactCoverage').decline).toBe('Not now');
  });
});
