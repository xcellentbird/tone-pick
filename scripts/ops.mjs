/**
 * 운영 카운터를 읽는다.
 *
 *   node scripts/ops.mjs            # 프로덕션, 최근 24시간
 *   node scripts/ops.mjs qa 72      # 연습용, 최근 72시간
 *
 * 쌓는 쪽은 `src/server/metrics.ts` 다. **거기 적힌 경계를 읽고 나서** 이 파일을 늘려라 —
 * 운영 카운터는 넣고 결과 통계(매칭·콕·순위)는 넣지 않는다.
 *
 * 토큰은 `.env` 의 `CLOUDFLARE_API_TOKEN` 을 쓴다. `Account Analytics Read` 권한이 있어야 한다.
 *
 * ⚠️ **바로 안 보인다.** 쌓인 뒤 조회에 걸리기까지 몇 분이 든다 (실측: 4건이 다 나오는 데 ~5분).
 * 파티 중에 실시간으로 지켜보는 도구가 아니다 — 그건 `wrangler tail` 이다.
 * 이건 **끝나고 돌아보는** 도구다.
 */
import fs from "node:fs";

const env = Object.fromEntries(
  fs
    .readFileSync(".env", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const WHICH = process.argv[2] === "qa" ? "qa" : "prod";
const HOURS = Number(process.argv[3] ?? 24);
const DATASET = WHICH === "qa" ? "tone_pick_ops_qa" : "tone_pick_ops";

async function sql(query) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/analytics_engine/sql`,
    { method: "POST", headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` }, body: query },
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text).data ?? [];
}

/*
 * `_sample_interval` 을 곱해야 실제 건수가 된다. Analytics Engine 은 양이 많아지면
 * 표본만 저장하고, 그 한 건이 몇 건을 대표하는지를 이 값에 담는다.
 * 그냥 세면 조용히 적게 나온다 — 지표가 거짓말하는 가장 흔한 방식이다.
 */
const rows = await sql(`
  SELECT blob1 AS kind, blob2 AS outcome, SUM(_sample_interval) AS n
  FROM ${DATASET}
  WHERE timestamp > NOW() - INTERVAL '${HOURS}' HOUR
  GROUP BY kind, outcome
  ORDER BY kind, n DESC
`);

console.log(`\n${WHICH} · 최근 ${HOURS}시간\n`);
if (rows.length === 0) {
  console.log("  아직 쌓인 게 없습니다.");
  console.log("  (배포 직후라면 참가자가 입장하거나 운세를 열어야 첫 건이 생깁니다)\n");
  process.exit(0);
}

const by = {};
for (const r of rows) (by[r.kind] ??= []).push(r);

const LABEL = {
  enter: "입장 시도",
  fortune: "오늘의 운세",
};
const OUTCOME = {
  ok: "통과",
  not_invited: "명단에 없음",
  too_many: "시도 초과",
  bad_phone: "번호 형식",
  llm: "LLM",
  fallback: "규칙 문구",
};

for (const [kind, list] of Object.entries(by)) {
  const total = list.reduce((a, r) => a + Number(r.n), 0);
  console.log(`  ${LABEL[kind] ?? kind}  (${total}건)`);
  for (const r of list) {
    const n = Number(r.n);
    const pct = ((n / total) * 100).toFixed(0);
    console.log(`    ${(OUTCOME[r.outcome] ?? r.outcome).padEnd(12)} ${String(n).padStart(5)}  ${pct}%`);
  }
  console.log();
}

/*
 * 눈으로 보고 넘어가기 쉬운 것만 한 줄로 짚는다. **문턱을 코드가 정하지 않는다** —
 * 회차마다 사정이 다르고, 기계가 "정상" 을 정하면 사람이 숫자를 안 보게 된다.
 */
const enter = by.enter ?? [];
const fail = enter.filter((r) => r.outcome !== "ok").reduce((a, r) => a + Number(r.n), 0);
const all = enter.reduce((a, r) => a + Number(r.n), 0);
if (all > 0 && fail > 0) {
  console.log(`  ⓘ 입장 시도 ${all}건 중 ${fail}건이 못 들어왔습니다 (${((fail / all) * 100).toFixed(0)}%).`);
  console.log(`    명단에 없는 번호이거나, 참가자가 다른 형식으로 넣고 있다는 뜻입니다.\n`);
}
const fb = (by.fortune ?? []).find((r) => r.outcome === "fallback");
if (fb) console.log(`  ⓘ 운세 ${fb.n}건이 규칙 문구로 나갔습니다. LLM 쪽을 확인해보세요.\n`);
