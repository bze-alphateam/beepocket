// Hand-written replacement for the part of the upstream math package the copied proto code uses
// (`DecCoin` and `DecProto` amounts). Non-negative fixed-point decimals only.
export class Decimal {
  private constructor(
    private readonly value: bigint,
    private readonly fractionalDigits: number,
  ) {}

  static fromUserInput(input: string, fractionalDigits: number): Decimal {
    const bad = /[^0-9.]/.exec(input);
    if (bad) throw new Error(`Invalid character at position ${String(bad.index + 1)}`);
    let whole = '0';
    let fractional = '';
    if (input !== '') {
      const parts = input.split('.');
      if (parts.length > 2) throw new Error('More than one separator found');
      whole = parts[0] ?? '';
      if (parts.length === 2) {
        if (!parts[1]) throw new Error('Fractional part missing');
        fractional = parts[1].replace(/0+$/, '');
      }
    }
    if (fractional.length > fractionalDigits) {
      throw new Error('Got more fractional digits than supported');
    }
    return Decimal.fromAtomics(`${whole}${fractional.padEnd(fractionalDigits, '0')}`, fractionalDigits);
  }

  static fromAtomics(atomics: string, fractionalDigits: number): Decimal {
    if (!Number.isInteger(fractionalDigits) || fractionalDigits < 0 || fractionalDigits > 100) {
      throw new Error('Invalid fractional digits');
    }
    if (!/^[0-9]+$/.test(atomics)) {
      throw new Error('Invalid string format. Only non-negative integers are supported.');
    }
    return new Decimal(BigInt(atomics), fractionalDigits);
  }

  get atomics(): string {
    return this.value.toString();
  }

  toString(): string {
    const factor = 10n ** BigInt(this.fractionalDigits);
    const whole = this.value / factor;
    const fractional = this.value % factor;
    if (fractional === 0n) return whole.toString();
    const digits = fractional.toString().padStart(this.fractionalDigits, '0').replace(/0+$/, '');
    return `${whole.toString()}.${digits}`;
  }
}
