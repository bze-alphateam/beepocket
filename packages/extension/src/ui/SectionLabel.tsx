export interface SectionLabelProps {
  title: string;
  /** Shown after a middle dot: "Preferred · 4". */
  count?: number | string | undefined;
  /** Heading level for the group; 3 by default (inside a sheet's h2). */
  level?: 3 | 4 | undefined;
}

/** The small uppercase title of a list group ("PREFERRED · 4", "YOU HOLD · 3"). */
export function SectionLabel({ title, count, level = 3 }: SectionLabelProps) {
  const Tag = level === 4 ? 'h4' : 'h3';
  return (
    <Tag class="bp-section-label">
      {title}
      {count !== undefined && ` · ${String(count)}`}
    </Tag>
  );
}
