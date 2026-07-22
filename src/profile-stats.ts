export function compactProfileStatValue(value: number | string) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return Math.abs(numeric) > 999 ? `${numeric < 0 ? "-" : ""}999+` : String(value);
}
