export type MediaKindFilter = "both" | "movie" | "show";

export function filterByMediaKind<T>(items: T[], filter: MediaKindFilter, getKind: (item: T) => string): T[] {
  return filter === "both" ? items : items.filter(item => getKind(item) === filter);
}
