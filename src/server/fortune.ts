/**
 * 운세 한 편을 LLM 에게 받아온다.
 *
 * **Worker 에서 호출한다. 회차 DO 안에서 부르지 마라** — DO 는 요청을 한 줄로 처리해서,
 * 응답을 1~3초 기다리는 동안 그 회차의 모든 요청이 뒤에 선다. 파티 중에는 그게 곧 정지다.
 *
 * 모델과 주소를 환경 변수로 둔다. 제공자가 바뀌어도 코드가 아니라 설정이 바뀌게.
 * OpenAI 호환(`/chat/completions`) 형식으로 말을 건다 — 요즘 대부분이 이 모양을 받는다.
 *
 * 실패는 **정상 경로**다. 키가 없거나, 모델 이름이 틀렸거나, 느리거나, 형식이 어긋나면
 * 규칙 문구로 떨어진다 (`fallbackFortune`). 파티 당일에 탭 하나가 에러를 뿜는 건 사고다.
 */
import type { FortuneDraft, FortuneInput, MissionInput } from "../shared/fortune.ts";
import { fallbackFortune, fallbackMission, parseFortune, parseMission } from "../shared/fortune.ts";
import { FORTUNE, MISSION } from "../shared/copy.ts";
import type { Env } from "./http.ts";

/** 파티 중이다. 오래 기다리느니 규칙 문구가 낫다 — 다만 카드 뒤집기가 앞의 1초를 덮는다 */
const TIMEOUT_MS = 12000;

/**
 * 한국어 세 문단 + 미션이면 400 토큰으로는 **문장 중간에서 잘린다.**
 * 잘린 JSON 은 파싱에 실패하고, 실패는 조용히 규칙 문구가 된다 —
 * 그래서 "가끔 LLM 이 안 나오네" 로만 보였다. 넉넉히 준다.
 */
const MAX_TOKENS = 3000;

/**
 * 설정에서 읽는 temperature (ADR-60). **읽을 수 없으면 `undefined`** — 그러면 아예 안 보낸다.
 *
 * 오타 하나로 그 회차의 운세가 전부 규칙 문구가 되는 길을 막는다.
 * 범위는 제공자가 받는 만큼만 — 벗어난 값은 400 이 되고, 400 은 조용한 실패다.
 */
function temperatureOf(env: Env): number | undefined {
  const raw = env.LLM_TEMPERATURE;
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 2 ? n : undefined;
}

export async function makeFortune(env: Env, input: FortuneInput, now: number): Promise<FortuneDraft> {
  const key = env.OPENAI_API_KEY;
  if (!key) return fallbackFortune(input, now, FORTUNE.fallback);
  const temp = temperatureOf(env);

  try {
    const res = await fetch(`${env.LLM_BASE_URL || "https://api.openai.com/v1"}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        // 이름이 틀리면 규칙 문구로 떨어진다. 앱이 멈추지는 않는다
        model: env.LLM_MODEL || "gpt-5.6-luna",
        messages: [
          { role: "system", content: FORTUNE.prompt.system },
          { role: "user", content: FORTUNE.prompt.user(input) },
        ],
        max_completion_tokens: MAX_TOKENS,
        /*
         * **운세 쪽에만 붙인다** (ADR-60). 여기서 필요한 건 수렴이 아니라 발산이다 —
         * 마흔 명의 재료가 거의 같아서, 잘 고를수록 다 같은 답에 도착한다.
         * 미션은 반대다. 지켜야 할 제약이 열 개라 흔들리면 손해다.
         */
        ...(temp !== undefined ? { temperature: temp } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`llm ${res.status}`);

    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    };
    const choice = body.choices?.[0];
    const parsed = parseFortune(choice?.message?.content ?? "", input, now);
    if (parsed) return parsed;

    // 왜 떨어졌는지 남긴다. 잘린 것과 형식이 어긋난 것은 고치는 방법이 다르다
    console.error("fortune unusable", { finish: choice?.finish_reason, len: choice?.message?.content?.length });
    return fallbackFortune(input, now, FORTUNE.fallback);
  } catch (e) {
    // 원인은 남기되 참가자에게는 티가 나지 않는다
    console.error("fortune failed", e);
    return fallbackFortune(input, now, FORTUNE.fallback);
  }
}

/**
 * 미션이 내놓는 것. `lead` 는 **LLM 이 빼먹을 수 있다** — 그래도 미션은 살린다
 * (`parseMission`). 규칙 문구 쪽은 언제나 둘 다 있다.
 */
type MissionOut = { mission: string; lead?: string };

/**
 * 오늘의 미션. **운세가 나온 뒤에** 부른다 — 그 결과가 재료라서 나란히 못 부른다.
 *
 * 내놓는 건 두 칸이다: 왜 오늘 이것인지(`lead`)와 언제 무엇을(`mission`).
 * 미션 한 줄만 던지면 남이 준 숙제로 읽힌다 — 이유가 붙어야 내 운세에서 나온 것이 된다.
 *
 * 한 호출에서 운세와 함께 뽑던 시절에는 미션이 본문 마지막 문단을 그대로 옮겨 적곤 했다.
 * 다 읽고 나서 따로 물으면 겹치지 않는다.
 *
 * 실패는 여기서도 정상 경로다. 미션이 안 나와도 운세는 그대로 뜬다 —
 * 둘이 함께 죽지 않게 실패를 각자 삼킨다.
 */
export async function makeMission(env: Env, input: MissionInput): Promise<MissionOut> {
  const key = env.OPENAI_API_KEY;
  if (!key) return fallbackMission(input, MISSION.fallback);

  try {
    const res = await fetch(`${env.LLM_BASE_URL || "https://api.openai.com/v1"}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: env.LLM_MODEL || "gpt-5.6-luna",
        messages: [
          { role: "system", content: MISSION.prompt.system },
          { role: "user", content: MISSION.prompt.user(input) },
        ],
        max_completion_tokens: MAX_TOKENS,
        /*
         * **미션에만 추론을 올린다** (ADR-60). 이쪽은 동시에 만족시켜야 할 제약이 열 개다 —
         * 언제가 문장에 있을 것 · 눈에 보이는 동작일 것 · 마음가짐이 아닐 것 ·
         * 실패해도 티가 안 날 것 · 매력을 자랑이 아니라 자리 열기로 쓸 것 · 운세를 안 베낄 것.
         * 제약 만족은 더 생각할수록 나아진다.
         *
         * 운세에는 올리지 않는다. 거기서 필요한 건 **갈라지는 것**이고,
         * 추론은 수렴한다 — 같은 재료에 같은 제약이면 다 같은 정답에 도착한다.
         *
         * **`max_completion_tokens` 에 추론 토큰이 함께 들어간다.** 3000 은 세 문단짜리
         * 운세를 위한 값이라 두 칸짜리 미션에는 넉넉하지만, 이 값을 줄일 때는
         * 잘린 JSON 이 조용히 규칙 문구가 되는 길(위 주석)이 여기서도 열린다는 걸 기억하라.
         */
        reasoning_effort: "high",
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`llm ${res.status}`);

    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    };
    const choice = body.choices?.[0];
    const parsed = parseMission(choice?.message?.content ?? "");
    if (parsed) return parsed;

    console.error("mission unusable", { finish: choice?.finish_reason, len: choice?.message?.content?.length });
    return fallbackMission(input, MISSION.fallback);
  } catch (e) {
    console.error("mission failed", e instanceof Error ? e.message : e);
    return fallbackMission(input, MISSION.fallback);
  }
}
