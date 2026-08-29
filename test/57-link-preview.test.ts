/**
 * 링크 미리보기 — 카톡에 붙는 카드.
 *
 * 참가자가 이 앱을 처음 만나는 자리는 회차 확인 화면이 **아니라** 이 카드다.
 * 운영자가 1:1 로 보낸 링크를 카톡 서버가 긁어서 만든다 (ADR-32).
 *
 * 여기서 지키는 것은 하나다 — **링크에 든 토큰이 카드로 새면 안 된다.**
 * 카드는 채팅에 남고 화면 캡처에도 찍힌다. 토큰이 곧 신원이므로,
 * 새는 순간 그 캡처를 본 사람이 그 참가자가 된다.
 *
 * ⚠️ **`SELF.fetch` 로 재지 않는다.** 그러려면 `ASSETS` 가 `dist/client` 를 내야 하는데,
 * CI 는 `npm test` 를 `npm run build` **보다 먼저** 돌려서 거기엔 `dist` 가 없다.
 * 그래서 토큰을 버리는 일을 순수 함수 안에 두고 그 함수를 직접 잰다 —
 * 라우트는 그 함수를 부르기만 하고, origin 을 만드는 경로가 아예 없다.
 */
import { describe, expect, it } from "vitest";
import { withOgFor } from "../src/server/og.ts";
import { LINK_PREVIEW } from "../src/shared/copy.ts";

const ORIGIN = "https://party.example.com";
const TOKEN = "tok-SECRET-MUST-NOT-LEAK";
const LINK = `${ORIGIN}/j/e1/${TOKEN}?utm=kakao`;
const HTML = `<!doctype html><html><head><title>x</title></head><body>hi</body></html>`;

const head = (html: string) => html.slice(0, html.indexOf("</head>"));

describe("링크 미리보기", () => {
  it("★ 토큰이 카드에 새지 않는다", async () => {
    const out = withOgFor(HTML, LINK);
    // 태그가 실제로 붙었다 — 안 붙었으면 아래 단언이 아무것도 안 재게 된다
    expect(out).toContain('property="og:image"');
    expect(out).not.toContain(TOKEN);
    // 경로도 질의문자열도 통째로 버려진다
    expect(out).not.toContain("/j/e1");
    expect(out).not.toContain("utm=kakao");
  });

  it("★ 그림 주소는 요청이 온 곳의 절대 https 주소다", async () => {
    // 카카오는 상대경로를 안 받는다. 그리고 주소를 코드에 박으면 QA·커스텀 도메인이 어긋난다
    expect(withOgFor(HTML, LINK)).toContain(`content="${ORIGIN}/og.jpg"`);
    expect(withOgFor(HTML, "https://tone-pick-qa.example.workers.dev/j/e9/t"))
      .toContain('content="https://tone-pick-qa.example.workers.dev/og.jpg"');
  });

  it("★ 카드에는 회차를 알 수 있는 것이 없다", async () => {
    /*
     * 크롤러가 JS 를 안 돌려서 어차피 회차를 못 읽지만, 그게 **맞는 설계**라는 걸 못 박는다.
     * 누군가 서버에서 회차를 읽어 카드에 넣고 싶어지면 이 테스트가 먼저 막는다.
     */
    const tags = head(withOgFor(HTML, LINK));
    expect(tags).toContain(LINK_PREVIEW.title);
    expect(tags).toContain(LINK_PREVIEW.description);
    expect(tags).not.toContain("e1");
  });

  it("★ 넣을 자리가 없으면 손대지 않는다", async () => {
    // 문이 막히면 안 된다. 미리보기는 없어도 되지만 참가자가 못 들어오는 건 다른 문제다
    const noHead = "<html><body>hi</body></html>";
    expect(withOgFor(noHead, LINK)).toBe(noHead);
  });
});
