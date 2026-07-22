import { groupFranchises, listFranchiseName } from "../../franchise-groups";
import type { ListGroup, ListSort } from "../../app/types";
import type { MediaSummary } from "../../types";

export function sortListItems(items: MediaSummary[], sort: ListSort) {
  const titleCompare = (a: MediaSummary, b: MediaSummary) => a.title.localeCompare(b.title);
  const dateValue = (value?: string | null, newest = true) => value || (newest ? "0000-00-00" : "9999-99-99");
  const listFields = (item: MediaSummary) => item as MediaSummary & { listAddedAt?: string | null; listPosition?: number | null };
  return [...items].sort((a, b) => {
    const aList = listFields(a);
    const bList = listFields(b);
    if (sort === "none") return (aList.listPosition ?? 999_999) - (bList.listPosition ?? 999_999);
    if (sort === "title_desc") return b.title.localeCompare(a.title);
    if (sort === "release_desc") return dateValue(b.releaseDate).localeCompare(dateValue(a.releaseDate)) || titleCompare(a, b);
    if (sort === "release_asc") return dateValue(a.releaseDate, false).localeCompare(dateValue(b.releaseDate, false)) || titleCompare(a, b);
    if (sort === "added_desc") return dateValue(bList.listAddedAt).localeCompare(dateValue(aList.listAddedAt)) || titleCompare(a, b);
    if (sort === "added_asc") return dateValue(aList.listAddedAt, false).localeCompare(dateValue(bList.listAddedAt, false)) || titleCompare(a, b);
    if (sort === "list_order") return (aList.listPosition ?? 999_999) - (bList.listPosition ?? 999_999) || titleCompare(a, b);
    return titleCompare(a, b);
  });
}

export function groupedListItems(items: MediaSummary[], groupBy: ListGroup) {
  const ordered = sortListItems(items, "list_order");
  if (groupBy === "none") return [{ title: "Titles", items }];
  const groups = groupBy === "collections" ? groupFranchises(ordered) : new Map<string, MediaSummary[]>();
  return [...groups.entries()]
    .map(([title, groupItems]) => ({ title, items: title.startsWith("Other") ? groupItems : sortListItems(groupItems, "release_asc") }))
    .sort((a, b) => (a.title.startsWith("Other") ? 1 : b.title.startsWith("Other") ? -1 : a.title.localeCompare(b.title)));
}

export function availableListFranchiseGroups(items: MediaSummary[]) {
  return [...new Set(items.flatMap(item => {
    const name = listFranchiseName(item)?.name;
    return name ? [name] : [];
  }))].sort((a, b) => a.localeCompare(b));
}
