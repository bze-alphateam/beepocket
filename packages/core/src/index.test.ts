import { describe, expect, it } from 'vitest';
import { version } from './index';

describe('core', () => {
  it('exports a version', () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
