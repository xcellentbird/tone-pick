/**
 * 슬라이스 26 — 참가자 목록의 순서 (ADR-73)
 *
 * 규칙은 셋이다. **발표 후엔 서로 찌른 사람만 위**, 그 전엔 **같은 테이블만 위**,
 * 자리가 없으면 **보는 사람마다 고정된 무작위**. 화면 테스트가 앞 둘을 보고,
 * 여기는 무작위가 *어떤* 무작위인지를 본다 — 새로고침에 안 바뀌고, 새 사람이 남을 안 민다.
 */
import { describe, expect, it } from "vitest";
import { orderRoster } from "../src/shared/roster.ts";
import type { PublicPlayer } from "../src/shared/types.ts";

const p = (id: string): PublicPlayer => ({ id, nickname: id, gender: "F", charms: ["a", "b", "c"] });
const ids = (list: PublicPlayer[]) => list.map((x) => x.id);
const ten = "abcdefghij".split("").map(p);

describe("참가자 목록의 순서", () => {
  it("★ 같은 사람이 보면 언제나 같은 순서다 — 새로고침이 목록을 섞지 않는다", () => {
    const a = ids(orderRoster(ten, { viewerId: "me" }));
    const b = ids(orderRoster([...ten].reverse(), { viewerId: "me" }));
    expect(a).toEqual(b);
  });

  it("★ 등록 순서가 아니다 — 처음 온 사람이 늘 맨 위가 아니다", () => {
    // 열 명 중 어느 한 사람에게라도 순서가 뒤집혀야 무작위다 (전부 그대로면 정렬이 없는 것이다)
    const viewers = ["v1", "v2", "v3", "v4", "v5"];
    const changed = viewers.some((v) => ids(orderRoster(ten, { viewerId: v })).join("") !== "abcdefghij");
    expect(changed).toBe(true);
  });

  it("★ 새로 등록한 사람은 끼어들 뿐, 남들의 상대 순서를 바꾸지 않는다", () => {
    const before = ids(orderRoster(ten, { viewerId: "me" }));
    const after = ids(orderRoster([...ten, p("new")], { viewerId: "me" })).filter((id) => id !== "new");
    expect(after).toEqual(before);
  });

  it("★ 같은 테이블이 위, 그 안과 밖의 순서는 무작위 그대로다", () => {
    const base = ids(orderRoster(ten, { viewerId: "me" }));
    const got = ids(orderRoster(ten, { viewerId: "me", mateIds: ["c", "h"] }));
    expect(got.slice(0, 2)).toEqual(base.filter((id) => id === "c" || id === "h"));
    expect(got.slice(2)).toEqual(base.filter((id) => id !== "c" && id !== "h"));
  });

  it("★ 서로 찌른 사람이 같은 테이블보다 위다", () => {
    const got = ids(orderRoster(ten, { viewerId: "me", mateIds: ["c", "h"], matchedIds: ["j"] }));
    expect(got[0]).toBe("j");
    expect(got.slice(1, 3).sort()).toEqual(["c", "h"]);
  });
});
