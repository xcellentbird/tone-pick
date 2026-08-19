/**
 * 오늘의 연애운 — 순수 함수만 모아둔 곳.
 *
 * 여기 있는 건 전부 **입력만 보고 답이 정해지는** 것들이다. 그래서 LLM 이 없어도,
 * 키가 없어도, 파티 당일에 외부 서비스가 죽어도 화면은 산다.
 * 실제 호출은 Worker 가 하고 (`server/fortune.ts`), 결과는 회차 DO 에 한 번만 저장된다.
 *
 * ⚠️ **LLM 에 보내는 값은 이 파일의 두 입력 함수가 만드는 것뿐이다.**
 *    전화번호·인스타는 절대 넣지 마라.
 *
 *    실명은 **운세 호출 하나에만** 예외로 들어간다 (ADR-20 개정). 세 가지가 함께 지켜져야 한다.
 *      · 어필 호출에는 넣지 않는다 — 예외는 하나뿐이라야 예외다
 *      · **답변에 이름이 나오지 않게** 프롬프트가 막는다. 그래서 저장물에도, 화면에도 없다
 *      · 어디에도 저장하지 않는다. 생년월일과 같다 — 전송에만 쓴다
 */
import type { Gender } from "./types.ts";

/** 카드 배경에 쓰는 색. 테마 토큰 이름이라 어떤 결과가 나와도 화면이 깨지지 않는다 */
export type FortuneColor = "violet" | "gold" | "teal" | "coral";

export interface Fortune {
  /** 이 화면의 주인공. 한 줄이다 */
  headline: string;
  /** 오늘의 나를 말하는 **3~5문단**. 문단 사이는 빈 줄이다 */
  body: string;
  /** 오늘의 기운에서 이어지는 작은 미션. 30분 안에 해볼 수 있고 실패해도 티가 나지 않는 것 */
  mission: string;
  color: FortuneColor;
  at: number;
  /**
   * 오늘의 어필. **운세를 재료로 두 번째 호출**에서 나온다 —
   * 두 카드가 따로 놀면 한 화면에 남남인 글 두 개가 된다.
   * 옛 저장본에는 없다. 화면이 조건부로 그린다.
   */
  appeal?: Appeal;
  /** 규칙으로 만든 문구인가. 화면에서는 구분하지 않고, 운영자가 원인을 찾을 때 쓴다 */
  fallback?: boolean;
}

/**
 * 운세 호출에 보내는 값. **이 타입이 개인정보 경계다.**
 *
 * 사주를 보는 재료만 담는다 — 이름·생년월일·성별. 닉네임·MBTI·매력은 담지 않는다
 * (그건 어필 호출의 재료다).
 *
 * **실명은 여기서만 예외다** (ADR-20 개정). 대신 셋을 함께 지킨다 —
 * 답변에 이름이 나오지 않게 프롬프트가 막고, 저장하지 않고, 어필 호출에는 넣지 않는다.
 */
export interface FortuneInput {
  /** 사주를 부르는 이름. **전송에만 쓴다** — 답변에도, 저장물에도 남지 않는다 */
  realName: string;
  gender: "M" | "F";
  /**
   * 여는 순간 본인이 넣는 생년월일. **전송에만 쓰고 저장하지 않는다** —
   * 운세와 함께 남기면 전화번호와 나란히 놓이는 가장 무거운 신원 정보가 된다.
   */
  birth?: { year: number; month: number; day: number };
}

/**
 * 어필 호출에 보내는 값. **이름은 없다** — 예외는 운세 하나뿐이라야 예외다.
 *
 * 운세 결과를 함께 넘긴다. 두 카드가 한 화면에 나란히 서는데 서로를 모르면
 * 남남인 글 두 개가 된다 — 오늘의 결에서 이어지는 어필이라야 읽을 값어치가 있다.
 */
export interface AppealInput {
  age: number;
  gender: "M" | "F";
  charms: string[];
  fortune: { headline: string; body: string; mission: string };
}

/** 오늘의 어필. 매력 3가지에 하나씩 대응하는 팁 */
export interface Appeal {
  headline: string;
  tips: string[];
}

/**
 * DO 를 거쳐 오면 튜플이 배열로 풀린다. 여기서 좁히지 말고 넓게 받는다 —
 * 이 함수가 하는 일은 **덜어내는 것**이지 모양을 맞추는 게 아니다.
 */
export function fortuneInput(
  p: { realName: string; gender: Gender },
  birth?: { year: number; month: number; day: number },
): FortuneInput {
  return {
    realName: p.realName,
    gender: p.gender,
    ...(birth ? { birth } : {}),
  };
}

/** 어필 호출에 보내는 값을 만든다. **이름을 넣지 마라** — 여기가 그 경계다 */
export function appealInput(
  p: { age: number; gender: Gender; charms: readonly string[] },
  fortune: Fortune,
): AppealInput {
  return {
    age: p.age,
    gender: p.gender,
    charms: [...p.charms],
    fortune: { headline: fortune.headline, body: fortune.body, mission: fortune.mission },
  };
}

/**
 * 생년월일이 진짜 달력의 날인가. 이름표(별자리·띠)를 뽑을 수 있으면 통과다 —
 * 나이와 맞는지는 따지지 않는다. 운세는 재미지 신원 확인이 아니다.
 */
export function validBirth(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < 1900 || y > 2099) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * 별자리 번호 (0=물병 … 11=염소). 이름은 `copy.ts` 가 갖는다 — 이 파일에는 한국어를 두지 않는다.
 * 그 달의 경계일 이후면 그 달의 별자리, 전이면 앞 달 것이다.
 */
