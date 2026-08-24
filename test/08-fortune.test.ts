/**
 * 오늘의 연애운 (ADR-20).
 *
 * 재미로 붙인 기능이지만 규칙이 있고, 어기면 사고다.
 *   ① 전화번호·인스타는 어느 호출에도 보내지 않는다
 *   ② **실명은 오늘의 운세 기능(두 호출)에만** 예외로 들어간다 (ADR-20 개정).
 *      그 기능 밖으로 나가지 않고, 답변·저장물·화면 어디에도 남지 않는다
 *   ③ 한 번 연 운세는 바뀌지 않는다
 *   ④ 외부 서비스가 없어도 화면은 뜬다
 */
import { describe, expect, it } from "vitest";
import {
  animalIndex,
  fallbackFortune,
  fallbackMission,
  fortuneInput,
  missionInput,
  paragraphs,
  parseFortune,
  parseMission,
  pickColor,
  readFortune,
  seedOf,
  validBirth,
  zodiacIndex,
} from "../src/shared/fortune.ts";
import { FORTUNE, MISSION } from "../src/shared/copy.ts";
import { canOpenFortune } from "../src/shared/phase.ts";
import type { Player } from "../src/shared/types.ts";

const TODAY = "2026-08-20";

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
  contactShare: "all" as const,
  createdAt: 1,
};

describe("LLM 에 보내는 것", () => {
  const draft = () => fallbackFortune(fortuneInput(PLAYER, TODAY), 1, FORTUNE.fallback);

  it("★ 전화번호·인스타는 어느 호출에도 가지 않는다", () => {
    const f = fortuneInput(PLAYER, TODAY);
    const m = missionInput(PLAYER, draft());
    const sent = JSON.stringify(f) + FORTUNE.prompt.user(f) + JSON.stringify(m) + MISSION.prompt.user(m);

    expect(sent).not.toContain("01012345678");
    expect(sent).not.toContain("secret_gram");
    for (const input of [f, m]) {
      for (const leak of ["phone", "instagram", "id"]) {
        expect(Object.keys(input)).not.toContain(leak);
      }
    }
  });

  it("★ 이름을 답변에 쓰지 말라고 두 프롬프트 모두에 못 박는다", () => {
    // 답변에 이름이 나오면 저장물에도 화면에도 남는다 — 보내는 것보다 남는 게 무겁다
    expect(FORTUNE.prompt.system).toContain("이름을 쓰지 마세요");
    expect(MISSION.prompt.system).toContain("이름을 지어 부르지 마세요");
  });

  it("운세와 미션은 재료가 갈린다", () => {
    // 운세는 사주(이름·생년월일·성별·오늘), 미션은 사람(닉네임·MBTI·매력) + 방금 나온 운세
    expect(Object.keys(fortuneInput(PLAYER, TODAY)).sort()).toEqual(["gender", "realName", "today"]);
    expect(Object.keys(missionInput(PLAYER, draft())).sort())
      .toEqual(["charms", "fortune", "mbti", "nickname", "realName"]);
  });

  it("★ 오늘이 며칠인지 함께 보낸다", () => {
    // 오늘을 읽는 운세다. 오늘이 언제인지 모르면 아무 날의 이야기가 된다
    expect(FORTUNE.prompt.user(fortuneInput(PLAYER, TODAY))).toContain(TODAY);
  });

  it("★ 파티가 어떤 자리인지 두 프롬프트 모두 안다", () => {
    // 이걸 모르면 "좋은 인상을 남기세요" 같은 아무 데나 쓰는 말이 나온다
    for (const system of [FORTUNE.prompt.system, MISSION.prompt.system]) {
      expect(system).toContain("지인들의 파티");
      expect(system).toContain("이성을 만날 기회");
      expect(system).toContain("콕");
    }
  });

  it("점수를 매기지 말라고 두 곳 모두에 못 박는다", () => {
    for (const system of [FORTUNE.prompt.system, MISSION.prompt.system]) {
      expect(system).toContain("점수");
      expect(system).toContain("외모");
    }
  });
});

