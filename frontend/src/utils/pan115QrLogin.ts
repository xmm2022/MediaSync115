export const DEFAULT_PAN115_QR_LOGIN_APP = "ios";

export interface Pan115QrLoginAppOption {
  value: string;
  label: string;
  recommended: boolean;
  hint: string;
}

export const FALLBACK_PAN115_QR_LOGIN_APPS: Pan115QrLoginAppOption[] = [
  {
    value: DEFAULT_PAN115_QR_LOGIN_APP,
    label: "115生活 App（iOS）（推荐）",
    recommended: true,
    hint: "默认使用 115生活 iPhone App 扫码登录",
  },
];

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function extractRecordList(data: unknown, keys: string[] = ["items", "data", "list"]): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return data.filter(isPlainRecord);
  }
  if (!isPlainRecord(data)) return [];

  for (const key of keys) {
    const value = data[key];
    if (Array.isArray(value)) {
      return value.filter(isPlainRecord);
    }
    if (isPlainRecord(value)) {
      const nested = extractRecordList(value, keys);
      if (nested.length > 0) return nested;
    }
  }

  return [];
}

export function normalizePan115QrLoginAppOption(raw: Record<string, unknown>): Pan115QrLoginAppOption | null {
  const value = String(raw.value ?? raw.app ?? raw.key ?? raw.id ?? "").trim();
  if (!value) return null;

  return {
    value,
    label: String(raw.label ?? raw.name ?? value).trim() || value,
    recommended: raw.recommended === true || raw.recommended === "true",
    hint: String(raw.hint ?? raw.description ?? raw.desc ?? "").trim(),
  };
}

export function extractPan115QrLoginAppOptions(data: unknown): Pan115QrLoginAppOption[] {
  return extractRecordList(data)
    .map(normalizePan115QrLoginAppOption)
    .filter((item): item is Pan115QrLoginAppOption => Boolean(item));
}

export function selectPan115QrLoginApp(
  current: string,
  options: Pan115QrLoginAppOption[],
): string {
  if (options.some((item) => item.value === current)) return current;
  return options.find((item) => item.recommended)?.value || options[0]?.value || DEFAULT_PAN115_QR_LOGIN_APP;
}
