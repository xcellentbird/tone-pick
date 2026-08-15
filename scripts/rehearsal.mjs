/**
 * 100명 리허설.  실제 파티 규모로 한 바퀴 돌려 무엇이 먼저 무너지는지 본다.
 *
 *   MASTER_PIN=**** node scripts/rehearsal.mjs https://tone-pick-qa.<계정>.workers.dev
 *
 * 재는 것
 *   · 동시 등록 — 회차 DO 는 요청을 순차 처리한다. 100명이 한꺼번에 오면 여기서 줄을 선다
 *   · 자리 배정 — 무료 플랜 요청당 CPU 10ms. 넘치면 500(1102)이 뜬다. 성패가 곧 답이다
 *   · 브로드캐스트 — 소켓 100개에 단계 전환이 몇 개나, 얼마나 빨리 닿나
 *
 * ⚠️ 연습용 환경에서만 돈다. 프로덕션이면 시작하지 않는다 (아래 guard).
 *    QA 에도 실제 사람의 전화번호를 넣지 마라 — 여기서 만드는 번호는 전부 가짜다.
 */
const BASE = process.argv[2]?.replace(/\/$/, "");
const PIN = process.env.MASTER_PIN;
const PEOPLE = Number(process.env.PEOPLE ?? 100);
const TABLES = Number(process.env.TABLES ?? 12);
/** 소켓을 붙이지 않고 돌려보면, 느린 게 요청 자체인지 브로드캐스트인지 갈린다 */
const SOCKETS = Number(process.env.SOCKETS ?? PEOPLE);
const WIDTH = Number(process.env.WIDTH ?? 25);
const KEEP = process.argv.includes("--keep");

if (!BASE || !PIN) {
  console.error("사용법: MASTER_PIN=**** node scripts/rehearsal.mjs <주소> [--keep]");
  process.exit(1);
}

// ─────────────────────────────────────────── 재료

const ms = (n) => `${n.toFixed(0)}ms`;
const pct = (list, p) => {
  const s = [...list].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))] ?? 0;
};
const report = (label, times, extra = "") =>
  times.length === 0
    ? console.log(`  ${label.padEnd(14)} 기록 없음  ${extra}`)
    : console.log(
    `  ${label.padEnd(14)} ${String(times.length).padStart(4)}건  ` +
      `p50 ${ms(pct(times, 0.5)).padStart(7)}  p95 ${ms(pct(times, 0.95)).padStart(7)}  ` +
        `최대 ${ms(Math.max(...times)).padStart(7)}  ${extra}`,
      );

/** 쿠키를 손으로 들고 다닌다. 참가자마다 세션이 달라야 해서 한 통을 쓸 수 없다 */
function client() {
  let cookie = null;
  return async function call(path, { method = "GET", body } = {}) {
    const started = performance.now();
    const res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = await res.text();
    return {
      status: res.status,
      took: performance.now() - started,
      body: text ? JSON.parse(text) : {},
      cookie,
    };
  };
}

/** 한꺼번에 다 던지지 않고 폭을 정해 밀어넣는다. 파티장에서도 동시에 100명이 누르진 않는다 */
async function pool(items, width, run) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(width, items.length) }, async () => {
      while (i < items.length) out.push(await run(items[i++]));
    }),
  );
  return out;
}

// ─────────────────────────────────────────── 시작

const host = client();
const stamp = Date.now();

// ① 여기가 연습용 환경이 맞는지부터 본다
const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
if (!health.label) {
  console.error("❌ 연습용 환경이 아닙니다. ENV_LABEL 이 없는 곳에서는 돌리지 않습니다.");
  console.error("   (프로덕션에 가짜 100명을 넣었다 지우는 일을 막는 장치입니다)");
  process.exit(1);
}
console.log(`\n환경 ${health.label} · ${BASE}`);
console.log(`인원 ${PEOPLE}명 · 테이블 ${TABLES}개\n`);

const login = await host("/host/pin", { method: "POST", body: { pin: PIN } });
if (login.status !== 200) {
  console.error("❌ 운영자 PIN 이 맞지 않습니다.");
  process.exit(1);
}

const made = await host("/host/events", {
  method: "POST",
  body: {
    name: `리허설 ${new Date(stamp).toISOString().slice(11, 16)}`,
    partyAt: stamp + 86400_000,
    regOpenAt: "now",
    prevoteAt: stamp + 3600_000,
    config: { maxPre: 3, maxParty: 3 },
    requestId: `rehearsal-${stamp}`,
  },
});
if (made.status !== 200) {
  console.error("❌ 회차를 만들지 못했습니다:", made.body);
  process.exit(1);
}
const { id: eventId, code } = made.body;
console.log(`회차 ${code} (${eventId})\n`);

// ② 초대 명단 — 파티의 문이다. 명단에 없으면 아무도 못 들어온다 (ADR-15)
const phones = Array.from(
  { length: PEOPLE },
  (_, i) => `010${String(stamp).slice(-4)}${String(i).padStart(4, "0")}`,
);
const invited = await host(`/host/events/${eventId}/invites`, { method: "POST", body: { phones } });
if (invited.status !== 200) {
  console.error("❌ 초대 명단을 넣지 못했습니다:", invited.body);
  process.exit(1);
}
console.log(`초대 명단 ${phones.length}명\n`);

