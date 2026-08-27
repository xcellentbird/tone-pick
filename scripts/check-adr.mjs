/**
 * ADR 문서가 지켜야 하는 것들을 기계가 본다.
 *
 * 이 문서의 일은 **"바꾸기 전에 왜 이런지 찾아본다"** 인데, 65개 4000줄이 되면서
 * 사람 눈으로는 안 되는 게 넷 생겼다.
 *
 *  1. **번호 겹침** — 브랜치 둘이 나란히 "다음 번호"를 집으면 난다. 지금까지 **일곱 번** 났다.
 *     늘 파일 끝에 붙어서 git 이 충돌로 잡아주지만, 손으로 옮기다 빠뜨리면 여기서 걸린다
 *  2. **번호 구멍** — 지운 ADR 이 있다는 뜻이다. 뒤집힌 결정도 **기록으로 남긴다**(문서 머리)
 *  3. **끊어진 참조** — 코드가 `ADR-N` 을 **1500번** 가리킨다. 번호를 옮기면서 하나라도
 *     흘리면 주석이 엉뚱한 결정을 가리키는데, **그건 틀린 문서보다 나쁘다**
 *  4. **목차가 본문과 어긋남** — 목차가 거짓말을 하면 안 보느니만 못하다
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

/* ⑤ 어딘가에서 가리키는 ADR 번호가 전부 있는가 */
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
