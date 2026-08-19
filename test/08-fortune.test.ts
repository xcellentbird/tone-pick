/**
 * 오늘의 연애운 (ADR-20).
 *
 * 재미로 붙인 기능이지만 규칙이 있고, 어기면 사고다.
 *   ① 전화번호·인스타는 어느 호출에도 보내지 않는다
 *   ② **실명은 운세 호출 하나에만** 예외로 들어간다 (ADR-20 개정).
 *      어필 호출에는 없고, 답변·저장물·화면 어디에도 남지 않는다
 *   ③ 한 번 연 운세는 바뀌지 않는다
 *   ④ 외부 서비스가 없어도 화면은 뜬다
 */
import { describe, expect, it } from "vitest";
import {
  animalIndex,
  appealInput,
  fallbackAppeal,
  fallbackFortune,
  fortuneInput,
  paragraphs,
  parseAppeal,
  parseFortune,
  pickColor,
  readFortune,
  seedOf,
  validBirth,
  zodiacIndex,
} from "../src/shared/fortune.ts";
import { APPEAL, FORTUNE } from "../src/shared/copy.ts";
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
  it("★ 전화번호·인스타는 어느 호출에도 가지 않는다", () => {
    const f = fortuneInput(PLAYER);
    const a = appealInput(PLAYER, fallbackFortune(f, 1, FORTUNE.fallback));
    const sent = JSON.stringify(f) + FORTUNE.prompt.user(f) + JSON.stringify(a) + APPEAL.prompt.user(a);

    expect(sent).not.toContain("01012345678");
    expect(sent).not.toContain("secret_gram");
    for (const input of [f, a]) {
      for (const leak of ["phone", "instagram", "id"]) {
        expect(Object.keys(input)).not.toContain(leak);
      }
    }
  });

  it("★ 실명은 운세 호출에만 간다 — 어필 호출에는 자리가 없다", () => {
    /*
     * 예외는 하나뿐이라야 예외다. 어필까지 이름을 받기 시작하면
     * "어디까지 보내도 되나" 의 경계가 사라진다 (ADR-20 개정).
     */
    const f = fortuneInput(PLAYER);
    expect(FORTUNE.prompt.user(f)).toContain("김실명");

    const a = appealInput(PLAYER, fallbackFortune(f, 1, FORTUNE.fallback));
    expect(JSON.stringify(a) + APPEAL.prompt.user(a)).not.toContain("김실명");
    expect(Object.keys(a)).not.toContain("realName");
  });

  it("★ 이름을 답변에 쓰지 말라고 모델에게 못 박는다", () => {
    // 답변에 이름이 나오면 저장물에도 화면에도 남는다 — 보내는 것보다 남는 게 무겁다
    expect(FORTUNE.prompt.system).toContain("이름을 쓰지 마세요");
    expect(APPEAL.prompt.system).toContain("이름을 지어 부르지 마세요");
  });

  it("운세와 어필은 재료가 갈린다", () => {
    // 운세는 사주(이름·생년월일·성별), 어필은 사람(나이·성별·매력) + 방금 나온 운세
    expect(Object.keys(fortuneInput(PLAYER)).sort()).toEqual(["gender", "realName"]);
    expect(Object.keys(appealInput(PLAYER, fallbackFortune(fortuneInput(PLAYER), 1, FORTUNE.fallback))).sort())
      .toEqual(["age", "charms", "fortune", "gender"]);
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

describe("오늘의 어필", () => {
  const fortuneOf = () => fallbackFortune(fortuneInput(PLAYER), 1, FORTUNE.fallback);

  it("★ 운세 결과를 재료로 받는다 — 두 카드가 서로를 모르면 남남인 글이 된다", () => {
    const f = fortuneOf();
    const sent = APPEAL.prompt.user(appealInput(PLAYER, f));
    expect(sent).toContain(f.headline);
    expect(sent).toContain(f.mission);
  });

  it("★ 파티가 어떤 자리인지 모델에게 알려준다", () => {
    // 이 셋을 모르면 "좋은 인상을 남기세요" 같은 아무 데나 쓰는 말이 나온다
    expect(APPEAL.prompt.system).toContain("지인들의 파티");
    expect(APPEAL.prompt.system).toContain("이성을 만날 기회");
    expect(APPEAL.prompt.system).toContain("콕");
  });

  it("팁은 매력 개수만큼 온다 — 모자라면 통째로 버린다", () => {
    const input = appealInput(PLAYER, fortuneOf());
    const ok = parseAppeal('{"headline":"h","tips":["a","b","c"]}', input);
    expect(ok!.tips).toEqual(["a", "b", "c"]);
    // 두 개만 오면 어느 매력이 빠진 건지 화면에서 알 수 없다
    expect(parseAppeal('{"headline":"h","tips":["a","b"]}', input)).toBeNull();
    expect(parseAppeal('{"headline":"h"}', input)).toBeNull();
  });

  it("★ 외부 서비스가 없어도 매력마다 한 줄씩 채워진다", () => {
    const input = appealInput(PLAYER, fortuneOf());
    const a = fallbackAppeal(input, APPEAL.fallback);
    expect(a.headline).toBeTruthy();
    expect(a.tips).toHaveLength(PLAYER.charms.length);
    // 본인이 쓴 매력을 그대로 안아 쓴다 — 남이 지어준 말보다 잘 맞는다
    for (const [i, charm] of PLAYER.charms.entries()) expect(a.tips[i]).toContain(charm);
  });

  it("점수를 매기지 말라고 여기에도 못 박는다", () => {
    expect(APPEAL.prompt.system).toContain("점수");
    expect(APPEAL.prompt.system).toContain("외모");
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
    expect(f.fallback).toBe(true);
  });

  it("생년월일이 없어도 문장이 만들어진다", () => {
    // 운세 입력은 이름·성별뿐일 수도 있다. 그때도 화면은 떠야 한다
    const f = fallbackFortune(fortuneInput(PLAYER), 1, FORTUNE.fallback);
    expect(f.body.length).toBeGreaterThan(0);
    expect(f.headline.length).toBeGreaterThan(0);
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
    expect(Object.keys(f).sort()).toEqual(["at", "body", "color", "headline", "mission"]);
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
