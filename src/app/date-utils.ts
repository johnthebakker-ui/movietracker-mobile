import type { AppTab } from "../types";
import type { HistoryItem, ProfileData, ReviewItem } from "./types";

export function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function viewingDateKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  if (date.getHours() < 3) date.setDate(date.getDate() - 1);
  return localDateKey(date);
}

export function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthBounds(month: string) {
  const [year, number] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, number - 1, 1));
  const end = new Date(Date.UTC(year, number, 1));
  return { start, end };
}

export function shiftMonth(month: string, delta: number) {
  const [year, number] = month.split("-").map(Number);
  return monthKey(new Date(Date.UTC(year, number - 1 + delta, 1)));
}

export function weekStartKey(value: Date | string) {
  const key = typeof value === "string" ? value : localDateKey(value);
  const date = new Date(`${key}T12:00:00Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

export function weekBounds(week: string) {
  const start = new Date(`${week}T00:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return { start, end };
}

export function shiftWeek(week: string, delta: number) {
  const date = new Date(`${week}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta * 7);
  return date.toISOString().slice(0, 10);
}

export function calendarWeekDays(week: string) {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${week}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

export function calendarWeekLabel(days: string[]) {
  const start = new Date(`${days[0]}T12:00:00Z`);
  const end = new Date(`${days[6]}T12:00:00Z`);
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const sameMonth = sameYear && start.getUTCMonth() === end.getUTCMonth();
  if (sameMonth) return `${start.toLocaleDateString(undefined, { month: "short", timeZone: "UTC" })} ${start.getUTCDate()}–${end.getUTCDate()}, ${end.getUTCFullYear()}`;
  if (sameYear) return `${start.toLocaleDateString(undefined, { month: "short", timeZone: "UTC" })} ${start.getUTCDate()}–${end.toLocaleDateString(undefined, { month: "short", timeZone: "UTC" })} ${end.getUTCDate()}, ${end.getUTCFullYear()}`;
  return `${start.toLocaleDateString(undefined, { month: "short", timeZone: "UTC" })} ${start.getUTCDate()}, ${start.getUTCFullYear()}–${end.toLocaleDateString(undefined, { month: "short", timeZone: "UTC" })} ${end.getUTCDate()}, ${end.getUTCFullYear()}`;
}

export function calendarCells(month: string) {
  const { start } = monthBounds(month);
  const leading = (start.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  const cells = Array.from({ length: leading + days }, (_, index) => index < leading ? null : `${month}-${String(index - leading + 1).padStart(2, "0")}`);
  return { cells, label: start.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" }) };
}

export function streaksFromDays(days: string[]) {
  let currentStreak = 0;
  let longestStreak = 0;
  let running = 0;
  let previousDay: number | null = null;
  for (const day of [...days].reverse()) {
    const value = new Date(`${day}T12:00:00Z`).getTime();
    running = previousDay !== null && value - previousDay === 86400000 ? running + 1 : 1;
    longestStreak = Math.max(longestStreak, running);
    previousDay = value;
  }
  if (days.length) {
    const cursor = new Date();
    cursor.setUTCHours(0, 0, 0, 0);
    for (const day of days) {
      const expected = cursor.toISOString().slice(0, 10);
      const yesterday = new Date(cursor.getTime() - 86400000).toISOString().slice(0, 10);
      if (day === expected || (currentStreak === 0 && day === yesterday)) {
        currentStreak++;
        cursor.setUTCDate(cursor.getUTCDate() - (day === expected ? 1 : 2));
      } else break;
    }
  }
  return { currentStreak, longestStreak };
}

export function minutesToLabel(minutes?: number | null) {
  if (!minutes) return "Runtime TBA";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours ? `${hours}h ${remainder}m` : `${remainder}m`;
}

export function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatShortDate(value: string) {
  if (!value) return "No date";
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function isEditedReview(review: Pick<ReviewItem, "created_at" | "updated_at">) {
  if (!review.updated_at) return false;
  return new Date(review.updated_at).getTime() - new Date(review.created_at).getTime() > 60_000;
}

export function formatHistoryDay(value: string) {
  if (value === "unknown") return "Unknown";
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
}

export function formatHistoryMonth(value: string) {
  if (value === "unknown") return "Watched date not specified";
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function formatHistoryTime(value: string) {
  return new Date(value).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function formatLastWatched(value: string) {
  return new Date(value).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function normalizeHistoryItemTime(item: HistoryItem): HistoryItem {
  if (!item.date) return { ...item, dateKey: "unknown", dateTitle: "Unknown date", dateSubtitle: "Watched date not specified", timeLabel: "No date" };
  const value = new Date(item.date);
  if (Number.isNaN(value.getTime())) return item;
  const dateKey = viewingDateKey(item.date);
  return { ...item, dateKey, dateTitle: formatHistoryDay(dateKey), dateSubtitle: formatHistoryMonth(dateKey), timeLabel: formatHistoryTime(item.date) };
}

export function normalizeProfileDataTimes(data: ProfileData): ProfileData {
  return { ...data, trackedLibraryTitles: Number(data.trackedLibraryTitles ?? 0), history: (data.history ?? []).map(normalizeHistoryItemTime) };
}

export function formatCalendarDate(value: string) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

export function emptyText(tab: AppTab, signedIn: boolean) {
  if (!signedIn && (tab === "library" || tab === "profile")) return "Sign in to sync your MovieTracker library.";
  if (tab === "calendar") return signedIn ? "Watch something or track shows to fill your calendar." : "Sign in to see your watched diary.";
  if (tab === "discover") return "Pull to refresh or loosen the filters.";
  return "Pull to refresh.";
}
