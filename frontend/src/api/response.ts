import type { AxiosResponse } from "axios";

type ObjectPayload = Record<string, unknown>;

function isObjectPayload(value: unknown): value is ObjectPayload {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function extractItems<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) {
    return payload as T[];
  }
  if (isObjectPayload(payload) && Array.isArray(payload.items)) {
    return payload.items as T[];
  }
  return [];
}

export function extractRecord(
  payload: unknown,
  keys: string[] = ["items"],
): Record<string, unknown> {
  if (!isObjectPayload(payload)) {
    return {};
  }
  for (const key of keys) {
    const value = payload[key];
    if (isObjectPayload(value)) {
      return value;
    }
  }
  return {};
}

export function withResponseData<T>(
  response: AxiosResponse<unknown>,
  data: T,
): AxiosResponse<T> {
  return { ...response, data };
}