describe("생년월일", () => {
  const BIRTH = { year: 1996, month: 3, day: 14 };

  it("★ 프롬프트에는 실리지만 운세 결과에는 어디에도 남지 않는다", () => {
    const input = fortuneInput(PLAYER, TODAY, BIRTH);
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

describe("오늘의 미션", () => {
  const draft = () => fallbackFortune(fortuneInput(PLAYER, TODAY), 1, FORTUNE.fallback);

  it("★ 운세가 나온 뒤에 만든다 — 그 결과가 재료다", () => {
    /*
     * 한 호출에서 함께 뽑던 시절에는 미션이 본문 마지막 문단을 그대로 옮겨 적곤 했다.
     * 다 읽고 나서 "그래서 오늘 뭘 하지" 를 따로 물으면 겹치지 않는다.
     */
    const f = draft();
    const sent = MISSION.prompt.user(missionInput(PLAYER, f));
    expect(sent).toContain(f.headline);
    expect(sent).toContain(f.body);
  });

  it("★ 운세 호출은 미션을 만들지 않는다", () => {
    // 타입으로 갈라뒀다 — 한 호출에서 둘 다 뽑으려는 시도가 컴파일에서 막힌다
    const parsed = parseFortune('{"headline":"h","body":"b","mission":"m"}', fortuneInput(PLAYER, TODAY), 1);
    expect(Object.keys(parsed!)).not.toContain("mission");
  });

  it("본문을 그대로 옮겨 적지 말라고 못 박는다", () => {
    expect(MISSION.prompt.system).toContain("그대로 옮겨 적지 마세요");
  });

  it("모델이 뭘 뱉든 쓸 수 있는 것만 통과시킨다", () => {
    expect(parseMission('{"lead":" 오늘은 그런 날 ","mission":" 이름을 물어보세요 "}')).toEqual({
      lead: "오늘은 그런 날",
      mission: "이름을 물어보세요",
    });
    expect(parseMission('{"mission":""}')).toBeNull();
    expect(parseMission("그냥 문장")).toBeNull();
  });

  it("★ 이유가 빠져도 미션은 버리지 않는다", () => {
    /*
     * `lead` 한 줄이 없다고 쓸 만한 미션을 통째로 규칙 문구로 바꾸면 손해가 더 크다.
     * **없는 것과 빈 것을 뭉개지도 않는다** — 키 자체가 없어야 화면이 한 줄로 그린다.
     */
    const only = parseMission('{"mission":"이름을 물어보세요"}');
    expect(only?.mission).toBe("이름을 물어보세요");
    expect(only).not.toHaveProperty("lead");
    expect(parseMission('{"lead":"","mission":"이름을 물어보세요"}')).not.toHaveProperty("lead");
  });

  it("★ 미션 문장에는 **언제** 가 들어간다", () => {
    /*
     * 누구에게·무엇을 만 정해주면 미룬다. 언제 할지가 문장에 있어야 그 순간에 떠오른다.
     * 다만 시계 시간은 아니다 — 상황으로 적는다.
     */
    expect(MISSION.prompt.system).toContain("언제 할지를 문장에 넣습니다");
    for (const f of MISSION.fallback) {
      expect(f.mission, f.mission).toMatch(/때|직후|직전/);
    }
  });

  it("★ 이유는 시키지 않는다 — 시키는 건 미션 한 문장뿐이다", () => {
    // 이유까지 지시가 되면 한 카드에 숙제가 둘이 된다. 그리고 다짐을 받아내는 앱이 아니다
    expect(MISSION.prompt.system).toContain("시키지 마세요");
    for (const f of MISSION.fallback) {
      expect(f.lead, f.lead).not.toMatch(/꼭|반드시|해야|하세요|해보세요/);
    }
  });

  it("★ 외부 서비스가 없어도 미션은 두 칸 다 채워진다", () => {
    // 규칙 문구만 한 줄이면 키가 없는 날에는 화면 모양이 달라진다 — 그게 곧 신호가 된다
    const m = fallbackMission(missionInput(PLAYER, draft()), MISSION.fallback);
    expect(m.mission.length).toBeGreaterThan(0);
    expect(m.lead.length).toBeGreaterThan(0);
  });
});

describe("한 번 연 운세는 바뀌지 않는다", () => {
  it("★ 같은 사람에게는 언제나 같은 색과 같은 결이 나온다", () => {
    const a = fallbackFortune(fortuneInput(PLAYER, TODAY), 1, FORTUNE.fallback);
    const b = fallbackFortune(fortuneInput(PLAYER, TODAY), 999, FORTUNE.fallback);
    expect(b.headline).toBe(a.headline);
    expect(b.color).toBe(a.color);
    // 미션도 마찬가지다 — 두 번째 호출이 만들지만 규칙 문구는 같은 씨앗을 쓴다
    const m = (t: number) => fallbackMission(missionInput(PLAYER, fallbackFortune(fortuneInput(PLAYER, TODAY), t, FORTUNE.fallback)), MISSION.fallback);
    expect(m(999)).toEqual(m(1));
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
    const f = fallbackFortune(fortuneInput(PLAYER, TODAY), 1, FORTUNE.fallback);
    expect(f.headline.length).toBeGreaterThan(0);
    // 오늘의 기운은 세 문단이다
    expect(paragraphs(f.body)).toHaveLength(3);
    expect(f.fallback).toBe(true);
  });

  it("생년월일이 없어도 문장이 만들어진다", () => {
    // 운세 입력은 이름·성별뿐일 수도 있다. 그때도 화면은 떠야 한다
    const f = fallbackFortune(fortuneInput(PLAYER, TODAY), 1, FORTUNE.fallback);
    expect(f.body.length).toBeGreaterThan(0);
    expect(f.headline.length).toBeGreaterThan(0);
  });
});

describe("모델이 뱉은 것을 읽을 때", () => {
  const input = fortuneInput(PLAYER, TODAY);

  it("코드 블록으로 감싸 와도 읽는다", () => {
    const raw = '```json\n{"headline":"천천히 걷는 밤","body":"오늘은 이런 날이에요.","mission":"이름을 물어보세요"}\n```';
    expect(parseFortune(raw, input, 1)?.headline).toBe("천천히 걷는 밤");
  });

  it("★ 하나라도 비면 통째로 버린다 — 반쯤 채워진 운세가 제일 이상하다", () => {
    for (const raw of [
      '{"headline":"","body":"b"}',
      '{"headline":"h"}',
      "그냥 아무 말",
      "",
      `{"headline":"${"긴".repeat(100)}","body":"b"}`,
    ]) {
      expect(parseFortune(raw, input, 1)).toBeNull();
    }
  });

  it("모델이 뭘 넣어 보내든 화면에 들어가는 항목만 통과한다", () => {
    const raw = '{"headline":"h","body":"b","mission":"m","score":92,"color":"#ff0000"}';
    const f = parseFortune(raw, input, 1)!;
    // 모델이 미션을 끼워 보내도 받지 않는다 — 미션은 두 번째 호출의 것이다
    expect(Object.keys(f).sort()).toEqual(["at", "body", "color", "headline"]);
    expect(Object.keys(FORTUNE.colorName)).toContain(f.color);
  });
});

describe("저장된 운세를 읽는 자리", () => {
  /*
   * 읽는 곳을 하나로 둔다. 지금은 1.0.0 이 쓴 모양만 들어 있어 할 일이 없지만,
   * 다음에 모양이 바뀌면 고칠 곳이 여기 하나다.
   * ('오늘의 한 걸음'(`step`)이 '오늘의 미션'이 됐을 때 여기가 그 일을 했고,
   *  그 자료는 1.0.0 기준선에서 사라졌다.)
   */
  it("★ 아직 안 연 미션과 빈 미션을 뭉개지 않는다", () => {
    // 빈 문자열로 채우면 "안 열었다" 가 "열었는데 비었다" 로 읽혀 다시 만들 길이 막힌다
    expect(readFortune({ headline: "h", body: "b", color: "gold", at: 1 })).not.toHaveProperty("mission");
    expect(readFortune({ headline: "h", body: "b", color: "gold", at: 1, mission: "" })).not.toHaveProperty("mission");
    expect(readFortune({ headline: "h", body: "b", color: "gold", at: 1, mission: "한 줄" }).mission).toBe("한 줄");
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
