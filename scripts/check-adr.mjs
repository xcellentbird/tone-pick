/**
 * ADR 문서가 지켜야 하는 것들을 기계가 본다.
 *
 * 이 문서의 일은 **"바꾸기 전에 왜 이런지 찾아본다"** 인데, 65개 4000줄이 되면서
 * 사람 눈으로는 안 되는 게 다섯 생겼다.
 *
 *  1. **번호 겹침** — 브랜치 둘이 나란히 "다음 번호"를 집으면 난다. 지금까지 **일곱 번** 났다.
 *     늘 파일 끝에 붙어서 git 이 충돌로 잡아주지만, 손으로 옮기다 빠뜨리면 여기서 걸린다
 *  2. **번호 구멍** — 지운 ADR 이 있다는 뜻이다. 뒤집힌 결정도 **기록으로 남긴다**(문서 머리)
 *  3. **끊어진 참조** — 코드가 `ADR-N` 을 **1500번** 가리킨다. 번호를 옮기면서 하나라도
 *     흘리면 주석이 엉뚱한 결정을 가리키는데, **그건 틀린 문서보다 나쁘다**
 *  4. **목차가 본문과 어긋남** — 목차가 거짓말을 하면 안 보느니만 못하다
 *  5. **뒤집힌 ADR 에 표시가 없음** — 목차는 제목을 옮겨 올 뿐이라, 뒤의 ADR 이 "ADR-N 을 뒤집는다"
 *     고 적어도 ADR-N 제목에 표시가 없으면 목차에는 **살아 있는 결정**으로 남는다. 2026-09 에
 *     열 개가 그렇게 남아 있었고, 시나리오가 폐기된 ADR-14 를 근거로 들고 있었다
 *
 *   node scripts/check-adr.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";

const DOC = new URL("../docs/ADR.md", import.meta.url);
const md = readFileSync(DOC, "utf8");
const fail = [];

/* ── 본문의 ADR 들 */
const entries = [...md.matchAll(/^## ADR-(\d+) (.*)$/gm)].map((m) => ({
  n: Number(m[1]),
  title: m[2].trim(),
}));
if (!entries.length) fail.push("ADR 을 하나도 못 찾았다 — 검사 자체가 헛돌고 있다");

/* ① 번호가 겹치지 않는가 */
const seen = new Map();
for (const e of entries) {
  if (seen.has(e.n)) fail.push(`ADR-${e.n} 이 둘이다 — 번호 충돌을 손으로 옮기다 만 것이다`);
  else seen.set(e.n, e);
}

/* ② 번호에 구멍이 없는가 */
const max = Math.max(...entries.map((e) => e.n));
const holes = [];
for (let i = 1; i <= max; i++) if (!seen.has(i)) holes.push(i);
if (holes.length) fail.push(`번호에 구멍: ${holes.join(", ")} — 뒤집힌 결정도 기록으로 남긴다`);

/* ③ 오름차순인가 — 번호가 곧 시간이다 */
for (let i = 1; i < entries.length; i++) {
  if (entries[i].n < entries[i - 1].n) {
    fail.push(`ADR-${entries[i].n} 이 ADR-${entries[i - 1].n} 뒤에 있다 — 번호는 시간 순이다`);
    break;
  }
}

/* ④ 목차가 본문과 같은가 */
const START = "<!-- 목차 시작 -->";
const END = "<!-- 목차 끝 -->";
const want = entries.map((e) => `- **ADR-${e.n}** ${e.title}`).join("\n");
const a = md.indexOf(START);
const b = md.indexOf(END);
if (a < 0 || b < 0) {
  fail.push(`목차 표시(${START} … ${END})가 없다`);
} else {
  const got = md.slice(a + START.length, b).trim();
  if (got !== want) {
    fail.push("목차가 본문과 다르다 — 아래를 목차 자리에 그대로 넣어라:\n\n" + want + "\n");
  }
}

