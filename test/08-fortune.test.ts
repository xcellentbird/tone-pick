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
  animalIndex,
  fallbackFortune,
  fortuneInput,
  matchTypes,
  paragraphs,
  parseFortune,
  pickColor,
  readFortune,
  seedOf,
  validBirth,
  zodiacIndex,
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

describe("생년월일", () => {
  const BIRTH = { year: 1996, month: 3, day: 14 };

  it("★ 프롬프트에는 실리지만 운세 결과에는 어디에도 남지 않는다", () => {
    const input = fortuneInput(PLAYER, BIRTH);
    // 보내는 쪽: 별자리·띠로 풀려 전송된다
    const sent = FORTUNE.prompt.user(input);
    expect(sent).toContain("1996년 3월 14일");
    expect(sent).toContain("물고기자리");
    expect(sent).toContain("쥐띠");
    // 남는 쪽: 폴백이든 LLM 파싱이든 결과 JSON 에 생년월일이 없다
    const kept = JSON.stringify(fallbackFortune(input, 1, FORTUNE.fallback));
    expect(kept).not.toContain("1996");
    expect(kept).not.toContain("birth");
    const parsed = parseFortune('{"headline":"h","body":"b","mission":"m"}', input, 1);
    expect(JSON.stringify(parsed)).not.toContain("1996");
  });

  it("별자리·띠 경계가 맞다", () => {
    expect(zodiacIndex(3, 20)).toBe(1); // 3/20 물고기
    expect(zodiacIndex(3, 21)).toBe(2); // 3/21 양
    expect(zodiacIndex(12, 25)).toBe(11); // 염소
    expect(zodiacIndex(1, 19)).toBe(11); // 1/19 도 염소
    expect(animalIndex(1996)).toBe(0); // 쥐
    expect(animalIndex(2000)).toBe(4); // 용
  });

  it("달력에 없는 날은 거른다", () => {
    expect(validBirth(1996, 3, 14)).toBe(true);
    expect(validBirth(1996, 2, 30)).toBe(false);
    expect(validBirth(1899, 1, 1)).toBe(false);
    expect(validBirth(1996, 13, 1)).toBe(false);
  });
});

describe("잘 통할 결의 이유 한 줄", () => {
  it("폴백에도 채워진다", () => {
    const f = fallbackFortune(fortuneInput(PLAYER), 1, FORTUNE.fallback);
    expect(f.matchNote).toBeTruthy();
  });

  it("★ 없어도 운세를 버리지 않는다 — 옛 저장본과 새 코드가 같이 산다", () => {
    const f = parseFortune('{"headline":"h","body":"b","mission":"m"}', fortuneInput(PLAYER), 1);
    expect(f).not.toBeNull();
    expect(f!.matchNote).toBeUndefined();
  });

  it("모델이 주면 다듬어 통과시킨다", () => {
    const raw = JSON.stringify({ headline: "h", body: "b", mission: "m", matchNote: " 이유 " });
    expect(parseFortune(raw, fortuneInput(PLAYER), 1)!.matchNote).toBe("이유");
  });
});

describe("한 번 연 운세는 바뀌지 않는다", () => {
  it("★ 같은 사람에게는 언제나 같은 색과 같은 결이 나온다", () => {
    const a = fallbackFortune(fortuneInput(PLAYER), 1, FORTUNE.fallback);
    const b = fallbackFortune(fortuneInput(PLAYER), 999, FORTUNE.fallback);
    expect(b.headline).toBe(a.headline);
    expect(b.color).toBe(a.color);
    expect(b.mission).toBe(a.mission);
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
    expect(f.mission.length).toBeGreaterThan(0);
    // 오늘의 기운은 세 문단이다
    expect(paragraphs(f.body)).toHaveLength(3);
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
    const raw = '```json\n{"headline":"천천히 걷는 밤","body":"오늘은 이런 날이에요.","mission":"이름을 물어보세요"}\n```';
    expect(parseFortune(raw, input, 1)?.headline).toBe("천천히 걷는 밤");
  });

  it("★ 하나라도 비면 통째로 버린다 — 반쯤 채워진 운세가 제일 이상하다", () => {
    for (const raw of [
      '{"headline":"","body":"b","mission":"m"}',
      '{"headline":"h","body":"b"}',
      "그냥 아무 말",
      "",
      `{"headline":"${"긴".repeat(100)}","body":"b","mission":"m"}`,
    ]) {
      expect(parseFortune(raw, input, 1)).toBeNull();
    }
  });

  it("모델이 뭘 넣어 보내든 화면에 들어가는 항목만 통과한다", () => {
    const raw = '{"headline":"h","body":"b","mission":"m","score":92,"color":"#ff0000"}';
    const f = parseFortune(raw, input, 1)!;
    expect(Object.keys(f).sort()).toEqual(["at", "body", "color", "headline", "matchTypes", "mission"]);
    expect(Object.keys(FORTUNE.colorName)).toContain(f.color);
  });
});

describe("저장된 옛 모양", () => {
  it("★ '오늘의 한 걸음' 시절에 저장된 운세도 미션 자리에 들어온다", () => {
    // 저장된 자료는 코드보다 오래 산다. 이름이 바뀌었다고 칸이 비면 안 된다
    const old = { headline: "h", body: "b", step: "옛 문구", color: "gold", matchTypes: ["ENFP", "ENTJ"], at: 1 };
    const f = readFortune(old);
    expect(f.mission).toBe("옛 문구");
    expect(Object.keys(f)).not.toContain("step");
  });
});

describe("문단 나누기", () => {
  it("빈 줄이 문단 경계다", () => {
    expect(paragraphs("하나\n\n둘\n\n셋")).toEqual(["하나", "둘", "셋"]);
    // 한 문단만 와도 그대로 한 덩어리로 그린다
    expect(paragraphs("한 덩어리")).toEqual(["한 덩어리"]);
    expect(paragraphs("  \n\n  ")).toEqual([]);
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
