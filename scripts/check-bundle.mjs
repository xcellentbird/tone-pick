/**
 * 번들이 조용히 불어나는 것을 막는다.
 *
 * 이 앱이 열리는 자리가 **파티장 와이파이**다. `index.html` 이 "번들이 안 붙었을 때" 까지
 * 챙겨놓고(ADR-62 에서 웹폰트를 안 싣기로 한 것도 같은 이유다) 정작 번들 크기에는
 * 아무 눈금이 없었다 — 한 번에 100KB 가 늘어도 아무도 모른다.
 *
 * **한 줄이 아니라 총합을 본다.** 참가자가 첫 화면을 보기까지 받아야 하는 것 전부다.
 * 어느 파일이 불었는지는 실패했을 때 표가 말해준다.
 *
 * 재는 것은 **gzip** 이다. 실제로는 Cloudflare 가 brotli 로 더 줄여 보내므로 이 숫자는
 * 전송량 자체가 아니라 **흐름을 보는 자**다 — 같은 자로 재는 한 늘어난 건 늘어난 것이다.
 *
 * 예산은 **래칫**이다. 정당하게 넘겼으면 그 PR 에서 숫자를 올려라. 올리는 줄이 diff 에
 * 남는 것이 이 장치의 목적이다 — 모르는 새 넘어가는 것과 알고 넘기는 것을 가른다.
 *
 *   npm run build && npm run check:bundle
 */
import { gzipSync } from "node:zlib";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const DIST = join(ROOT, "dist/client");

/** 브라우저가 첫 화면을 위해 받는 것만. `_headers` 는 Cloudflare 설정이라 아무도 안 받는다 */
const COUNTED = /\.(html|js|css)$/;

/**
 * 총합 예산(gzip 바이트).
 *
 * 2026-08-27 기준 실측 143.0 KiB (js 135.7 · css 5.1 · html 2.2).
 * 12% 남겨 잡았다 — 문구·화면을 더하는 보통 작업은 안 걸리고,
 * 라이브러리나 폰트가 한 겹 들어오면 걸린다 (ADR-66).
 */
const BUDGET = 160 * 1024;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

let files;
try {
  files = walk(DIST).filter((f) => COUNTED.test(f));
} catch {
  console.error(`✗ ${relative(ROOT, DIST)} 가 없다. \`npm run build\` 를 먼저 돌려라.`);
  process.exit(1);
}

if (files.length === 0) {
  console.error(`✗ ${relative(ROOT, DIST)} 에 잴 것이 없다. 빌드가 반쯤 나온 것 아닌지 보라.`);
  process.exit(1);
}

const rows = files
  .map((f) => ({ name: relative(DIST, f), gz: gzipSync(readFileSync(f), { level: 9 }).length }))
  .sort((a, b) => b.gz - a.gz);

const total = rows.reduce((s, r) => s + r.gz, 0);
const kib = (n) => `${(n / 1024).toFixed(1)} KiB`;

for (const r of rows) console.log(`  ${kib(r.gz).padStart(10)}  ${r.name}`);
console.log(`  ${"─".repeat(10)}`);
console.log(`  ${kib(total).padStart(10)}  합계 (예산 ${kib(BUDGET)}, ${Math.round((total / BUDGET) * 100)}%)`);

if (total > BUDGET) {
  console.error(
    `\n✗ 번들이 예산을 ${kib(total - BUDGET)} 넘었다.\n` +
      `  줄이거나, 정당한 증가라면 scripts/check-bundle.mjs 의 BUDGET 을 올려라 — 그 줄이 diff 에 남아야 한다.`,
  );
  process.exit(1);
}

console.log("\n✓ 번들 예산 안");