// ③ 등록 — 회차 DO 가 요청을 순차 처리하는 구간이다
console.log("① 등록");
const players = [];
const regTimes = [];
let regFailed = 0;
await pool([...Array(PEOPLE).keys()], WIDTH, async (i) => {
  const c = client();
  // 문을 먼저 지난다. 통과하면 쿠키가 붙고, 등록은 그 번호로 이뤄진다
  await c(`/events/${eventId}/enter`, { method: "POST", body: { phone: phones[i] } });
  const res = await c("/register", {
    method: "POST",
    body: {
      nickname: `손님${i}`,
      realName: `가짜${i}`,
      age: 24 + (i % 21),
      gender: i % 2 === 0 ? "M" : "F",
      instagram: `rehearsal_${i}`,
      mbti: i % 3 === 0 ? "ISTJ" : "ENFP",
      charms: ["리허설용 매력 하나", "둘", "셋"],
    },
  });
  regTimes.push(res.took);
  if (res.status === 200) players.push({ id: res.body.state.me.id, call: c, gender: i % 2 === 0 ? "M" : "F" });
  else regFailed++;
});
report("등록", regTimes, regFailed ? `실패 ${regFailed}건` : "실패 0");

// ④ 소켓 — 브로드캐스트가 몇 개에 닿는지
console.log("\n② 실시간 연결");
const sockets = [];
let opened = 0;
let received = 0;
let firstAt = 0;
await Promise.all(
  Array.from({ length: SOCKETS }, () =>
    new Promise((done) => {
      const ws = new WebSocket(`${BASE.replace(/^http/, "ws")}/ws/${code}`);
      const timer = setTimeout(done, 15_000);
      ws.onopen = () => {
        opened++;
        clearTimeout(timer);
        done();
      };
      ws.onmessage = (e) => {
        if (JSON.parse(e.data).type === "phase") {
          received++;
          firstAt ||= performance.now();
        }
      };
      ws.onerror = () => {
        clearTimeout(timer);
        done();
      };
      sockets.push(ws);
    }),
  ),
);
console.log(`  연결 ${opened}/${SOCKETS}`);

// ⑤ 콕 — 사람마다 3회씩
console.log("\n③ 콕");
await host(`/host/events/${eventId}/phase`, { method: "POST", body: { to: "prevote" } });
const men = players.filter((p) => p.gender === "M");
const women = players.filter((p) => p.gender === "F");
const pokeTimes = [];
let pokeFailed = 0;
await pool(players, WIDTH, async (me) => {
  const targets = me.gender === "M" ? women : men;
  for (let k = 0; k < 3; k++) {
    const target = targets[(players.indexOf(me) + k * 7) % targets.length];
    const res = await me.call("/poke", { method: "POST", body: { toId: target.id } });
    pokeTimes.push(res.took);
    if (res.status !== 200) pokeFailed++;
  }
});
report("콕", pokeTimes, pokeFailed ? `실패 ${pokeFailed}건` : "실패 0");

// ⑤ 자리 배정 — 무료 플랜 CPU 10ms 를 넘기면 여기서 500 이 뜬다
console.log("\n④ 자리 배정 (CPU 10ms 관문)");
const draft = await host(`/host/events/${eventId}/seating`, {
  method: "POST",
  body: { tableCount: TABLES, final: false },
});
if (draft.status === 200) {
  console.log(`  초안 ${ms(draft.took)} · ${draft.body.seats.length}자리 / ${draft.body.tableCount}테이블`);
} else {
  console.log(`  ❌ 실패 ${draft.status} ${JSON.stringify(draft.body)} — CPU 한도일 수 있습니다`);
}
const published = await host(`/host/events/${eventId}/seating/publish`, { method: "POST" });
console.log(`  발송 ${ms(published.took)} (소켓 ${opened}개로 퍼짐)`);

// ⑥ 발표 — 브로드캐스트 도달률
console.log("\n⑤ 발표");
received = 0;
firstAt = 0;
const startedAt = performance.now();
const done = await host(`/host/events/${eventId}/phase`, { method: "POST", body: { to: "party" } });
await new Promise((r) => setTimeout(r, 3000));
console.log(`  전환 ${ms(done.took)} · 단계 알림 ${received}/${opened} 도달` +
  (firstAt ? ` · 첫 도달 ${ms(firstAt - startedAt)}` : ""));

const me = players[0];
const state = await me.call("/me");
console.log(`  참가자 화면 ${ms(state.took)} · 명단 ${state.body.roster?.length ?? 0}명`);

// ⑦ 정리 — 가짜 개인정보를 남기지 않는다
for (const ws of sockets) {
  try {
    ws.close();
  } catch {
    /* 이미 닫힌 것 */
  }
}
if (KEEP) {
  console.log(`\n회차를 남겨뒀습니다: ${BASE}/host/${eventId}`);
} else {
  await host(`/host/events/${eventId}`, { method: "DELETE" });
  console.log("\n회차 삭제 완료 (--keep 을 주면 남길 수 있습니다)");
}

console.log("\nCPU 시간은 밖에서 못 잽니다 — Cloudflare 대시보드의 Workers > tone-pick-qa >");
console.log("Observability 에서 이 시간대의 CPU time 을 확인하세요.\n");
