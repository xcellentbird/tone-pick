/**
 * 운영 카운터. **회차 DO 밖에 쌓이는 유일한 자료다.**
 *
 * ⚠️ 그래서 무엇을 넣는지가 곧 개인정보 경계다. 선은 하나다 —
 * **운영 카운터는 넣고, 결과 통계는 넣지 않는다.**
 *
 *   넣는다    입장 시도 결과 · LLM 폴백 여부 · 회차 아이디
 *   안 넣는다  매칭 쌍 수 · 콕 수 · 순위 · 참가자 아이디 · 번호 · 닉네임
 *
 * 이유는 **인원이 적을 때** 드러난다. 두 명짜리 회차에서 `입장 2건 · 성공 2건` 은
 * 운영자가 콘솔에서 이미 보는 것과 같다. 그런데 `매칭 1쌍` 은 **그 둘이 서로 찔렀다**는
 * 뜻이다 — 이 앱이 끝까지 감추기로 한 바로 그 정보이고, 파기 뒤에도 남는다.
 *
 * 파기는 DO 하나 지우는 일로 끝나야 한다. 여기 쌓이는 것은 사람을 가리키지 않으므로
 * 그 보장을 깨지 않는다. **가리키게 되는 순간 그 보장이 사라진다.**
 *
 * 바인딩이 없어도 앱은 돈다 (테스트·로컬). 지표는 있으면 좋은 것이지 없으면 안 되는 게 아니다.
 */
import type { Env } from "./http.ts";

/** 재는 것. 늘리기 전에 위의 경계를 다시 읽어라 */
export type Metric =
  /** 입장 시도의 끝. 명단 문제가 조용히 쌓이는 걸 여기서 본다 */
  | { kind: "enter"; outcome: "ok" | "not_invited" | "too_many" }
  /** 운세·미션이 규칙 문구로 떨어졌나. LLM 이 조용히 죽어도 화면은 멀쩡히 뜬다 */
  | { kind: "fortune"; outcome: "llm" | "fallback" };

/**
 * 한 건 센다. **던지지 않는다** — 지표를 쓰다 실패해서 참가자 요청이 깨지면 본말이 뒤바뀐다.
 */
export function count(env: Env, eventId: string, m: Metric): void {
  try {
    env.METRICS?.writeDataPoint({
      blobs: [m.kind, m.outcome],
      doubles: [1],
      indexes: [eventId],
    });
  } catch {
    /* 지표는 있으면 좋은 것이다. 여기서 요청을 깨뜨리지 않는다 */
  }
}

// ─────────────────────────────────────────── 집계 지표 (ADR-56)

/**
 * 사용성·성능을 재는 것. **회차를 가리지 않는다.**
 *
 * ⚠️ **이 함수는 `eventId` 를 받지 않는다. 그게 방어다** — 넘길 자리가 없으면
 * 실수로 넘길 수도 없다 (`count()` 와 갈라둔 이유가 이것 하나다).
 *
 * 위의 `count()` 는 회차를 가린다. 운영자가 *이 회차 명단에 문제가 있나* 를 봐야 하고,
 * 그건 운영자가 콘솔에서 이미 보는 것과 같은 값이라 새로 여는 게 없다.
 * **사용성·성능은 회차를 가릴 이유가 없다.** 그리고 가리는 순간,
 * 인원이 적은 회차에서 `등록 2단계 이탈 1건` 은 **그 한 사람**을 가리킨다 —
 * 위에 적은 `매칭 1쌍` 과 정확히 같은 종류의 사고이고, 파기 뒤에도 남는다.
 *
 * 그래서 여기 담기는 것은 셋뿐이다: **무엇이(화면·버튼·라우트) · 어땠나(결과·버킷) ·
 * 누구 쪽인가(`player`/`host` 라는 범주)**. 사람도, 회차도, 상대도 없다.
 */
export type Pulse =
  /** 서버가 잰 응답 시간. `route` 는 **등록된 패턴**이다 — 원본 경로에는 회차 아이디와 토큰이 있다 */
  | { kind: "api"; route: string; outcome: string; ms: number }
  /** 어느 화면까지 왔나 */
  | { kind: "nav"; key: string; who: Who }
  /** 무엇이 눌렸나. **몇 번인지만 센다** */
  | { kind: "tap"; key: string; who: Who }
  /** 소켓이 열렸나 끊겼나 다시 붙었나. 파티장 와이파이가 여기서만 보인다 */
  | { kind: "ws"; key: string; who: Who }
  /** 한 번 머문 길이. **버킷만** 담는다 — 원값은 부르는 쪽에서 이미 버렸다 */
  | { kind: "stay"; bucket: string; who: Who }
  /**
   * 운영자가 자리를 손본 조작 (ADR-58). **알고리즘이 어디서 틀렸나를 여기서 읽는다** —
   * 사람이 손으로 고쳤다는 건 계산이 놓쳤다는 뜻이다.
   *
   * `draft` 와 `publish` 의 비가 *초안을 몇 번 다시 뽑았나*,
   * `swap` 과 `publish` 의 비가 *한 배정에 몇 번 손댔나* 다.
   *
   * ⚠️ **누구를 옮겼는지는 담지 않는다.** 자리 번호도, 참가자도, 라운드도 없다 —
   * 조작의 종류 하나뿐이다. 이 목록에 사람을 가리키는 값을 더하지 마라.
   */
  | { kind: "seating"; key: SeatingKey };

/**
 * 자리를 손보는 조작. **서버가 만드는 값이라 허용 목록이 아니라 타입으로 막는다** —
 * `pulse.ts` 의 목록은 *화면이 보낸 문자열*을 거르는 자리고, 여기는 그 통로가 아니다.
 */
export const SEATING_KEYS = [
  "draft",    // 배정을 눌러 초안이 나왔다
  "swap",     // 두 사람을 맞바꿨다
  "seat",     // 자리 없는 사람을 앉혔다
  "unseat",   // 이 라운드에서 뺐다
  "shuffle",  // 사람만 다시 섞었다
  "discard",  // 초안을 버렸다
  "publish",  // 발행했다
] as const;
export type SeatingKey = (typeof SEATING_KEYS)[number];

/** 참가자 쪽인가 운영자 쪽인가. **범주지 신원이 아니다** — 두 화면은 쓰임새가 아예 다르다 */
export type Who = "player" | "host";

/**
 * 집계 한 건 센다. `count()` 와 달리 **인덱스를 쓰지 않는다** —
 * 인덱스는 Analytics Engine 이 묶어 세는 축이고, 여기서는 묶을 축이 없는 것이 요건이다.
 */
export function pulse(env: Env, p: Pulse): void {
  try {
    const [b, d] =
      p.kind === "api"
        ? [[p.kind, p.route, p.outcome], [1, p.ms]]
        : p.kind === "stay"
          ? [[p.kind, p.bucket, p.who], [1]]
          : p.kind === "seating"
            ? [[p.kind, p.key], [1]]   // `who` 를 두지 않는다 — 운영자만 하는 일이라 물을 것이 없다
            : [[p.kind, p.key, p.who], [1]];
    env.METRICS?.writeDataPoint({ blobs: b, doubles: d });
  } catch {
    /* 위와 같다. 지표가 요청을 깨뜨리지 않는다 */
  }
}
