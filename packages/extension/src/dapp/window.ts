import type { SessionStorage } from '../platform';
import { WINDOW_KEY } from './requests';

export interface WindowsLike {
  create(info: {
    url: string;
    type: 'popup';
    width: number;
    height: number;
    focused: boolean;
  }): Promise<
    { id?: number | undefined; tabs?: { id?: number | undefined }[] | undefined } | undefined
  >;
  get(windowId: number): Promise<unknown>;
  update(windowId: number, info: { focused: boolean }): Promise<unknown>;
}

export const REQUEST_URL = 'popup.html?window=request';

/** The one request window: opened when a request needs the user, focused when already open. */
export class RequestWindow {
  constructor(
    private readonly windows: WindowsLike,
    private readonly session: SessionStorage,
  ) {}

  async show(): Promise<void> {
    const id = await this.session.get(WINDOW_KEY);
    if (typeof id === 'number') {
      try {
        await this.windows.get(id);
        await this.windows.update(id, { focused: true });
        return;
      } catch {
        // closed since: open a new one
      }
    }
    const created = await this.windows.create({
      url: REQUEST_URL,
      type: 'popup',
      width: 360,
      height: 600,
      focused: true,
    });
    if (created?.id !== undefined) await this.session.set(WINDOW_KEY, created.id);
  }
}
