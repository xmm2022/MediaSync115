export const AUTH_REQUIRED_EVENT = "mediasync115:auth-required";

type ApiErrorPayload = {
  response?: {
    status?: number;
    data?: unknown;
  };
  code?: string;
  message?: string;
};

function getResponseDetail(data: unknown): string {
  if (typeof data === "string") return data;
  if (!data || typeof data !== "object") return "";

  const record = data as Record<string, unknown>;
  const detail = record.detail ?? record.message ?? record.error;
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object") return JSON.stringify(detail);
  return "";
}

export function isWebSessionAuthError(error: unknown): boolean {
  const err = error as ApiErrorPayload;
  if (err?.response?.status !== 401) return false;

  const detail = getResponseDetail(err.response.data);
  if (!detail) return true;

  return detail === "请先登录";
}

export function getApiErrorMessage(error: unknown, fallback = "请求失败，请稍后重试"): string {
  const err = error as ApiErrorPayload;
  const status = err?.response?.status;
  const detail = getResponseDetail(err?.response?.data);

  if (status === 401) {
    return detail || "登录会话已过期，请重新登录";
  }
  if (detail) return detail;
  if (err?.code === "ECONNABORTED") return "请求超时，请稍后重试";

  const message = String(err?.message || "");
  if (message && !/^Request failed with status code \d+$/.test(message)) {
    return message;
  }
  if (status) return `请求失败（HTTP ${status}）`;
  return fallback;
}
