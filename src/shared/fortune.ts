/**
 * 오늘의 연애운 — 순수 함수만 모아둔 곳.
 *
 * 여기 있는 건 전부 **입력만 보고 답이 정해지는** 것들이다. 그래서 LLM 이 없어도,
 * 키가 없어도, 파티 당일에 외부 서비스가 죽어도 화면은 산다.
 * 실제 호출은 Worker 가 하고 (`server/fortune.ts`), 결과는 회차 DO 에 한 번만 저장된다.
 *
 * ⚠️ **LLM 에 보내는 값은 `fortuneInput()` 이 만드는 것뿐이다.**
 *    실명·전화번호·인스타는 절대 넣지 마라. 다른 참가자에게도 안 주는 걸
 *    외부 서비스에 보내는 건 더 나쁘다 (ADR-20).
 */
import type { Gender } from "./types.ts";

/** 카드 배경에 쓰는 색. 테마 토큰 이름이라 어떤 결과가 나와도 화면이 깨지지 않는다 */
export type FortuneColor = "violet" | "gold" | "teal" | "coral";

export interface Fortune {
  /** 이 화면의 주인공. 한 줄이다 */
  headline: string;
  /** 오늘의 나를 말하는 2~3문장 */
  body: string;
  /** 파티에서 실제로 쓸 수 있는 것 — 말 붙이는 문장 하나를 통째로 준다 */
  step: string;
  color: FortuneColor;
  /** 오늘 말이 잘 통할 결. 규칙으로 정한다 (LLM 아님) */
  matchTypes: [string, string];
  at: number;
  /** 규칙으로 만든 문구인가. 화면에서는 구분하지 않고, 운영자가 원인을 찾을 때 쓴다 */
  fallback?: boolean;
}

/**
 * LLM 에 보내는 값. **이 함수가 개인정보 경계다.**
 *
 * 여기 담기는 건 전부 이미 다른 참가자에게 보이는 것들이다 —
 * 닉네임·나이·성별·MBTI·매력 3가지. 그 밖의 것은 담지 않는다.
 */
export interface FortuneInput {
  nickname: string;
  age: number;
  gender: "M" | "F";
  mbti: string;
  charms: string[];
}

/**
 * DO 를 거쳐 오면 튜플이 배열로 풀린다. 여기서 좁히지 말고 넓게 받는다 —
 * 이 함수가 하는 일은 **덜어내는 것**이지 모양을 맞추는 게 아니다.
 */
export function fortuneInput(p: {
  nickname: string;
  age: number;
  gender: Gender;
  mbti: string;
  charms: readonly string[];
}): FortuneInput {
  return {
    nickname: p.nickname,
    age: p.age,
    gender: p.gender,
    mbti: p.mbti,
    charms: [...p.charms],
  };
}

/**
 * 사람마다 다르되 **매번 같은** 값을 뽑는 씨앗.
 * 운세가 열 때마다 달라지면 그 순간 전부 거짓말이 된다.
 */
export function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

const COLORS: FortuneColor[] = ["violet", "gold", "teal", "coral"];

export function pickColor(seed: number): FortuneColor {
  return COLORS[seed % COLORS.length];
}

/**
 * 오늘 말이 잘 통할 결.
 *
 * 과학이 아니라 운세다. 다만 **아무 말이나 하지는 않는다** —
 * 세상을 보는 방식(N/S)이 같으면 이야기가 붙고, 에너지(E/I)가 다르면
 * 한쪽이 말하고 한쪽이 듣는다. 그 두 가지만 규칙으로 쓴다.
 */
export function matchTypes(mbti: string): [string, string] {
  const m = /^[EI][NS][TF][JP]$/.test(mbti) ? mbti : "ENFP";
  const flip = (c: string, a: string, b: string) => (c === a ? b : a);
  const same = m[1];
  return [
    `${flip(m[0], "E", "I")}${same}${m[2]}${m[3]}`,
    `${flip(m[0], "E", "I")}${same}${flip(m[2], "T", "F")}${flip(m[3], "J", "P")}`,
  ];
}

/**
 * LLM 없이 만드는 운세.
 *
 * 키가 없을 때만 쓰는 임시 문구가 아니다 — 파티 당일 외부 서비스가 느리거나 죽어도
 * **이 화면은 반드시 뜬다.** 그래서 이쪽 문장도 읽을 만해야 한다.
 * 본인이 쓴 매력 한 줄을 그대로 안아 쓴다. 남이 지어준 말보다 잘 맞는다.
 */
export function fallbackFortune(input: FortuneInput, now: number, lines: FallbackLines): Fortune {
  const seed = seedOf(`${input.nickname}:${input.mbti}`);
  const charm = input.charms[seed % input.charms.length] ?? "";
  return {
    headline: lines.headline[seed % lines.headline.length],
    body: lines.body(charm, input.mbti[0] === "E"),
    step: lines.step[(seed >> 3) % lines.step.length],
    color: pickColor(seed),
    matchTypes: matchTypes(input.mbti),
    at: now,
    fallback: true,
  };
}

/** 문구는 `copy.ts` 에서 넘겨받는다. 이 파일에는 한국어를 두지 않는다 */
export interface FallbackLines {
  headline: readonly string[];
  step: readonly string[];
  body: (charm: string, outgoing: boolean) => string;
}

/**
 * LLM 응답을 읽는다. 모델이 무엇을 뱉든 **화면에 들어갈 수 있는 모양**만 통과시킨다.
 * 하나라도 비면 통째로 버리고 규칙 문구를 쓴다 — 반쯤 채워진 운세가 제일 이상하다.
 */
export function parseFortune(raw: string, input: FortuneInput, now: number): Fortune | null {
  const text = raw.trim().replace(/^```(?:json)?/, "").replace(/```$/, "");
  let data: { headline?: unknown; body?: unknown; step?: unknown };
  try {
    data = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch {
    return null;
  }
  const str = (v: unknown, max: number) =>
    typeof v === "string" && v.trim().length > 0 && v.length <= max ? v.trim() : null;

  const headline = str(data.headline, 60);
  const body = str(data.body, 400);
  const step = str(data.step, 120);
  if (!headline || !body || !step) return null;

  return {
    headline,
    body,
    step,
    color: pickColor(seedOf(`${input.nickname}:${input.mbti}`)),
    matchTypes: matchTypes(input.mbti),
    at: now,
  };
}
