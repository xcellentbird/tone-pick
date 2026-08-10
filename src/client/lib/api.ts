import type { Envelope } from "../../shared/types.ts";
import { syncFromResponse } from "./serverTime.ts";

export class ApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "include", // 세션은 HttpOnly 쿠키. 전화번호를 URL 에 노출하지 않는다
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  syncFromResponse(res);
  const body = (await res.json().catch(() => ({}))) as Partial<Envelope<T>> & { error?: string };
  if (!res.ok) throw new ApiError(res.status, body.error ?? "unknown");
  return body.data as T;
}
