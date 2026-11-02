import { describe, expect, it } from 'vitest';
import { hostOf, httpsOrigin, isKnownSite, validCode } from './link';

describe('validCode', () => {
  it.each(['ubze', 'factory/bze1abc/gold', 'ibc/ABC123', 'a.b-c_d:e'])('accepts %s', (code) => {
    expect(validCode(code)).toBe(code);
  });

  it.each([
    ['missing', null],
    ['not a string', 5],
    ['empty', ''],
    ['too short', 'ab'],
    ['starts with a digit', '1abc'],
    ['a space', 'factory/bze1 abc'],
    ['a bad character', 'factory/bze1abc/go$d'],
    ['over-long', `a${'b'.repeat(128)}`],
  ])('rejects %s', (_name, code) => {
    expect(validCode(code)).toBeNull();
  });

  it('accepts the longest code', () => {
    const longest = `a${'b'.repeat(127)}`;
    expect(validCode(longest)).toBe(longest);
  });
});

describe('isKnownSite', () => {
  it.each(['https://getbze.com', 'https://dex.getbze.com', 'https://a.b.getbze.com'])(
    '%s is known',
    (site) => {
      expect(isKnownSite(site)).toBe(true);
    },
  );

  it.each([
    'https://evilgetbze.com',
    'https://getbze.com.evil.example',
    'https://evil.example/getbze.com',
    'http://getbze.com',
    'https://getbze.co',
    '',
    'not a url',
  ])('%s is unknown', (site) => {
    expect(isKnownSite(site)).toBe(false);
  });
});

describe('origins', () => {
  it('keeps only the origin of an https URL', () => {
    expect(httpsOrigin('https://dex.getbze.com/path?x=1')).toBe('https://dex.getbze.com');
    expect(hostOf('https://dex.getbze.com:8443/')).toBe('dex.getbze.com:8443');
  });

  it.each(['http://dex.getbze.com', 'javascript:alert(1)', 'ftp://x.example', '', undefined, 3])(
    'drops %s',
    (value) => {
      expect(httpsOrigin(value)).toBeNull();
      expect(hostOf(String(value))).toBeNull();
    },
  );
});
