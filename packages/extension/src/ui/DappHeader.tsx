import { Logo } from './Logo';

export interface DappHeaderProps {
  /** "Connection request", "Approve transaction", "Add a token". */
  title: string;
  /** The chain id of the active network, shown in the pill on the right ("beezee-1"); no pill while unknown. */
  chainId?: string | undefined;
  /** A small badge after the title: the queue's "1 of 2". */
  badge?: { text: string; label: string } | undefined;
}

/** The header of a window a website opens: the kit-coloured mark, the title and the chain pill. */
export function DappHeader({ title, chainId, badge }: DappHeaderProps) {
  return (
    <div class="bp-dapp-header">
      <span class="bp-dapp-header-title">
        <Logo variant="mark" size={24} tint="kit" />
        <h1>{title}</h1>
        {badge !== undefined && (
          <span class="bp-dapp-header-badge" aria-label={badge.label}>
            {badge.text}
          </span>
        )}
      </span>
      {chainId !== undefined && (
        <span class="bp-chain-pill">
          <span class="bp-chain-dot" aria-hidden="true" />
          {chainId}
        </span>
      )}
    </div>
  );
}
