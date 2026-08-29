/**
 * 링크 미리보기(Open Graph) 태그.
 *
 * **왜 워커가 끼어드나** — 미리보기를 만드는 건 카톡 서버이고 그 크롤러는 JS 를 안 돌린다.
 * 그래서 태그가 정적 HTML 에 있어야 하는데, 카카오는 `og:image`·`og:url` 에
 * **절대 https 주소**를 요구한다. 상대경로는 안 받는다.
 *
 * **왜 주소를 코드에 안 박나** — 저장소가 계정 서브도메인을 일부러 가려놨고
 * (`README.md` 의 `<계정>`), 프로덕션·QA·나중의 커스텀 도메인이 전부 다르다.
 * **요청이 온 주소에서 꺼내면** 셋 다 저절로 맞는다.
 *
 * ⚠️ **요청 URL 을 그대로 쓰지 마라. 거기엔 토큰이 있다** (ADR-32).
 *    `origin` 만 쓴다 — 카드는 채팅에 남고 화면 캡처에도 찍힌다.
 */
import { LINK_PREVIEW } from "../shared/copy.ts";

/**
 * 태그 값에 들어가는 문자열. 따옴표가 새면 태그가 깨진다.
 *
 * ⚠️ **정규식을 쓰지 마라.** `check:copy` 는 정규식 리터럴을 못 읽어서 그 안의 따옴표를
 * 문자열 시작으로 본다 — 한 번 어긋나면 그 뒤의 한국어 주석이 전부 "하드코딩된 문구" 로 잡힌다.
 */
const ESCAPE: Record<string, string> = {
  "&": "&amp;",
  '"': "&quot;",
  "<": "&lt;",
  ">": "&gt;",
};

function attr(s: string): string {
  let out = "";
  for (const ch of s) out += ESCAPE[ch] ?? ch;
  return out;
}

/** `origin` 하나만 받는다 — 경로도 토큰도 안 들어온다 */
function ogTags(origin: string): string {
  const t = attr(LINK_PREVIEW.title);
  const d = attr(LINK_PREVIEW.description);
  const img = `${attr(origin)}/og.jpg`;
  return (
    `<meta property="og:type" content="website">` +
    `<meta property="og:site_name" content="${t}">` +
    `<meta property="og:title" content="${t}">` +
    `<meta property="og:description" content="${d}">` +
    `<meta property="og:url" content="${attr(origin)}/">` +
    `<meta property="og:image" content="${img}">` +
    `<meta property="og:image:width" content="1200">` +
    `<meta property="og:image:height" content="630">` +
    `<meta name="twitter:card" content="summary_large_image">` +
    `<meta name="twitter:title" content="${t}">` +
    `<meta name="twitter:description" content="${d}">` +
    `<meta name="twitter:image" content="${img}">`
  );
}

/**
 * **밖으로 내보내는 건 이것 하나뿐이다.**
 *
 * 요청 URL 을 통째로 받아 **여기서 origin 만 남긴다.** 토큰을 버리는 일이 이 함수 안에
 * 있어야 하는 이유가 그것이다 — 부르는 쪽이 origin 을 직접 만들게 두면, 언젠가 누가
 * `c.req.url` 을 그대로 넘긴다. 그런 경로를 아예 만들지 않는다.
 *
 * `</head>` 가 없으면 **손대지 않고 그대로 돌려준다.**
 */
export function withOgFor(html: string, requestUrl: string): string {
  const at = html.indexOf("</head>");
  if (at < 0) return html;
  // 경로도 질의문자열도 여기서 버려진다. 남는 건 scheme + host 뿐이다
  const origin = new URL(requestUrl).origin;
  return html.slice(0, at) + ogTags(origin) + html.slice(at);
}
