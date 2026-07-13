import { API_URL } from "./config";

export function reportError(source: string, error: unknown, context?: Record<string, string | number | boolean | null | undefined>) {
  const message = error instanceof Error ? error.message : String(error);
  void fetch(`${API_URL}/api/client-errors`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source, message, context })
  }).catch(() => undefined);
}
