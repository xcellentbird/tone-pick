import { FAIL } from "../../shared/copy.ts";
import { syncFromResponse } from "./serverTime.ts";
import { tabRef } from "./session.ts";

/**
 * 서버는 자료를 그대로 돌려주고, 서버 시각은 `x-server-time` 헤더로만 싣는다.
 * 실패는 `{ error, message }` 다 — `message` 는 서버가 `copy.ts` 에서 골라 담은 문장이라
 * 화면에서는 그대로 보여주면 된다. 여기서 문장을 새로 짓지 마라.
 */
/**
 * 요청이 **매달려 있을 때** 끊는 시간.
 *
 * `fetch` 에는 기본 시간 제한이 없다. 브라우저가 끊긴 걸 아는 경우(비행기 모드)는
 * 곧바로 거부되지만, 약전계에서 요청이 나갔다 매달리면 **브라우저가 포기할 때까지
 * 수십 초에서 몇 분** 걸린다. 그동안 참가자는 어두운 빈 화면을 보고 있고,
 * 할 수 있는 일이 아무것도 없다 — 오류 화면을 만들어놓고 정작 필요한 때 안 뜨는 셈이다.
 *
 * **운세만 따로 잡는다.** 미리 만들어두지 않고 **뒤집는 순간 LLM 을 부르기 때문이다**
 * (ADR-20 — 여는 동작이 있어야 오늘 것처럼 읽힌다. 게다가 생년월일이 그때 들어온다).
 * 서버가 12초에 규칙 문구로 떨어뜨리므로 최악이 ~13초인데, 10초로 끊으면
 * **정상인 운세를 우리가 먼저 끊는다.**
 */
const TIMEOUT_MS = 10_000;
const SLOW_MS = 25_000;

/** 이 경로로 시작하면 오래 기다린다. `/fortune` 과 `/fortune/mission` 이 함께 걸린다 */
export function timeoutFor(path: string): number {
  return path.startsWith("/fortune") ? SLOW_MS : TIMEOUT_MS;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public userMessage?: string,
  ) {
    super(code);
  }
}

/** 서버가 어느 세션을 읽을지 고르는 헤더. `src/server/auth.ts` 의 `REF_HEADER` 와 같은 값이다 */
const REF_HEADER = "x-tp-ref";

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  const ref = tabRef();
  try {
    res = await fetch(`/api${path}`, {
      credentials: "include", // 세션은 HttpOnly 쿠키. 전화번호를 URL 에 노출하지 않는다
      ...init,
      /*
       * 매달린 요청을 끊는다. **`...init` 뒤에 둔다** — 앞에 두면 호출자가 `init` 을
       * 넘기는 순간 신호가 조용히 덮이고, 시간 제한이 사라진 걸 아무도 모른다.
       *
       * `?.` 는 이 정적 메서드가 없는 옛 사파리를 위한 것이다. 없으면 `undefined` 가
       * 들어가고, 시간 제한만 없어질 뿐 요청은 그대로 나간다.
       */
      signal: AbortSignal.timeout?.(timeoutFor(path)),
      /*
       * **이 탭이 누구인지 서버에 알린다** (ADR-44). 이름표는 비밀이 아니다 —
       * 브라우저가 들고 있는 여러 참가자 쿠키 중 어느 것을 읽을지 고를 뿐이고,
       * 증명은 그 쿠키 안에 있다. 이름표가 없으면 서버가 기본 세션을 읽는다.
       */
      headers: {
        "content-type": "application/json",
        ...(ref ? { [REF_HEADER]: ref } : {}),
        ...(init?.headers ?? {}),
      },
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
     * **시간 초과도 여기로 온다** (`AbortSignal.timeout` 은 거부로 떨어진다).
     * 참가자가 할 일은 둘 다 같으므로 — 다시 시도 — 문구를 나누지 않는다.
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
