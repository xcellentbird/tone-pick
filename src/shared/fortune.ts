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
 *    실명은 **오늘의 운세 기능(두 호출)에만** 예외로 들어간다 (ADR-20 개정).
 *    세 가지가 함께 지켜져야 한다.
 *      · 이 기능 밖으로 나가지 않는다 — 다른 어떤 기능에도 이름을 넘기지 마라
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
  color: FortuneColor;
  at: number;
  /**
   * 오늘의 미션. **참가자가 미션 카드를 뒤집을 때** 두 번째 호출로 만들어진다 (`missionInput`).
   *
   * 그래서 **없을 수 있다** — 운세만 열고 미션은 아직 안 연 상태다.
   * 한 번에 뽑던 시절에는 본문 마지막 문단을 그대로 옮겨 적는 일이 잦았다.
   * 다 읽고 나서 "그래서 뭘 하지" 를 따로 묻는 편이 겹치지 않고,
   * **안 열어 본 사람 몫은 아예 만들지 않는다.**
   */
  mission?: string;
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
  /** 파티가 열리는 지역의 오늘 날짜 (`2026-08-20`). 오늘을 읽는 운세라 오늘이 언제인지 알아야 한다 */
  today: string;
}

/**
 * 미션 호출에 보내는 값. **운세가 나온 뒤에** 부른다.
 *
 * 한 번에 뽑던 시절에는 미션이 본문 마지막 문단을 그대로 옮겨 적곤 했다 —
 * 운세를 다 읽고 나서 "그래서 오늘 뭘 하지" 를 따로 묻는 편이 겹치지 않는다.
 *
 * 사람을 아는 재료가 운세와 다르다. 운세는 사주(이름·생년월일·성별)를 보고,
 * 미션은 **오늘 이 자리에서 이 사람이 할 만한 일**을 찾아야 해서 닉네임·MBTI·매력이 온다.
 */
export interface MissionInput {
  realName: string;
  nickname: string;
  mbti: string;
  charms: string[];
  fortune: { headline: string; body: string };
}

/**
 * DO 를 거쳐 오면 튜플이 배열로 풀린다. 여기서 좁히지 말고 넓게 받는다 —
 * 이 함수가 하는 일은 **덜어내는 것**이지 모양을 맞추는 게 아니다.
 */
export function fortuneInput(
  p: { realName: string; gender: Gender },
  today: string,
  birth?: { year: number; month: number; day: number },
): FortuneInput {
  return {
    realName: p.realName,
    gender: p.gender,
    today,
    ...(birth ? { birth } : {}),
  };
}

/** 미션 호출에 보내는 값을 만든다. 운세를 다 읽은 뒤에 부른다 */
export function missionInput(
  p: { realName: string; nickname: string; mbti: string; charms: readonly string[] },
  fortune: { headline: string; body: string },
): MissionInput {
  return {
    realName: p.realName,
    nickname: p.nickname,
    mbti: p.mbti,
    charms: [...p.charms],
    fortune: { headline: fortune.headline, body: fortune.body },
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
export function fallbackFortune(input: FortuneInput, now: number, lines: FallbackLines): FortuneDraft {
  const seed = fortuneSeed(input);
  return {
    headline: lines.headline[seed % lines.headline.length],
    body: lines.body[(seed >> 2) % lines.body.length],
    color: pickColor(seed),
    at: now,
    fallback: true,
  };
}

/** 미션에도 규칙 문구가 있다. 운세만 뜨고 미션 칸이 비면 화면이 반쯤 죽은 것처럼 보인다 */
export function fallbackMission(input: MissionInput, lines: readonly string[]): string {
  return lines[seedOf(`${input.nickname}:${input.mbti}`) % lines.length];
}

/** 문구는 `copy.ts` 에서 넘겨받는다. 이 파일에는 한국어를 두지 않는다 */
export interface FallbackLines {
  headline: readonly string[];
  body: readonly string[];
}

/**
 * 운세 호출이 만드는 것. **미션은 여기 없다** — 두 번째 호출이 만든다.
 * 타입으로 갈라두면 한 호출에서 둘 다 뽑으려는 시도가 컴파일에서 막힌다.
 */
export type FortuneDraft = Omit<Fortune, "mission">;

/**
 * 저장돼 있던 운세를 지금 모양으로 읽는다.
 *
 * 저장된 자료는 코드보다 오래 산다 — '오늘의 한 걸음'(`step`)이 '오늘의 미션'(`mission`)이 됐을 때
 * 이미 저장된 운세가 그대로 올라오면 미션 칸이 빈다. 기본값 NaN 사고와 같은 자리다.
 */
export function readFortune(saved: unknown): Fortune {
  const { step, mission, ...rest } = saved as Fortune & { step?: string };
  const m = mission || step;
  // **없는 것과 빈 것을 뭉개지 않는다.** 빈 문자열로 채우면 "아직 안 연 미션" 이
  // "연 적 있는데 비어 있는 미션" 으로 읽혀 다시 만들 길이 막힌다
  return m ? { ...rest, mission: m } : rest;
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
export function parseFortune(raw: string, input: FortuneInput, now: number): FortuneDraft | null {
  const text = raw.trim().replace(/^```(?:json)?/, "").replace(/```$/, "");
  let data: { headline?: unknown; body?: unknown };
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
  if (!headline || !body) return null;

  return { headline, body, color: pickColor(fortuneSeed(input)), at: now };
}

/** 미션 응답. 한 문장이라 JSON 한 칸이면 된다 */
export function parseMission(raw: string): string | null {
  const text = raw.trim().replace(/^```(?:json)?/, "").replace(/```$/, "");
  try {
    const data = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as {
      mission?: unknown;
    };
    const m = data.mission;
    return typeof m === "string" && m.trim() && m.length <= 160 ? m.trim() : null;
  } catch {
    return null;
  }
}

