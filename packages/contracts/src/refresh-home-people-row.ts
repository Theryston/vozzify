import type { HomePeopleRow } from './home.js';

/** A visit keeps its recommendations in order while visibility and identity stay live. */
export function refreshHomePeopleRow(
  frozen: HomePeopleRow,
  current: HomePeopleRow | undefined,
): HomePeopleRow | null {
  if (!current) return null;
  const people = new Map(current.items.map((person) => [person.id, person]));
  const items = frozen.items.flatMap(({ id }) => {
    const visible = people.get(id);
    return visible ? [visible] : [];
  });
  return items.length >= 3 ? { ...frozen, items } : null;
}
