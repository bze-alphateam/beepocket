import { Icon } from './icons';

/** What a site gets and what happens next, one green tick per line (connect, add a token). */
export function CheckList(props: { items: readonly string[] }) {
  return (
    <ul class="bp-check-list">
      {props.items.map((item) => (
        <li key={item}>
          <Icon name="check" size={14} strokeWidth={2.6} />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
