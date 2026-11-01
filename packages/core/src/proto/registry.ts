// Hand-written stand-in for bzejs's `registry.ts`. The copied message files call into
// `GlobalDecoderRegistry` to self-register and to wrap/unwrap `google.protobuf.Any` fields.
// BeePocket has no global registry: registration is a no-op and nested `Any` values stay
// raw `{ typeUrl, value }` pairs, which `decodeAny` in `../decode.ts` resolves on demand.
import { Any } from './google/protobuf/any';
import { BinaryReader } from './binary';

export class GlobalDecoderRegistry {
  /** Always "already registered", so every `registerTypeUrl()` returns early. */
  static registerExistingTypeUrl(_typeUrl: string): boolean {
    return false;
  }
  static register(..._args: unknown[]): void {}
  static registerAminoProtoMapping(..._args: unknown[]): void {}

  static wrapAny(obj: unknown): Any {
    if (Any.is(obj)) return obj;
    throw new Error('only google.protobuf.Any values can be wrapped');
  }
  static unwrapAny(input: BinaryReader | Uint8Array | Any): Any {
    if (Any.is(input)) return input;
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    return Any.decode(reader, reader.uint32());
  }
  static fromPartial(object: unknown): unknown {
    return Any.is(object) ? Any.fromPartial(object) : object;
  }
  static fromAminoMsg(_object: unknown): never {
    throw new Error('amino is not supported');
  }
  static toAminoMsg(_object: unknown): never {
    throw new Error('amino is not supported');
  }
}
