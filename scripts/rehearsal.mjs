/**
 * 100명 리허설.  실제 파티 규모로 한 바퀴 돌려 무엇이 먼저 무너지는지 본다.
 *
 *   MASTER_PIN=**** node scripts/rehearsal.mjs https://tone-pick-qa.<계정>.workers.dev
 *
 * 재는 것
 *   · 동시 등록 — 회차 DO 는 요청을 순차 처리한다. 100명이 한꺼번에 오면 여기서 줄을 선다
 *   · **사전 투표 시작** — 이 앱에서 가장 무거운 순간이다. 아래 참고
 *   · 자리 배정 — 무료 플랜 요청당 CPU 10ms. 넘치면 500(1102)이 뜬다. 성패가 곧 답이다
 *   · 브로드캐스트 — 소켓 100개에 단계 전환이 몇 개나, 얼마나 빨리 닿나
 *
 * **왜 사전 투표 시작이 가장 무거운가** — 읽기 herd 와 쓰기 큐가 겹치는 유일한 지점이다.
 * 실시간은 "다시 읽어라" 신호로만 쓰므로(ADR-26) 전환 한 번이 곧 N번의 재조회가 되고,
 * 그 화면을 본 사람들이 곧바로 콕을 찌르기 시작한다. 회차 DO 는 읽기에는 강하지만
 * 쓰기는 줄을 선다 — 그래서 이 둘이 겹치는 구간만 따로 잰다.
 *
 * 판정은 사람이 한다. 이 스크립트는 숫자를 찍을 뿐 통과·실패를 정하지 않는다 —
 * 지연은 리전·콜드 스타트·네트워크로 흔들려서 임계값을 걸면 곧 아무도 안 믿게 된다.
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
/**
 * 사전 투표가 열린 뒤 사람들이 콕을 찌르기 시작하는 데 걸리는 시간.
 *
 * **기본은 현실이다.** 전원이 같은 순간에 누르는 일은 없다 — 화면을 보고, 명단을 훑고,
 * 그러다 누른다. 최악만 재면 "몇 초 걸린다"만 남고 **정상이 어떤 모양인지 기준선이 안 생긴다.**
 * `--burst` 는 그 최악(전원 동시)을 따로 보고 싶을 때 쓴다.
 */
const SPREAD_MS = Number(process.env.SPREAD ?? 5) * 1000;
const BURST = process.argv.includes("--burst");
/**
 * 읽기가 몰리는 창. 앱 복귀·재연결은 **서버가 부른 게 아니라** 사람과 네트워크가 부른다 —
 * 운영자가 "다들 폰 보세요" 라고 말하면 1초 안에 전원이 잠금을 푼다.
 */
const READ_MS = Number(process.env.READWINDOW ?? 1) * 1000;

/**
 * 닉네임·실명에 숫자를 쓸 수 없다 (nicknameProblem/realNameProblem) — 일련번호를 한글로 읽는다.
 * copy.ts `hangulSeq` 와 같은 표다. 노드 스크립트라 TS 를 못 불러와 복제해 둔다 — 바꾸면 둘을 같이 바꾼다.
 */
const hangulSeq = (n) => String(n).replace(/[0-9]/g, (d) => "영일이삼사오육칠팔구"[Number(d)]);