const ZODIAC_CUT = [20, 19, 21, 20, 21, 22, 23, 23, 24, 23, 23, 25];
export function zodiacIndex(month: number, day: number): number {
  return day >= ZODIAC_CUT[month - 1] ? month - 1 : (month + 10) % 12;
}

/** 띠 번호 (0=쥐 … 11=돼지) */
export function animalIndex(year: number): number {
  return (((year - 4) % 12) + 12) % 12;
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
 * 저장물에 남는 값(색)과 대체 문구를 고르는 씨앗.
 *
 * **실명을 쓰지 않는다.** 저장되는 값이 이름에서 나오면 이름이 간접적으로 남는 셈이다 —
 * 생년월일과 성별이면 사람마다 갈리기에 충분하다.
 */
function fortuneSeed(input: FortuneInput): number {
  const b = input.birth;
  return seedOf(`${b ? `${b.year}-${b.month}-${b.day}` : "?"}:${input.gender}`);
}

/**
 * LLM 없이 만드는 운세.
 *
 * 키가 없을 때만 쓰는 임시 문구가 아니다 — 파티 당일 외부 서비스가 느리거나 죽어도
 * **이 화면은 반드시 뜬다.** 그래서 이쪽 문장도 읽을 만해야 한다.
 */
export function fallbackFortune(input: FortuneInput, now: number, lines: FallbackLines): Fortune {
  const seed = fortuneSeed(input);
  return {
    headline: lines.headline[seed % lines.headline.length],
    body: lines.body[(seed >> 2) % lines.body.length],
    mission: lines.mission[(seed >> 5) % lines.mission.length],
    color: pickColor(seed),
    at: now,
    fallback: true,
  };
}

/** 어필도 규칙 문구가 있다. 운세만 뜨고 어필 칸이 비면 화면이 반쯤 죽은 것처럼 보인다 */
export function fallbackAppeal(input: AppealInput, lines: AppealFallbackLines): Appeal {
  const seed = seedOf(input.charms.join("/"));
  return {
    headline: lines.headline[seed % lines.headline.length],
    tips: input.charms.map((charm, i) => lines.tip(charm, (seed >> (i * 3)) % 3)),
  };
}

/** 문구는 `copy.ts` 에서 넘겨받는다. 이 파일에는 한국어를 두지 않는다 */
export interface FallbackLines {
  headline: readonly string[];
  body: readonly string[];
  mission: readonly string[];
}

export interface AppealFallbackLines {
  headline: readonly string[];
  /** 본인이 쓴 매력을 그대로 안아 쓴다. 남이 지어준 말보다 잘 맞는다 */
  tip: (charm: string, variant: number) => string;
}

/**
 * 저장돼 있던 운세를 지금 모양으로 읽는다.
 *
 * 저장된 자료는 코드보다 오래 산다 — '오늘의 한 걸음'(`step`)이 '오늘의 미션'(`mission`)이 됐을 때
 * 이미 저장된 운세가 그대로 올라오면 미션 칸이 빈다. 기본값 NaN 사고와 같은 자리다.
 */
export function readFortune(saved: unknown): Fortune {
  const { step, ...rest } = saved as Fortune & { step?: string };
  return { ...rest, mission: rest.mission || step || "" };
}

/**
 * 문단을 나눈다. 빈 줄이 문단 경계다 — 모델이 한 문단만 줘도 그대로 한 덩어리로 그린다.
 */
export function paragraphs(body: string): string[] {
  return body.split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean);
}

/**
 * LLM 응답을 읽는다. 모델이 무엇을 뱉든 **화면에 들어갈 수 있는 모양**만 통과시킨다.
 * 하나라도 비면 통째로 버리고 규칙 문구를 쓴다 — 반쯤 채워진 운세가 제일 이상하다.
 */
export function parseFortune(raw: string, input: FortuneInput, now: number): Fortune | null {
  const text = raw.trim().replace(/^```(?:json)?/, "").replace(/```$/, "");
  let data: { headline?: unknown; body?: unknown; mission?: unknown; step?: unknown };
  try {
    data = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch {
    return null;
  }
  const str = (v: unknown, max: number) =>
    typeof v === "string" && v.trim().length > 0 && v.length <= max ? v.trim() : null;

  const headline = str(data.headline, 60);
  // 3~5문단 자유 길이 — 다섯 문단이 넉넉히 들어가는 크기까지
  const body = str(data.body, 2600);
  // 이름을 바꾸기 전 모델이 `step` 으로 답하는 일이 있다. 뜻이 같으면 받아준다
  const mission = str(data.mission, 160) ?? str(data.step, 160);
  if (!headline || !body || !mission) return null;

  return { headline, body, mission, color: pickColor(fortuneSeed(input)), at: now };
}

/**
 * 어필 응답을 읽는다. 팁은 **매력 개수만큼** 와야 한다 —
 * 두 개만 오면 어느 매력이 빠진 건지 화면에서 알 수 없다. 그럴 바엔 규칙 문구가 낫다.
 */
export function parseAppeal(raw: string, input: AppealInput): Appeal | null {
  const text = raw.trim().replace(/^```(?:json)?/, "").replace(/```$/, "");
  let data: { headline?: unknown; tips?: unknown };
  try {
    data = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch {
    return null;
  }
  const str = (v: unknown, max: number) =>
    typeof v === "string" && v.trim().length > 0 && v.length <= max ? v.trim() : null;

  const headline = str(data.headline, 60);
  const tips = Array.isArray(data.tips) ? data.tips.map((t) => str(t, 200)) : [];
  if (!headline || tips.length !== input.charms.length || tips.some((t) => !t)) return null;
  return { headline, tips: tips as string[] };
}
