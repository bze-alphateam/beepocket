import { describe, expect, it, vi } from 'vitest';
import { OPENED_EVENT, startAddToken } from './content';

function rig(search: string, referrer: string) {
  const events: string[] = [];
  const sendMessage = vi.fn<(message: unknown) => Promise<unknown>>();
  const win = {
    location: { search },
    document: { referrer },
    dispatchEvent: (event: Event) => {
      events.push(event.type);
      return true;
    },
  };
  return { run: () => startAddToken(win, { sendMessage }), sendMessage, events };
}

describe('the add-a-token content script', () => {
  it('sends the code and the referrer origin, then announces the opened window', async () => {
    const t = rig('?code=factory%2Fbze1abc%2Fgold', 'https://dex.getbze.com/some/page?x=1');
    t.sendMessage.mockResolvedValue({ accepted: true });
    await t.run();
    expect(t.sendMessage).toHaveBeenCalledWith({
      addToken: { code: 'factory/bze1abc/gold', referrer: 'https://dex.getbze.com' },
    });
    expect(t.events).toEqual([OPENED_EVENT]);
    expect(OPENED_EVENT).toBe('beepocket#add-token-opened');
  });

  it('sends an empty referrer when the page has none or an unreadable one', async () => {
    for (const referrer of ['', 'not a url']) {
      const t = rig('?code=ubze', referrer);
      t.sendMessage.mockResolvedValue({ accepted: true });
      await t.run();
      expect(t.sendMessage).toHaveBeenCalledWith({ addToken: { code: 'ubze', referrer: '' } });
    }
  });

  it.each(['', '?code=', '?other=1', '?code=bad%20code', `?code=a${'b'.repeat(128)}`])(
    'does nothing for %s',
    async (search) => {
      const t = rig(search, '');
      await t.run();
      expect(t.sendMessage).not.toHaveBeenCalled();
      expect(t.events).toEqual([]);
    },
  );

  it('stays silent when the wallet refuses or is not there', async () => {
    const refused = rig('?code=ubze', '');
    refused.sendMessage.mockResolvedValue({ error: { code: 'invalid-request', message: 'x' } });
    await refused.run();
    const gone = rig('?code=ubze', '');
    gone.sendMessage.mockRejectedValue(new Error('no receiver'));
    await gone.run();
    const silent = rig('?code=ubze', '');
    silent.sendMessage.mockResolvedValue(undefined);
    await silent.run();
    expect([...refused.events, ...gone.events, ...silent.events]).toEqual([]);
  });
});
