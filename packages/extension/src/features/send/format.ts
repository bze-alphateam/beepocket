import { formatAmount } from '@beepocket/core';
import { t, type StringKey } from '../../i18n';
import { SendErrorCodes, type FeeChoice, type SendQuote } from '../../protocol/send';

/** Base units as typed-in plain decimal (`1234.5`), exact, no grouping: what an input holds. */
export function plainAmount(base: bigint, decimals: number): string {
  const digits = base.toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, '');
  return fraction === '' ? whole : `${whole}.${fraction}`;
}

/** Every digit of the token's precision, so a fee is never shown smaller than it is. */
export function exact(base: string, decimals: number): string {
  return formatAmount(BigInt(base), decimals, { maxFraction: decimals });
}

export function feeText(fee: FeeChoice): string {
  return `${exact(fee.amount, fee.decimals)} ${fee.symbol}`;
}

/** "10.00 BZE" or, when the fee is in another token, "10.00 BZE + 0.50 PAGE". */
export function totalText(quote: SendQuote): string {
  const sent = `${exact(quote.amount, quote.token.decimals)} ${quote.token.symbol}`;
  if (quote.fee.denom !== quote.token.denom) return `${sent} + ${feeText(quote.fee)}`;
  const total = BigInt(quote.amount) + BigInt(quote.fee.amount);
  return `${exact(total.toString(), quote.token.decimals)} ${quote.token.symbol}`;
}

/** The user-facing line for an error code; node messages (`simulation-failed`) pass through. */
export function errorText(error: { code: string; message: string }, symbol: string): string {
  const key = ((): StringKey | null => {
    switch (error.code) {
      case SendErrorCodes.invalidAddress:
        return 'send.error.address';
      case SendErrorCodes.invalidAmount:
        return 'send.error.amount';
      case SendErrorCodes.insufficientFunds:
        return 'send.error.funds';
      case SendErrorCodes.amountLeavesNoFee:
        return 'send.error.leavesNoFee';
      case SendErrorCodes.cannotPayFee:
        return 'send.error.cannotPayFee';
      case SendErrorCodes.fundFirst:
        return 'send.error.fundFirst';
      case SendErrorCodes.tokenUnavailable:
        return 'send.error.token';
      case SendErrorCodes.network:
        return 'send.error.network';
      case 'wallet_locked':
        return 'send.error.locked';
      default:
        return null;
    }
  })();
  if (key) return t(key, { symbol });
  // The node's own words for a transaction it would not take.
  if (error.code === SendErrorCodes.simulationFailed || error.code === SendErrorCodes.rejected) {
    return error.message;
  }
  return t('send.error.generic');
}
