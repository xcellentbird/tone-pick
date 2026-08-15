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
import type { Fortune, FortuneInput } from "../shared/fortune.ts";
import { fallbackFortune, parseFortune } from "../shared/fortune.ts";
import { FORTUNE } from "../shared/copy.ts";
import type { Env } from "./http.ts";

/** 파티 중이다. 오래 기다리느니 규칙 문구가 낫다 */
const TIMEOUT_MS = 6000;

export async function makeFortune(env: Env, input: FortuneInput, now: number): Promise<Fortune> {
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
        max_completion_tokens: 400,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`llm ${res.status}`);

    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = body.choices?.[0]?.message?.content ?? "";
    return parseFortune(text, input, now) ?? fallbackFortune(input, now, FORTUNE.fallback);
  } catch (e) {
    // 원인은 남기되 참가자에게는 티가 나지 않는다
    console.error("fortune failed", e);
    return fallbackFortune(input, now, FORTUNE.fallback);
  }
}
