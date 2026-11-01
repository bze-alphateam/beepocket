import { render } from 'preact';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('popup App', () => {
  it('renders the wallet name', () => {
    const host = document.createElement('div');
    render(<App />, host);
    expect(host.textContent).toContain('BeePocket');
  });
});
