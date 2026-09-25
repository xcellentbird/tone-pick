/**
 * 테스트 하네스가 지켜야 하는 것을 기계가 본다.
 *
 *  1. **워커에 요청을 넣는 길은 `fetchApp` 하나다** (`test/helpers/app.ts`). `SELF.fetch` 를 쓰지 않는다.
 *     `@cloudflare/vitest-pool-workers` 의 `SELF` 는 요청마다 진입점 래퍼 클래스의 prototype 을 Proxy 로
 *     한 겹씩 더 감싼다 — N 번째 요청은 속성 하나를 찾으려고 N 겹을 지난다. 한 파일에서 요청이 쌓일수록
 *     요청 하나가 느려지고 파일 전체는 제곱으로 느려져서, `npm test` 가 73초 걸리던 것의 절반이 이것이었다.
 *     한 파일에만 되살아나도 그 파일이 다시 제곱으로 느려지고, 테스트는 초록이라 아무도 모른다.
 *
 *   node scripts/check-tests.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const TEST = join(ROOT, "test");

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const problems = [];
for (const path of files(TEST)) {
  readFileSync(path, "utf8")
    .split("\n")
    .forEach((line, i) => {
      // 주석은 통과한다 — 왜 안 쓰는지를 적는 자리가 있어야 한다
      const code = line.trim();
      if (code.startsWith("*") || code.startsWith("//") || code.startsWith("/*")) return;
      if (/\bSELF\b/.test(code)) {
        problems.push(`${relative(ROOT, path)}:${i + 1}  SELF 대신 fetchApp(test/helpers/app.ts)을 쓰세요`);
      }
    });
}

if (problems.length === 0) {
  console.log("✅ 테스트 하네스 이상 없음 — 워커 요청은 fetchApp 하나로");
  process.exit(0);
}
console.error(`❌ 테스트 하네스 문제 (${problems.length}건)\n`);
for (const p of problems) console.error(`  · ${p}`);
process.exit(1);
