/**
 * `copy.ts` 의 화면 문구가 **평소 쓰는 한국어**인지, 기계가 볼 수 있는 부분만 본다 (ADR-89).
 *
 * 사람이 지키는 규칙은 CLAUDE.md 의 「문구는 이렇게 쓴다」다. 여기서는 그중 규칙으로 잡히는 둘만 —
 *
 *   1. 가운뎃점으로 낱말 셋 이상을 잇는 것        일정·순서·환경을 묻는
 *   2. 비유로 끝나는 문장                          ~하는 자리예요 · ~의 몫입니다
 *
 * 둘 다 문서(ADR·시나리오)에서는 자연스럽지만 화면에 오면 번역투가 된다.
 * LLM 프롬프트는 화면 문구가 아니다 — `korean-ok-start` ~ `korean-ok-end` 사이는 건너뛴다.
 * 한 줄만 빼려면 그 줄이나 바로 윗줄에 `korean-ok` 를 적는다 (`check-copy` 의 `copy-ok` 와 같다).
 *
 *   node scripts/check-korean.mjs
 */
import { readFileSync } from "node:fs";
import { scan } from "./lib/scan.mjs";

const FILE = new URL("../src/shared/copy.ts", import.meta.url);
const KOREAN = /[가-힣]/;

const RULES = [
  {
    name: "가운뎃점으로 낱말 셋 이상을 이었다",
    hint: "쉼표나 '이나' 로 잇거나, 문장으로 풀어 쓴다",
    test: /[가-힣A-Za-z0-9]+·[가-힣A-Za-z0-9]+·[가-힣A-Za-z0-9]+/,
  },
  {
    name: "비유로 끝났다",
    hint: "무엇을 하면 되는지 그대로 쓴다",
    test: /[가-힣]+(하는|되는|묻는|여는|쓰는|보는|하던|할)\s?자리(예요|에요|이에요|입니다|죠|네요)|몫(이에요|입니다|이죠|이다)/,
  },
];

const text = readFileSync(FILE, "utf8");
const lines = text.split("\n");

/** `korean-ok-start` ~ `korean-ok-end` 사이인가 (줄 번호는 1부터) */
const skipped = new Set();
let inside = false;
lines.forEach((l, i) => {
  if (l.includes("korean-ok-start")) inside = true;
  if (inside) skipped.add(i + 1);
  if (l.includes("korean-ok-end")) inside = false;
});
const exempt = (ln) => skipped.has(ln) || [lines[ln - 1], lines[ln - 2]].some((l) => l && l.includes("korean-ok"));

const hits = [];
for (const s of scan(text).strings) {
  if (!KOREAN.test(s.text) || exempt(s.line)) continue;
  for (const rule of RULES) {
    if (rule.test.test(s.text)) hits.push({ line: s.line, rule, text: s.text.trim() });
  }
}

if (!hits.length) {
  console.log("✅ 화면 문구에 번역투 없음 — 가운뎃점 나열 · 비유");
  process.exit(0);
}

console.error(`❌ 화면 문구에 번역투가 있습니다 (${hits.length}건)\n`);
for (const h of hits) {
  const preview = h.text.length > 60 ? h.text.slice(0, 60) + "…" : h.text;
  console.error(`  src/shared/copy.ts:${h.line}  [${h.rule.name}]  ${preview}`);
  console.error(`      → ${h.rule.hint}`);
}
console.error("\n→ CLAUDE.md 의 「문구는 이렇게 쓴다」를 보세요. LLM 프롬프트면 korean-ok-start ~ korean-ok-end 로 감쌉니다.");
process.exit(1);
