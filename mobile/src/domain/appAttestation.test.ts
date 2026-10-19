import { describe, expect, it } from 'vitest';
import { isGatedAuthUrl } from './appAttestation';

describe('isGatedAuthUrl', () => {
  it.each([
    'https://api.example.com/auth/login',
    'https://api.example.com/auth/register',
    'https://api.example.com/auth/refresh',
    'https://api.example.com/auth/google',
    'https://api.example.com/auth/apple',
    'https://api.example.com/customer/auth/login',
    'https://api.example.com/customer/auth/refresh?x=1',
  ])('attests %s', url => expect(isGatedAuthUrl(url)).toBe(true));

  it.each([
    'https://api.example.com/auth/me',
    'https://api.example.com/auth/logout',
    'https://api.example.com/auth/apple/challenge',
    'https://api.example.com/auth/login-history',
    'https://api.example.com/customers',
    'https://api.example.com/app-integrity/challenge',
  ])('does not attest %s', url => expect(isGatedAuthUrl(url)).toBe(false));
});
