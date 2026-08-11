import { syncFromResponse } from "./serverTime.ts";

/**
 * 서버는 자료를 그대로 돌려주고, 서버 시각은 `x-server-time` 헤더로만 싣는다.
 * 실패는 `{ error, message }` 다 — `message` 는 서버가 `copy.ts` 에서 골라 담은 문장이라
 * 화면에서는 그대로 보여주면 된다. 여기서 문장을 새로 짓지 마라.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public userMessage?: string,
  ) {
    super(code);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "include", // 세션은 HttpOnly 쿠키. 전화번호를 URL 에 노출하지 않는다
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  syncFromResponse(res);

  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const err = (body ?? {}) as { error?: string; message?: string };
    throw new ApiError(res.status, err.error ?? "unknown", err.message);
  }
  return body as T;
}

export const post = <T,>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const put = <T,>(path: string, body: unknown) =>
  api<T>(path, { method: "PUT", body: JSON.stringify(body) });

export const del = <T,>(path: string) => api<T>(path, { method: "DELETE" });
