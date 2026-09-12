/**
 * 콕 이력을 CSV 로 뽑는다 — **운영자 전용** (ADR-82).
 *
 *   MASTER_PIN=**** node scripts/export-pokes.mjs https://tone-pick.<계정>.workers.dev <회차id>
 *   MASTER_PIN=**** node scripts/export-pokes.mjs https://tone-pick.<계정>.workers.dev          # 회차 목록
 *   node scripts/export-pokes.mjs <회차id>                     # 로컬 워커(127.0.0.1:8787), .dev.vars 의 MASTER_PIN
 *
 * 파일은 `tmp/` 에 떨어진다 — `.gitignore` 가 막는다. **누가 누구를 일방적으로 좋아했는지가 들어 있다.**
 * 저장소에도, 공유 폴더에도 두지 마라. 회차를 지워도 이 파일은 남는다 — 지우는 건 사람이 한다.
 *
 * 콘솔에 로그인한 브라우저에서 `/api/host/events/<회차id>/pokes.csv` 를 열어도 같은 파일이 내려온다.
 * 이 스크립트는 그 길을 터미널에서 쓰는 것뿐이다 — 앱에 다른 문은 없다.
 */
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const BASE = (args.find((a) => /^https?:\/\//.test(a)) ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const EVENT = args.find((a) => !/^https?:\/\//.test(a));
const LOCAL = /127\.0\.0\.1|localhost/.test(BASE);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function masterPin() {
  if (process.env.MASTER_PIN) return process.env.MASTER_PIN;
  if (!LOCAL) return "";
  try {
    const line = fs.readFileSync(path.join(ROOT, ".dev.vars"), "utf8").split("\n").find((l) => l.startsWith("MASTER_PIN="));
    return line ? line.slice("MASTER_PIN=".length).trim() : "";
  } catch {
    return "";
  }
}

const pin = masterPin();
if (!pin) {
  console.error("❌ 운영자 PIN 이 없습니다. 로컬은 .dev.vars 의 MASTER_PIN, 그 밖은 MASTER_PIN=**** 로 주세요.");
  process.exit(1);
}

const login = await fetch(`${BASE}/api/host/pin`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ pin }),
});
if (login.status !== 200) {
  console.error(`❌ 운영자 PIN 이 맞지 않습니다 (${login.status})`);
  process.exit(1);
}
const cookie = login.headers
  .getSetCookie()
  .map((c) => c.split(";")[0])
  .find((c) => c.startsWith("tp_host="));
if (!cookie) {
  console.error("❌ 운영자 세션 쿠키를 받지 못했습니다.");
  process.exit(1);
}
const headers = { cookie };

if (!EVENT) {
  const res = await fetch(`${BASE}/api/host/events`, { headers });
  const events = await res.json();
  console.log(`\n${BASE} 의 회차\n`);
  for (const e of events) console.log(`  ${e.id}  ${e.name}  (${e.phase} · ${e.playerCount}명)`);
  console.log("\n회차 아이디를 마지막 인자로 주면 그 회차의 콕 이력을 뽑습니다.\n");
  process.exit(0);
}

const res = await fetch(`${BASE}/api/host/events/${EVENT}/pokes.csv`, { headers });
if (res.status === 404) {
  console.error("❌ 그런 회차가 없어요.");
  process.exit(1);
}
if (res.status !== 200) {
  console.error(`❌ 받지 못했습니다 (${res.status}): ${(await res.text()).slice(0, 200)}`);
  process.exit(1);
}
const csv = await res.text();
const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 13).replace("T", "-");
const dir = path.join(ROOT, "tmp");
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `pokes-${EVENT}-${stamp}.csv`);
fs.writeFileSync(file, csv);
const lines = csv.split("\r\n").filter(Boolean).length - 1;
console.log(`✓ ${path.relative(ROOT, file)}  (콕 ${lines}줄)`);
console.log("  저장소에 커밋되지 않는 자리(tmp/)입니다. 다 보고 나면 지우세요 — 회차를 지워도 이 파일은 남습니다.");
