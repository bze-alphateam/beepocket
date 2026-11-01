/** Case-insensitive substring match on name (or label) and address; empty query matches all. */
export function matches(query: string, label: string, address: string): boolean {
  const q = query.trim().toLowerCase();
  return q === '' || label.toLowerCase().includes(q) || address.toLowerCase().includes(q);
}