/* ⑤ 뒤집힌 ADR 제목에 뒤집은 쪽 번호가 적혀 있는가
 *
 * "ADR-M 이 ADR-N 을 뒤집는다" 를 **평서형 동사**로만 잡는다 — `뒤집는 게 아니라`·`되돌리는 셈이다`
 * 처럼 검토하고 버린 선택지는 잡지 않는다. 표의 `**폐기** (ADR-K 에서 실행)` 도 실행한 쪽이 K 라 뺀다.
 * 잡는 모양: `ADR-N(·N2)( ①)( 과 ADR-N3)( 의 …) 을/를 뒤집는다·폐기한다·걷어낸다·되돌린다`,
 *           `(ADR-N) 를 뒤집는다`, `(ADR-N 일부 뒤집음)`, 걸리는 ADR 표의 `| ADR-N | **뒤집는다/폐기`.
 * 문장이 못 잡는 뒤집힘도 있다(ADR-39→35 처럼 "일정을 뗐다") — 그건 제목 표시가 유일한 기록이다.
 */
const VERB = String.raw`(?:뒤집는다|뒤집음|뒤집고|폐기한다|폐기하고|걷어낸다|걷어내고|되돌린다|되돌리고)`;
const REVERSES = [
  new RegExp(String.raw`ADR-(\d+)((?:·\d+)*)(?:\s*[①②③])?(?:\s*(?:과|와)\s*ADR-(\d+))?(?:\s*의\s+[^|\n]{0,30}?)?\s*(?:을|를)\s*\**\s*` + VERB, "g"),
  new RegExp(String.raw`\(ADR-(\d+)()()\)\S*\s*(?:을|를)\s*` + VERB, "g"),
  /\(ADR-(\d+)()() 일부 뒤집음\)/g,
  /^\|\s*\**ADR-(\d+)()()\**[^|]*\|\s*\**(?:뒤집는다|폐기)(?![*.]*\s*\(ADR-\d+ 에서)/gm,
];
const heads = [...md.matchAll(/^## ADR-(\d+) /gm)];
heads.forEach((h, i) => {
  const m = Number(h[1]);
  const body = md.slice(h.index, i + 1 < heads.length ? heads[i + 1].index : md.length);
  for (const re of REVERSES) {
    for (const x of body.matchAll(re)) {
      const ns = [Number(x[1]), ...(x[2] ? x[2].split("·").filter(Boolean).map(Number) : []), ...(x[3] ? [Number(x[3])] : [])];
      for (const n of ns) {
        if (n >= m || !seen.has(n)) continue;
        if (!new RegExp(`ADR-${m}(?!\\d)`).test(seen.get(n).title)) {
          fail.push(`ADR-${m} 이 ADR-${n} 을 뒤집는데("${x[0].slice(0, 40)}") ADR-${n} 제목에 (ADR-${m}) 표시가 없다`);
        }
      }
    }
  }
});

/* ⑥ 어딘가에서 가리키는 ADR 번호가 전부 있는가 */
const walk = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = `${dir}/${f}`;
    if (f === "node_modules" || f === "dist" || f.startsWith(".")) return [];
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|css|md|mjs|html)$/.test(f) ? [p] : [];
  });
const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const files = [...walk(`${root}/src`), ...walk(`${root}/test`), ...walk(`${root}/docs`),
               `${root}/CLAUDE.md`, `${root}/README.md`];
let refs = 0;
for (const f of files) {
  readFileSync(f, "utf8").split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/ADR-(\d+)/g)) {
      refs++;
      const n = Number(m[1]);
      if (!seen.has(n)) fail.push(`${f.slice(root.length + 1)}:${i + 1} 이 없는 ADR-${n} 을 가리킨다`);
    }
  });
}

if (fail.length) {
  console.error("❌ ADR 문서가 어긋났다\n" + fail.map((f) => `   · ${f}`).join("\n"));
  process.exit(1);
}
console.log(`✅ ADR 이상 없음 — ${entries.length}개 · 참조 ${refs}회 · 목차 일치`);