if (!BASE || !PIN) {
  console.error("사용법: MASTER_PIN=**** node scripts/rehearsal.mjs <주소> [--keep] [--burst]");
  console.error("  PEOPLE=50 인원 · WIDTH=25 등록 동시성 · SPREAD=5 콕이 흩어지는 초 · TABLES=12");
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

const sleep = (n) => new Promise((r) => setTimeout(r, n));

/**
 * 읽기만 창 안에 고르게 흩어 쏜다.
 *
 * 브로드캐스트가 부르는 재조회와 달리 **서버 이벤트가 없다** — 화면이 스스로 다시 읽는
 * 상황(앱 복귀·재연결)이라 서버 쪽 지표에는 원인이 안 남는다. 여기서만 보인다.
 */
async function burstReads(list, windowMs) {
  const times = [];
  let failed = 0;
  const at = performance.now();
  await Promise.all(
    list.map(async (who, n) => {
      if (list.length > 1) await sleep((n / (list.length - 1)) * windowMs);
      const res = await who.call("/me");
      times.push(res.took);
      if (res.status !== 200) failed++;
    }),
  );
  return { times, failed, span: performance.now() - at };
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
// ⚠️ maxPre 3 은 기본값(DEFAULTS.maxPre = 1)의 **세 배**다. 일부러 무겁게 잡은 값이라
//    여기 나오는 콕 숫자를 실제 파티의 사전 투표 부하로 읽으면 안 된다 — 1/3 로 보면 된다
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
      nickname: `손님${hangulSeq(i)}`,
      realName: `가짜${hangulSeq(i)}`,
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

/**
 * 소켓 i 를 참가자 i 와 짝지어, 신호를 받으면 **그 사람의 세션으로 한 벌을 다시 읽는다.**
 *
 * 화면이 실제로 하는 일이다 (ADR-26 — 실시간은 "다시 읽어라" 신호로만 쓴다).
 * 이벤트 개수만 세면 부하의 절반을 안 재는 셈이다. 신호 하나가 곧 N번의 GET 이고,
 * 그 N 번이 이어지는 콕 쓰기와 겹치는 것이 사전 투표 시작 구간의 전부다.
 */
const herd = { armed: false, at: 0, pending: [], times: [], failed: 0, last: 0 };

await Promise.all(
  Array.from({ length: SOCKETS }, (_, i) =>
    new Promise((done) => {
      const ws = new WebSocket(`${BASE.replace(/^http/, "ws")}/ws/${code}`);
      const timer = setTimeout(done, 15_000);
      ws.onopen = () => {
        opened++;
        clearTimeout(timer);
        done();
      };
      ws.onmessage = (e) => {
        if (JSON.parse(e.data).type !== "phase") return;
        received++;
        firstAt ||= performance.now();
        if (!herd.armed || !players[i]) return;
        herd.pending.push(
          players[i].call("/me").then((res) => {
            herd.times.push(res.took);
            if (res.status !== 200) herd.failed++;
            herd.last = performance.now();
          }),
        );
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

// ⑤ 사전 투표 시작 — 다시 읽기 herd 와 콕 쓰기 큐가 겹치는 구간
console.log(`\n③ 사전 투표 시작 ${BURST ? "(버스트 — 전원 동시)" : `(현실 — 콕이 ${SPREAD_MS / 1000}초에 걸쳐 흩어진다)`}`);
const men = players.filter((p) => p.gender === "M");
const women = players.filter((p) => p.gender === "F");

herd.armed = true;
const shift = await host(`/host/events/${eventId}/phase`, { method: "POST", body: { to: "prevote" } });
herd.at = performance.now();

/*
 * **재조회가 끝나기를 기다리지 않는다.** 겹치는 것이 이 구간의 전부다 —
 * 기다렸다 찌르면 읽기와 쓰기를 따로 잰 것이지 이 순간을 잰 게 아니다.
 * 여기서는 WIDTH 를 쓰지 않는다. 사람은 정해진 폭이 아니라 자기 때가 되면 누른다.
 */
const pokeTimes = [];
const pokeStarts = [];
let pokeFailed = 0;
await Promise.all(
  players.map(async (me, n) => {
    if (!BURST && players.length > 1) await sleep((n / (players.length - 1)) * SPREAD_MS);
    const targets = me.gender === "M" ? women : men;
    for (let k = 0; k < 3; k++) {
      const target = targets[(n + k * 7) % targets.length];
      pokeStarts.push(performance.now());
      const res = await me.call("/poke", { method: "POST", body: { toId: target.id } });
      pokeTimes.push(res.took);
      if (res.status !== 200) pokeFailed++;
    }
  }),
);
const pokeDone = performance.now();

// 늦게 도착한 신호까지 받아준 뒤 재조회를 마저 기다린다
await sleep(1000);
await Promise.all(herd.pending);
herd.armed = false;

console.log(`  전환 응답      ${ms(shift.took)}`);
report(
  "다시 읽기",
  herd.times,
  `${herd.failed ? `실패 ${herd.failed}건` : "실패 0"}` +
    (herd.last ? ` · 마지막 ${ms(herd.last - herd.at)}` : ""),
);
report("콕", pokeTimes, `${pokeFailed ? `실패 ${pokeFailed}건` : "실패 0"} · 마지막 ${ms(pokeDone - herd.at)}`);
// 이 줄이 이 구간의 요점이다. 0 이면 겹치지 않은 것이고, 그러면 이 시나리오를 잰 게 아니다
const overlapped = herd.last ? pokeStarts.filter((t) => t < herd.last).length : 0;
console.log(`  겹침           재조회가 끝나기 전에 들어간 콕 ${overlapped}/${pokeStarts.length}건`);

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

// ⑦ 앱 복귀 — 서버 이벤트 없이 읽기만 몰린다
console.log(`\n⑥ 앱 복귀 (읽기 ${players.length}건이 ${READ_MS / 1000}초 안에)`);
console.log('   운영자가 "다들 폰 확인하세요" 라고 말하는 순간. 브로드캐스트가 없어 서버는 원인을 모른다');

const calm = await burstReads(players, READ_MS);
report("조용할 때", calm.times, `${calm.failed ? `실패 ${calm.failed}건` : "실패 0"} · 창 ${ms(calm.span)}`);

/*
 * 같은 일이 **쓰기가 도는 중에** 벌어지면 다르다. 읽기 자체는 가볍지만 같은 DO 를 지나므로
 * 쌓인 쓰기 큐 뒤에 선다 — 파티 중이라면 누군가는 늘 콕을 찌르고 있다.
 */
const writing = Promise.all(
  players.map(async (who, n) => {
    const targets = who.gender === "M" ? women : men;
    const res = await who.call("/poke", { method: "POST", body: { toId: targets[n % targets.length].id } });
    return res.status === 200;
  }),
);
await sleep(1000); // 큐가 쌓일 시간을 준다
const busy = await burstReads(players, READ_MS);
const wrote = (await writing).filter(Boolean).length;
report(
  "쓰기 중",
  busy.times,
  `${busy.failed ? `실패 ${busy.failed}건` : "실패 0"} · 창 ${ms(busy.span)} · 콕 ${wrote}건과 겹침`,
);

// ⑧ 재연결 — 소켓이 한꺼번에 끊겼다 붙는다
console.log(`\n⑦ 재연결 (소켓 ${players.length}개가 ${READ_MS / 1000}초 안에 다시 붙는다)`);
console.log("   배포·하이버네이션으로 한꺼번에 끊겼을 때. 클라이언트 백오프에 지터가 없어 파도가 겹친다");

for (const ws of sockets) {
  try {
    ws.close();
  } catch {
    /* 이미 닫힌 것 */
  }
}
await sleep(1000);

const openTimes = [];
const backTimes = [];
let backFailed = 0;
let reopened = 0;
const fresh = [];
await Promise.all(
  players.map(async (who, n) => {
    if (players.length > 1) await sleep((n / (players.length - 1)) * READ_MS);
    const at = performance.now();
    const ok = await new Promise((r) => {
      const ws = new WebSocket(`${BASE.replace(/^http/, "ws")}/ws/${code}`);
      const timer = setTimeout(() => r(false), 15_000);
      ws.onopen = () => {
        clearTimeout(timer);
        r(true);
      };
      ws.onerror = () => {
        clearTimeout(timer);
        r(false);
      };
      fresh.push(ws);
    });
    if (!ok) return;
    reopened++;
    openTimes.push(performance.now() - at);
    // 붙자마자 한 벌을 다시 읽는다 — 끊긴 동안의 것은 서버가 다시 밀어주지 않는다 (ADR-26)
    const res = await who.call("/me");
    backTimes.push(res.took);
    if (res.status !== 200) backFailed++;
  }),
);
sockets.push(...fresh); // 정리에서 함께 닫는다
report("소켓 재연결", openTimes, `${reopened}/${players.length} 성공`);
report("복귀 후 읽기", backTimes, backFailed ? `실패 ${backFailed}건` : "실패 0");

// ⑨ 정리 — 가짜 개인정보를 남기지 않는다
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
