/**
 * 오늘의 연애운 (ADR-20).
 *
 * 재미로 붙인 기능이지만 규칙은 세 가지고, 셋 다 어기면 사고다.
 *   ① LLM 에 실명·전화번호·인스타를 보내지 않는다
 *   ② 한 번 연 운세는 바뀌지 않는다
 *   ③ 외부 서비스가 없어도 화면은 뜬다
 */
import { describe, expect, it } from "vitest";
import {
  fallbackFortune,
  fortuneInput,
  matchTypes,
  parseFortune,
  pickColor,
  seedOf,
} from "../src/shared/fortune.ts";
import { FORTUNE } from "../src/shared/copy.ts";
import { canOpenFortune } from "../src/shared/phase.ts";
import type { Player } from "../src/shared/types.ts";

const PLAYER: Player = {
  id: "p1",
  nickname: "달빛",
  realName: "김실명",
  age: 29,
  gender: "F",
  phone: "01012345678",
  instagram: "secret_gram",
  mbti: "INFP",
  charms: ["요리를 잘해요", "잘 웃어요", "노래를 좋아해요"],
  createdAt: 1,
};

describe("LLM 에 보내는 것", () => {
  it("★ 실명·전화번호·인스타는 보내지 않는다", () => {
    const input = fortuneInput(PLAYER);
    const sent = JSON.stringify(input) + FORTUNE.prompt.user(input);

    expect(sent).not.toContain("김실명");
    expect(sent).not.toContain("01012345678");
    expect(sent).not.toContain("secret_gram");
    for (const leak of ["realName", "phone", "instagram", "id"]) {
      expect(Object.keys(input)).not.toContain(leak);
    }
  });

  it("보내는 건 이미 다른 참가자에게도 보이는 것들뿐이다", () => {
    // roster 로 나가는 PublicPlayer 와 같은 범위다
    expect(Object.keys(fortuneInput(PLAYER)).sort()).toEqual(
      ["age", "charms", "gender", "mbti", "nickname"],
    );
  });

  it("점수를 매기지 말라고 모델에게 못 박는다", () => {
    // '연애운 34점' 은 이 앱이 없애려던 경험을 앱이 직접 만드는 일이다
    expect(FORTUNE.prompt.system).toContain("점수");
    expect(FORTUNE.prompt.system).toContain("외모");
  });
});

describe("한 번 연 운세는 바뀌지 않는다", () => {
  it("★ 같은 사람에게는 언제나 같은 색과 같은 결이 나온다", () => {
    const a = fallbackFortune(fortuneInput(PLAYER), 1, FORTUNE.fallback);
    const b = fallbackFortune(fortuneInput(PLAYER), 999, FORTUNE.fallback);
    expect(b.headline).toBe(a.headline);
    expect(b.color).toBe(a.color);
    expect(b.step).toBe(a.step);
  });

  it("사람이 다르면 다르게 나온다", () => {
    const seeds = ["달빛", "노을", "바다", "구름", "서리"].map((n) => seedOf(`${n}:INFP`));
    expect(new Set(seeds).size).toBe(seeds.length);
  });

  it("색은 언제나 테마에 있는 것만 나온다 — 어떤 결과에도 화면이 깨지지 않는다", () => {
    for (let i = 0; i < 200; i++) {
      expect(Object.keys(FORTUNE.colorName)).toContain(pickColor(i));
    }
  });
});

describe("외부 서비스가 없어도", () => {
  it("★ 규칙 문구만으로 화면에 들어갈 것이 다 채워진다", () => {
    const f = fallbackFortune(fortuneInput(PLAYER), 1, FORTUNE.fallback);
    expect(f.headline.length).toBeGreaterThan(0);
    expect(f.body.length).toBeGreaterThan(0);
    expect(f.step.length).toBeGreaterThan(0);
    expect(f.matchTypes).toHaveLength(2);
    expect(f.fallback).toBe(true);
    // 본인이 쓴 매력을 그대로 안아 쓴다. 남이 지어준 말보다 잘 맞는다
    expect(PLAYER.charms.some((c) => f.body.includes(c))).toBe(true);
  });

  it("매력이 비어 있어도 문장이 만들어진다", () => {
    const f = fallbackFortune({ ...fortuneInput(PLAYER), charms: [] }, 1, FORTUNE.fallback);
    expect(f.body.length).toBeGreaterThan(0);
  });
});

describe("모델이 뱉은 것을 읽을 때", () => {
  const input = fortuneInput(PLAYER);

  it("코드 블록으로 감싸 와도 읽는다", () => {
    const raw = '```json\n{"headline":"천천히 걷는 밤","body":"오늘은 이런 날이에요.","step":"뭐 좋아하세요?"}\n```';
    expect(parseFortune(raw, input, 1)?.headline).toBe("천천히 걷는 밤");
  });

  it("★ 하나라도 비면 통째로 버린다 — 반쯤 채워진 운세가 제일 이상하다", () => {
    for (const raw of [
      '{"headline":"","body":"b","step":"s"}',
      '{"headline":"h","body":"b"}',
      "그냥 아무 말",
      "",
      `{"headline":"${"긴".repeat(100)}","body":"b","step":"s"}`,
    ]) {
      expect(parseFortune(raw, input, 1)).toBeNull();
    }
  });

  it("모델이 뭘 넣어 보내든 화면에 들어가는 항목만 통과한다", () => {
    const raw = '{"headline":"h","body":"b","step":"s","score":92,"color":"#ff0000"}';
    const f = parseFortune(raw, input, 1)!;
    expect(Object.keys(f).sort()).toEqual(["at", "body", "color", "headline", "matchTypes", "step"]);
    expect(Object.keys(FORTUNE.colorName)).toContain(f.color);
  });
});

describe("언제 열리나", () => {
  it("★ 파티가 시작돼야 열린다", () => {
    expect(canOpenFortune("prep")).toBe(false);
    expect(canOpenFortune("reg")).toBe(false);
    expect(canOpenFortune("prevote")).toBe(false);
    expect(canOpenFortune("party")).toBe(true);
    // 발표가 끝났다고 오늘 하루의 것이 사라질 이유는 없다
    expect(canOpenFortune("done")).toBe(true);
  });
});

describe("말이 잘 통할 결", () => {
  it("에너지는 반대, 보는 방식은 같게 고른다", () => {
    const [a, b] = matchTypes("INFP");
    expect(a[0]).toBe("E");
    expect(b[0]).toBe("E");
    expect(a[1]).toBe("N");
    expect(b[1]).toBe("N");
  });

  it("이상한 값이 와도 MBTI 모양을 돌려준다", () => {
    for (const bad of ["", "XXXX", "ENFPP", "1234"]) {
      for (const t of matchTypes(bad)) expect(t).toMatch(/^[EI][NS][TF][JP]$/);
    }
  });
});
