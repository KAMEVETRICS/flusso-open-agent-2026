// Narrowing helpers for loosely typed third-party API payloads.
export type JsonRecord = Record<string, unknown>;

export function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

export function asText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return asText(value.find((item) => typeof item === "string"));
  return "";
}

export function countWords(value: string) {
  return value ? value.split(/\s+/).filter(Boolean).length : 0;
}
