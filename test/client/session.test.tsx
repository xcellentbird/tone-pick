/**
 * 이 창이 누구인가 — 틀마다 다른 참가자 (ADR-99, ADR-44).
 *
 * 무대 워커는 한 탭에 참가자 여럿을 틀로 띄운다. 같은 출처 틀들은 `sessionStorage` 를 하나 같이 쓰므로,
 * 틀 이름(`tp.<이름표>`)이 없으면 마지막으로 들어온 사람이 모든 틀이 된다.
 * 그리고 **맨 위 창에서는 창 이름을 보지 않는다** — 평소의 탭은 전과 똑같아야 한다.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setTabRef, tabRef } from "../../src/client/lib/session.ts";

const store = new Map<string, string>();
const realTop = Object.getOwnPropertyDescriptor(window, "top");

/** 이 창을 틀 안에 넣는다. 부모는 누구든 상관없다 — 맨 위 창이 자기가 아니면 틀이다 */
function framed(name: string) {
  Object.defineProperty(window, "top", { configurable: true, get: () => ({}) });
  window.name = name;
}

beforeEach(() => {
  store.clear();
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
    },
  });
});

afterEach(() => {
  if (realTop) Object.defineProperty(window, "top", realTop);
  else delete (window as { top?: unknown }).top;
  window.name = "";
});

describe("이름표 — 틀마다 다른 참가자", () => {
  it("★ 틀 이름이 tp.<16진수> 면 그것이 이 틀의 이름표다 — 탭이 든 이름표보다 먼저", () => {
    setTabRef("aaaa1111");
    framed("tp.b2c3d4e5");
    expect(tabRef()).toBe("b2c3d4e5");
  });

  it("★ 맨 위 창은 창 이름을 보지 않는다 — 평소의 탭은 전과 같다", () => {
    window.name = "tp.b2c3d4e5";
    expect(window.top).toBe(window.self);
    expect(tabRef()).toBeUndefined();
    setTabRef("aaaa1111");
    expect(tabRef()).toBe("aaaa1111");
  });

  it("★ 16진수가 아니면 이름표가 아니다 — 쿠키 이름에 붙는 값이다", () => {
    setTabRef("aaaa1111");
    for (const name of ["tp.XYZ", "tp.ab;cd", "tp.", "ab12", "tp.0123456789abcdef0"]) {
      framed(name);
      expect(tabRef(), name).toBe("aaaa1111");
    }
  });

  it("이름표를 받은 틀에서는 누가 새로 들어와도 그 사람으로 남는다", () => {
    framed("tp.b2c3d4e5");
    setTabRef("ffff0000");
    expect(tabRef()).toBe("b2c3d4e5");
    // 같은 탭의 다른 틀(이름 없는 틀)이 읽는 자리도 건드리지 않았다
    expect(store.get("tp.ref")).toBeUndefined();
  });
});
