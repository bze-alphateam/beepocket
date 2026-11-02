import type { ComponentChildren } from 'preact';
import { DetailRow } from './Card';

/** `[label, value]`, or `[label, value, 'mono']` for an address or a code. */
export type DetailCardRow = readonly [string, string] | readonly [string, string, 'mono'];

export interface DetailCardProps {
  rows: readonly DetailCardRow[];
  /** The last line, under a hairline: the Network fee `SelectRow`. */
  footer?: ComponentChildren;
}

/** The details of a request: "label … value" rows with dividers, and an optional fee row. */
export function DetailCard({ rows, footer }: DetailCardProps) {
  return (
    <div class="bp-detail-card">
      {rows.map(([label, value, mono], i) => (
        <DetailRow key={i} label={label}>
          {mono === 'mono' ? <span class="bp-mono">{value}</span> : value}
        </DetailRow>
      ))}
      {footer !== undefined && <div class="bp-detail-card-footer">{footer}</div>}
    </div>
  );
}
