import { FAIL } from "../../shared/copy.ts";
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
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      credentials: "include", // 세션은 HttpOnly 쿠키. 전화번호를 URL 에 노출하지 않는다
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    /*
     * 서버에 **닿지도 못했다** — 망이 끊겼거나 폰이 절전에서 막 깨어났거나.
     *
     * 감싸지 않으면 날 `TypeError` 가 올라가고, 화면은 `userMessage` 가 없어
     * `ENTRY.notFound`("그런 회차가 없어요") 로 떨어진다. 잠깐 끊긴 참가자에게
     * **"네 링크가 잘못됐다"** 고 말하는 셈이다 — 그 사람은 링크를 의심하고
     * 운영자에게 엉뚱한 걸 묻는다.
     *
     * 상태 코드는 0 이다. HTTP 응답이 아예 없었다는 뜻이라 어떤 숫자와도 겹치지 않는다.
     */
    throw new ApiError(0, "offline", FAIL.offline);
  }
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
