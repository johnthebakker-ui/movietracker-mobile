type NotificationVisibilityRow = {
  payload?: {
    scheduledDiagnostic?: boolean;
    notBefore?: string;
  } | null;
};

export function notificationIsVisible(
  row: NotificationVisibilityRow,
  now = new Date()
) {
  if (row.payload?.scheduledDiagnostic !== true) return true;
  const notBefore = Date.parse(row.payload.notBefore ?? "");
  return Number.isFinite(notBefore) && notBefore <= now.getTime();
}
