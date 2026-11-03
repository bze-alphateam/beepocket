import { Icon, type IconName } from './icons';

export interface RequestHeroProps {
  icon: IconName;
  /** The uppercase kind: "SWAP", "GIVE PERMISSION". */
  kind: string;
  /** The big line: an amount or a short phrase. */
  hero: string;
  sub?: string | undefined;
  /** `bad` colours the icon disc red (a dangerous request). */
  tone?: 'accent' | 'bad' | undefined;
}

/** The plain-word top of a request: icon disc and kind, the big amount, the sub line. */
export function RequestHero({ icon, kind, hero, sub, tone = 'accent' }: RequestHeroProps) {
  return (
    <div class="bp-req-hero">
      <span class="bp-req-hero-kind">
        <span class={`bp-req-hero-disc bp-req-hero-${tone}`} aria-hidden="true">
          <Icon name={icon} size={14} strokeWidth={2.2} />
        </span>
        <span>{kind}</span>
      </span>
      <strong class="bp-req-hero-big">{hero}</strong>
      {sub !== undefined && sub !== '' && <span class="bp-req-hero-sub">{sub}</span>}
    </div>
  );
}
