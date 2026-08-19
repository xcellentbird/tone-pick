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

export async function makeFortune(env: Env, input: FortuneInput, now: number): Promise<FortuneDraft> {
  const key = env.OPENAI_API_KEY;
  if (!key) return fallbackFortune(input, now, FORTUNE.fallback);

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
