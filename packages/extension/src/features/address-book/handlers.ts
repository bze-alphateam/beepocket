import { ErrorCodes, fail, ok, type Result } from '../../protocol';
import type { HandlerRegistry } from '../../background/registry';
import type { BookStore } from './ports';
import { AddressBook } from './service';

function stringFields<K extends string>(method: string, names: readonly K[]) {
  return (payload: unknown): Result<Record<K, string>> => {
    const out: Record<string, string> = {};
    for (const name of names) {
      const value =
        typeof payload === 'object' && payload !== null
          ? (payload as Record<string, unknown>)[name]
          : undefined;
      if (typeof value !== 'string') {
        return fail(ErrorCodes.badRequest, `${method} needs a string ${name}.`);
      }
      out[name] = value;
    }
    return ok(out as Record<K, string>);
  };
}

/** The store is passed in by the composition root (see wallet-store.ts). */
export function registerBookHandlers(registry: HandlerRegistry, store: BookStore): void {
  const book = new AddressBook(store);

  registry.register('book.list', { validate: () => ok({}), handle: () => book.list() });
  registry.register('book.add', {
    validate: stringFields('book.add', ['name', 'address']),
    handle: (req) => book.add(req),
  });
  registry.register('book.update', {
    validate: stringFields('book.update', ['name', 'address']),
    handle: (req) => book.update(req),
  });
  registry.register('book.remove', {
    validate: stringFields('book.remove', ['address']),
    handle: (req) => book.remove(req.address),
  });
  registry.register('book.match', {
    validate: stringFields('book.match', ['input']),
    handle: (req) => book.match(req.input),
  });
}
