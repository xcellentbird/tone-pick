/**
 * 이상형 찾기의 설명글 (ADR-134) — 같은 화면에서 고른 얼굴과 고르지 않은 얼굴을 LLM 에게 보여 주고 **차이**를 받는다.
 *
 * **Worker 에서 호출한다. 회차 DO 안에서 부르지 마라** — 운세(`fortune.ts`)와 같은 이유다. 몇 초를 기다리는 동안
 * 그 회차의 모든 요청이 뒤에 선다.
 *
 * **보내는 것은 연예인 사진과 골랐다 / 안 골랐다 뿐이다** (`idealStoryInput`). 참가자의 이름 · 닉네임 · 번호는 이 모듈에
 * 오지 않는다 — 운세의 실명 예외(ADR-20)를 여기로 넓히지 마라.
 *
 * 사진은 **그 판의 자산에서 꺼내 본문에 싣는다**(data URL). 주소만 주면 제공자가 이 워커에 사진을 받으러 와야 해서,
 * 그쪽에서 못 받으면 조용히 실패한다. 한 장이 6KB 안팎이라 열여덟 장이어도 100KB 남짓이다.
 * base64 는 **런타임의 것**으로만 바꾼다 (`toBase64` — 아래). 자바스크립트로 돌리면 CPU 한도에 닿는다.
 *
 * 실패는 **정상 경로**다 — 키가 없거나, 사진을 못 꺼냈거나, 느리거나, 형식이 어긋나면 null 이고
 * 화면은 고른 얼굴의 낱말로 쓴 글(ADR-128)을 그대로 그린다.
 */
import { IDEAL_STORY } from "../shared/copy.ts";
import { STORY_ROUNDS, parseIdealStory, type Ideal } from "../shared/ideal.ts";
import type { Env } from "./http.ts";

/** 사진 열여덟 장을 본다. 시험에서 3~13초였다 — 기기는 25초까지 기다린다 (`timeoutFor`) */
const TIMEOUT_MS = 20000;

/** 두 문장이면 넉넉하다. 추론 토큰이 함께 든다 — 잘린 JSON 은 조용한 실패라 낮게 잡지 않는다 (운세와 같은 교훈) */
const MAX_TOKENS = 2000;

/** LLM 에 가는 재료. **id 뿐이다** — 사진은 그 판의 자산에서 꺼낸다 */
export interface IdealStoryInput {
  v: number;
  rounds: { round: number; picked: string[]; rest: string[] }[];
}

/** 결과 한 줄과 기기가 다시 세운 화면(`readIdealStoryPages` 를 지난 것)에서 재료를 짓는다. 다른 칸은 읽지 않는다 */
export function idealStoryInput(ideal: Pick<Ideal, "v" | "picks">, pages: readonly (readonly string[])[]): IdealStoryInput {
  return {
    v: ideal.v,
    rounds: STORY_ROUNDS.map((round, i) => {
      const picked = new Set(ideal.picks[round - 1]);
      const page = pages[i] ?? [];
      return { round, picked: page.filter((id) => picked.has(id)), rest: page.filter((id) => !picked.has(id)) };
    }),
  };
}

/**
 * 런타임이 가진 base64 — `Uint8Array.prototype.toBase64`. **자바스크립트로 돌려 바꾸지 마라** — 열여덟 장(100KB 남짓)을
 * `String.fromCharCode` + `btoa` 로 바꾸면 데운 뒤 3.6ms, 첫 호출은 12.8ms 였다(V8). 무료 플랜의 요청당 CPU 는 10ms 다.
 * 없는 런타임이면 사진 주소를 준다 — 그때는 제공자가 받으러 온다
 */
const toBase64 = (Uint8Array.prototype as Uint8Array & { toBase64?: () => string }).toBase64;

/** 사진 한 장 → data URL (런타임에 base64 가 있으면) 또는 주소. 없는 파일에는 SPA 폴백이 index.html 을 200 으로 주므로 형식을 본다 */
async function photo(env: Env, origin: string, v: number, id: string): Promise<string> {
  const url = `${origin}/faces/v${v}/${id}.webp`;
  if (!toBase64) return url;
  const res = await env.ASSETS.fetch(new Request(url));
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !type.startsWith("image/")) throw new Error(`photo ${id} ${res.status} ${type}`);
  return `data:${type.split(";")[0]};base64,${toBase64.call(new Uint8Array(await res.arrayBuffer()))}`;
}

export async function makeIdealStory(env: Env, input: IdealStoryInput, origin: string): Promise<string | null> {
  const key = env.OPENAI_API_KEY;
  if (!key) return null;

  try {
    const groups = input.rounds.flatMap((r) => [
      { label: IDEAL_STORY.prompt.label(r.round, true), ids: r.picked },
      { label: IDEAL_STORY.prompt.label(r.round, false), ids: r.rest },
    ]);
    const urls = await Promise.all(groups.map((g) => Promise.all(g.ids.map((id) => photo(env, origin, input.v, id)))));
    const content = groups.flatMap((g, i) => [
      { type: "text", text: g.label },
      // 낮은 해상도로 본다 — 생김새와 표정은 그대로 보이고 토큰은 장당 수십이다
      ...urls[i].map((url) => ({ type: "image_url", image_url: { url, detail: "low" } })),
    ]);

    const res = await fetch(`${env.LLM_BASE_URL || "https://api.openai.com/v1"}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: env.LLM_MODEL || "gpt-5.6-luna",
        messages: [
          { role: "system", content: IDEAL_STORY.prompt.system },
          { role: "user", content },
        ],
        max_completion_tokens: MAX_TOKENS,
        /*
         * 견주는 일이라 조금 생각하게 둔다. temperature 는 보내지 않는다 — 운세의 실험값(ADR-60)은 발산을 사려는 것이고,
         * 여기서 필요한 건 사진에 맞는 말이다. 인상 낱말이 한쪽으로 모이는 것은 프롬프트의 낱말 표가 막는다
         */
        reasoning_effort: "low",
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`llm ${res.status}`);

    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    };
    const choice = body.choices?.[0];
    const text = parseIdealStory(choice?.message?.content ?? "");
    if (text) return text;
    // 잘린 것과 형식이 어긋난 것은 고치는 방법이 다르다 — 글은 남기지 않는다
    console.error("ideal story unusable", { finish: choice?.finish_reason, len: choice?.message?.content?.length });
    return null;
  } catch (e) {
    console.error("ideal story failed", e);
    return null;
  }
}
