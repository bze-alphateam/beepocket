import { describe, expect, it } from 'vitest';
import { checkVersion } from './manifest-version.mjs';

describe('checkVersion', () => {
  it.each(['0.0.0', '1', '1.2.3', '1.2.3.4', '65535.0.10'])('accepts %s', (v) => {
    expect(checkVersion(v)).toBe(v);
  });

  it.each(['1.2.3-rc1', '01.2', '65536', '', '1.2.3.4.5', '1..2', '1.2.', 'v1.2.3', ' 1.2'])(
    'rejects %j',
    (v) => {
      expect(() => checkVersion(v)).toThrow(/invalid extension version/);
    },
  );

  it('rejects a missing version', () => {
    expect(() => checkVersion(undefined)).toThrow(/invalid extension version/);
  });
});
