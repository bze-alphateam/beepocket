import { describe, expect, it } from 'vitest';
import type { SenderLike } from '../../dapp';
import { linkSender } from './sender';

const GOOD: SenderLike = {
  id: 'me',
  origin: 'https://getbze.com',
  url: 'https://getbze.com/wallet/add/?code=ubze',
  frameId: 0,
  documentId: 'doc1',
  tab: { id: 4 },
};

describe('linkSender', () => {
  it('accepts the add page in the top frame', () => {
    expect(linkSender(GOOD, 'me')).toEqual({ documentId: 'doc1' });
  });

  it.each([
    ['another origin', { origin: 'https://evil.example' }],
    ['a look-alike origin', { origin: 'https://evilgetbze.com' }],
    ['a subdomain', { origin: 'https://dex.getbze.com' }],
    ['plain http', { origin: 'http://getbze.com' }],
    ['an iframe', { frameId: 3 }],
    ['another path', { url: 'https://getbze.com/other/?code=ubze' }],
    ['the slash-less path', { url: 'https://getbze.com/wallet/add' }],
    ['a path that only looks similar', { url: 'https://getbze.com/wallet/address/' }],
    ['a url on another origin', { url: 'https://evil.example/wallet/add/' }],
    ['no url', { url: undefined }],
    ['no document id', { documentId: undefined }],
    ['an empty document id', { documentId: '' }],
    ['another extension', { id: 'other' }],
  ])('rejects %s', (_name, change) => {
    expect(linkSender({ ...GOOD, ...change }, 'me')).toBeNull();
  });

  it('rejects everything when the extension id is unknown', () => {
    expect(linkSender(GOOD, undefined)).toBeNull();
  });
});
