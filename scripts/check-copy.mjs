/**
 * 화면 문구가 src/shared/copy.ts 밖에 하드코딩됐는지 검사한다.
 *
 * CLAUDE.md 의 "문구를 새로 짓지 마라"를 사람이 눈으로 지키는 대신 기계가 지키게 하는 장치다.
 * 주석 안의 한국어는 통과시킨다 — 설명은 오히려 많을수록 좋다.
 *
 *   node scripts/check-copy.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { markedBy, scan } from "./lib/scan.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "src");
const ALLOW = ["src/shared/copy.ts"];
const KOREAN = /[가-힣]/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const hits = [];
for (const file of walk(SRC)) {
  const rel = relative(ROOT, file);
  if (ALLOW.includes(rel)) continue;
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  // 같은 줄이나 바로 윗줄에 `copy-ok` 가 있으면 건너뛴다 (SQL·정규식 등 화면 문구가 아닌 것)
  const exempt = markedBy(lines, "copy-ok");
  const { strings, code } = scan(src);
  for (const s of strings) {
    if (KOREAN.test(s.text) && !exempt(s.line)) hits.push({ rel, line: s.line, kind: "문자열", text: s.text.trim() });
  }
  for (const c of code) {
    // 주석과 문자열을 뺀 코드에 한국어가 남았다면 JSX 텍스트다
    if (KOREAN.test(c.text) && !exempt(c.line)) {
      const t = c.text.split("\n").find((l) => KOREAN.test(l)) ?? c.text;
      hits.push({ rel, line: c.line, kind: "JSX", text: t.trim() });
    }
  }
}

if (!hits.length) {
  console.log("✅ copy.ts 밖에 하드코딩된 문구 없음");
  process.exit(0);
}

console.error(`❌ copy.ts 밖에서 문구를 발견했습니다 (${hits.length}건)\n`);
for (const h of hits) {
  const preview = h.text.length > 60 ? h.text.slice(0, 60) + "…" : h.text;
  console.error(`  ${h.rel}:${h.line}  [${h.kind}]  ${preview}`);
}
console.error("\n→ src/shared/copy.ts 에 추가하고 거기서 가져다 쓰세요.");
process.exit(1);
