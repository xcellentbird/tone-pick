/**
 * 테마가 화면 밖으로 새는 자리를 기계가 본다.
 *
 * 셋 다 **조용히 어긋나는** 종류다 — 화면은 멀쩡히 뜨고 테스트도 통과한다.
 *  1. **`index.html` 의 인라인 색** — 번들이 안 붙었을 때를 위한 자리라 변수를 못 쓴다.
 *     그래서 `theme.css` 의 토큰이 바뀌면 여기만 옛 색으로 남는다. 실제로 셋 다 어긋나 있었다
 *  2. **컴포넌트에 박힌 글자 크기** — 스타일시트 밖에 있으면 스케일을 셀 수가 없다
 *  3. **싣지 않는 폰트 이름** — 스택에 적힌 이름은 "우리는 이걸 쓴다" 는 약속이다.
 *     `Pretendard` 가 한동안 적혀 있었지만 어디서도 싣지 않아 한 번도 그려진 적이 없다
 *
 *   node scripts/check-theme.mjs
 */
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/client/styles/theme.css", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const fail = [];

/** :root 의 토큰 값을 읽는다 */
const token = (name) => {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`));
  if (!m) fail.push(`theme.css 에 --${name} 토큰이 없다`);
  return m?.[1].toLowerCase();
};

/* ① index.html 의 인라인 색이 토큰과 같은가 */
for (const [what, pattern, name] of [
  ["theme-color 메타", /content="(#[0-9a-fA-F]{3,8})"/, "bg"],
  ["첫 프레임 바탕", /html \{ background: (#[0-9a-fA-F]{3,8})/, "bg"],
  ["대체 화면 바탕", /background:(#[0-9a-fA-F]{3,8});color:/, "bg"],
  ["새로고침 버튼", /background:(#[0-9a-fA-F]{3,8});color:#fff/, "accent"],
  ["대체 화면 글자", /;color:(#[0-9a-fA-F]{3,8});font-family:/, "fg"],
  ["대체 화면 흐린 글씨", /font-size:12px;color:(#[0-9a-fA-F]{3,8})/, "dim"],
]) {
  const found = html.match(pattern)?.[1]?.toLowerCase();
  const want = token(name);
  if (!found) fail.push(`index.html 에서 ${what} 색을 못 찾았다 — 검사 자체가 헛돌고 있다`);
  else if (found !== want) fail.push(`index.html ${what} ${found} ≠ --${name} ${want}`);
}

/* ② 컴포넌트에 인라인으로 박힌 글자 크기 */
import { readdirSync, statSync } from "node:fs";
const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = `${dir}/${f}`;
  return statSync(p).isDirectory() ? walk(p) : p.endsWith(".tsx") ? [p] : [];
});
for (const file of walk(new URL("../src/client", import.meta.url).pathname)) {
  const src = readFileSync(file, "utf8");
  src.split("\n").forEach((line, i) => {
    if (/fontSize\s*:/.test(line)) {
      fail.push(`${file.split("/src/")[1]}:${i + 1} 에 인라인 fontSize — theme.css 로 옮겨라`);
    }
  });
}

/*
 * ④ 스켈레톤 로고가 `.joinLogo` 와 같은 크기·자리인가.
 *
 * `index.html` 의 스켈레톤은 CSS 보다 **먼저** 그려지는 자리라 클래스도 변수도 못 쓴다.
 * 그래서 `.joinLogo` 의 값을 손으로 베껴 두는데, 어긋나면 React 가 올라오는 순간
 * **로고가 튄다** (ADR-70). 주석으로만 경고해 뒀더니 세 번 연달아 어긋났다 —
 * 로고를 40px 내리고 8% 줄이는 동안 스켈레톤은 옛 값 그대로였다.
 *
 * `var(--logo-drop)` 은 값으로 풀어서 비교한다. 스켈레톤은 그 변수를 읽을 수 없어
 * 거기엔 늘 풀어 쓴 숫자가 적힌다.
 */
const drop = css.match(/--logo-drop:\s*([^;]+);/)?.[1]?.trim();
if (!drop) fail.push("theme.css 에 --logo-drop 이 없다 — 검사가 헛돈다");
const flat = (v) => v.replace(/var\(--logo-drop\)/g, drop ?? "").replace(/\s+/g, "");
// 주석을 걷고 본다 — `.joinLogo` 는 선언 사이에 설명이 끼어 있어 그대로는 못 읽는다
const joinLogo = (css.match(/\.joinLogo\s*\{([^}]*)\}/)?.[1] ?? "").replace(/\/\*[\s\S]*?\*\//g, ";");
const skel = html.match(/id="tpSkeleton"[\s\S]*?<img[^>]*style="([^"]*)"/)?.[1] ?? "";
for (const [what, re] of [
  ["폭", /(?:^|;)\s*width:\s*([^;]+)/],
  ["윗 여백", /(?:^|;)\s*margin:\s*([^;]+)/],
]) {
  // 견주는 건 공백을 지운 값이지만, 보여주는 건 적힌 그대로다
  const want = (joinLogo.match(re)?.[1] ?? "").trim();
  const got = (skel.match(re)?.[1] ?? "").trim();
  if (!want || !got) fail.push(`로고 ${what} 를 못 찾았다 — 검사 자체가 헛돌고 있다`);
  else if (flat(want) !== flat(got)) {
    fail.push(`스켈레톤 로고 ${what} \`${got}\` ≠ .joinLogo \`${want}\` — React 가 뜨는 순간 튄다`);
  }
}

/*
 * ⑤ 스켈레톤이 선 상자가 `.body` 와 같은가.
 *
 * 로고의 `width`·`margin` 이 똑같아도 **담긴 상자의 안 여백이 다르면 자리가 다르다.**
 * `%` 도 `margin` 도 부모의 콘텐츠 상자를 기준으로 재기 때문이다.
 * 실제로 스켈레톤은 위 여백이 `0` 이고 `.body` 는 `var(--pad)` 라, 글자 하나 안 틀리고도
 * 로고가 **16px 튀었다.** 옆·아래는 이미 같은 값을 손으로 적어 뒀다.
 */
const padTop = html.match(/id="tpSkeleton"[\s\S]*?padding:\s*([^\s;]+)/)?.[1];
const pad = css.match(/--pad:\s*([^;]+);/)?.[1]?.trim();
if (!padTop || !pad) fail.push("스켈레톤 위 여백이나 --pad 를 못 찾았다 — 검사가 헛돈다");
else if (padTop !== pad) {
  fail.push(`스켈레톤 위 여백 ${padTop} ≠ --pad ${pad} — .body 와 상자가 달라 로고가 튄다`);
}

/* ③ 싣지 않는 폰트를 스택에 적었는가 */
const stack = css.match(/font-family:\s*(-apple-system[^;]*);/)?.[1] ?? "";
const named = [...stack.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
// 기기가 이미 가진 것만 허용한다. 여기 없는 이름을 적으려면 싣는 코드가 먼저다
const SYSTEM = new Set(["Apple SD Gothic Neo", "Segoe UI", "Helvetica Neue", "Noto Sans KR"]);
const loaded = /@font-face/.test(css) || /fonts\.(googleapis|gstatic)/.test(html);
for (const f of named) {
  if (!SYSTEM.has(f) && !loaded) fail.push(`font-family 에 "${f}" 를 적었지만 어디서도 싣지 않는다`);
}

if (fail.length) {
  console.error("❌ 테마가 어긋났다\n" + fail.map((f) => `   · ${f}`).join("\n"));
  process.exit(1);
}
console.log("✅ 테마 이상 없음 — index.html 색 · 인라인 크기 · 폰트 스택");
