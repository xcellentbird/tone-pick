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

/**
 * 브라우저가 첫 화면을 위해 받는 것만. `_headers` 는 Cloudflare 설정이라 아무도 안 받는다.
 *
 * **이미지도 센다.** 한동안 `html|js|css` 뿐이었는데, 그때는 이미지가 하나도 없어서
 * 문제가 안 됐다 — 회차 확인 화면에 로고가 붙는 순간 **41 KiB 가 래칫 밖으로 샜다.**
 * 참가자가 처음 만나는 화면에 실리는 것이라 주석이 말하는 "첫 화면까지 받아야 하는 것"
 * 그 자체다. 자산이 이미 압축돼 있어 gzip 으로 더 줄지 않는 것도 세야 할 이유다.
 */
const COUNTED = /\.(html|js|css|webp|avif|png|jpe?g|svg|woff2?)$/;

/**
 * **참가자가 안 받는 것.** 세는 자가 재는 건 "첫 화면까지 받아야 하는 것" 이므로,
 * 크롤러나 홈 화면만 가져가는 자산까지 넣으면 숫자가 뜻을 잃는다.
 *
 *   og.jpg              카톡·슬랙 크롤러만 가져간다. 브라우저는 한 번도 안 받는다
 *   apple-touch-icon    홈 화면에 추가할 때만 받는다
 *
 * `favicon.png` 는 **뺀 목록에 없다** — 브라우저가 첫 화면에서 실제로 받는다.
 */
const NOT_DOWNLOADED = /(^|\/)(og\.jpg|apple-touch-icon\.png)$/;

/**
 * **글자체는 따로 센다** (ADR-72).
 *
 * SUIT 두 굵기가 331 KiB 다. 이걸 아래 총합에 얹으면 예산이 200 → 530 이 되는데,
 * 그러면 **그 숫자가 뜻을 잃는다** — 이미지 한 장이 더 들어와도 330 KiB 의 여유 안에
 * 조용히 숨는다. 로고가 래칫 밖으로 샜던 것과 정확히 같은 사고가 반대 방향으로 난다.
 *
 * 그리고 글자체는 **첫 그림을 막지 않는다** — `font-display: swap` 이고 preload 하지
 * 않는다. 아래 총합이 재는 "첫 화면까지 받아야 하는 것" 에 애초에 해당하지 않는다.
 *
 * 그래도 **세기는 센다.** 파티장 와이파이를 쓰는 건 마찬가지라서다.
 * 굵기를 하나 더하면(163 KiB) 여기서 걸린다 — 그때 그 값을 다시 묻게 하려는 값이다.
 */
const FONTS = /(^|\/)fonts\//;
const FONT_BUDGET = 340 * 1024;

/**
 * 총합 예산(gzip 바이트). **글자체는 여기 없다** (바로 위).
 *
 * 2026-08-28 기준 실측 185.0 KiB (js 135.8 · 로고 41.5 · css 5.5 · html 2.2).
 *
 * **로고가 들어오면서 143 → 185 로 올랐다.** 세는 범위에 이미지를 더한 것과 같은 변경이라,
 * 이 줄이 diff 에 남는 것이 그 장치의 목적이다 (모르는 새 넘어가는 것과 알고 넘기는 것을 가른다).
 * 8% 남겨 잡았다 — 문구·화면을 더하는 보통 작업은 안 걸리고, **이미지가 한 장 더 들어오면
 * 걸린다.** 그때 다시 "이게 첫 화면에 있어야 하는가" 를 묻게 하려는 값이다.
 */
const BUDGET = 200 * 1024;

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
  files = walk(DIST).filter((f) => COUNTED.test(f) && !NOT_DOWNLOADED.test(f));
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

const kib = (n) => `${(n / 1024).toFixed(1)} KiB`;
const sum = (list) => list.reduce((s, r) => s + r.gz, 0);

const groups = [
  { label: "첫 화면", rows: rows.filter((r) => !FONTS.test(r.name)), budget: BUDGET, name: "BUDGET" },
  { label: "글자체", rows: rows.filter((r) => FONTS.test(r.name)), budget: FONT_BUDGET, name: "FONT_BUDGET" },
];

const over = [];
for (const g of groups) {
  if (g.rows.length === 0) continue;
  console.log(`\n  [${g.label}]`);
  for (const r of g.rows) console.log(`  ${kib(r.gz).padStart(10)}  ${r.name}`);
  const total = sum(g.rows);
  console.log(`  ${"─".repeat(10)}`);
  console.log(`  ${kib(total).padStart(10)}  합계 (예산 ${kib(g.budget)}, ${Math.round((total / g.budget) * 100)}%)`);
  if (total > g.budget) over.push({ ...g, total });
}

if (over.length > 0) {
  for (const g of over) {
    console.error(
      `\n✗ ${g.label} 이 예산을 ${kib(g.total - g.budget)} 넘었다.\n` +
        `  줄이거나, 정당한 증가라면 scripts/check-bundle.mjs 의 ${g.name} 을 올려라 — 그 줄이 diff 에 남아야 한다.`,
    );
  }
  process.exit(1);
}

console.log("\n✓ 번들 예산 안");
