/**
 * 운세가 사람마다 얼마나 갈리는가.  마흔 명분을 뽑아 서로 얼마나 닮았는지 잰다.
 *
 *   MASTER_PIN=**** node scripts/fortune-spread.mjs https://tone-pick-qa.<계정>.workers.dev
 *   node scripts/fortune-spread.mjs --from run-1756...json      # 안 부르고 다시 재기만
 *
 * **왜 재는가** — ADR-60 이 "갈라지는 축을 코드가 준다" 고 정했다. 프롬프트로
 * "다양하게 쓰세요" 라고 부탁하는 것과 다른 이유가 **세어볼 수 있다**는 것이었다.
 * 세어보지 않으면 부탁과 같아진다.
 *
 * **`LLM_TEMPERATURE` 를 정하는 자리이기도 하다** (ADR-60). 값을 바꿔 QA 에 배포하고
 * 다시 돌려 두 보고서를 견준다 — 코드에 박아두면 그 실험이 매번 배포가 된다.
 *
 * ⚠️ 연습용 환경에서만 돈다. `rehearsal.mjs` 와 같은 장치다 —
 *    프로덕션 DO 에 가짜 마흔 명을 넣었다 지우지 않는다.
 *    QA 에도 실제 사람의 번호를 넣지 마라. 여기서 만드는 건 전부 가짜다.
 *
 * **한 번 부른 것은 파일로 남긴다.** 운세는 한 번 열면 바뀌지 않고(ADR-20) LLM 호출에
 * 돈과 시간이 든다 — 재는 방법을 고칠 때마다 다시 부를 이유가 없다. `--from` 이 그 길이다.
 */
import { writeFileSync, readFileSync } from "node:fs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};

const FROM = arg("--from", null);
const BASE = process.argv[2]?.startsWith("http") ? process.argv[2].replace(/\/$/, "") : null;
const PEOPLE = Number(arg("--n", 40));
const PIN = process.env.MASTER_PIN;

/** 동시에 몇 건까지 띄울까. 운세는 한 건이 몇 초를 붙든다 — 좁으면 측정이 하염없다 */
const WIDTH = Number(arg("--width", 8));

// ─────────────────────────────────────────── 재는 법

/**
 * 한국어는 조사가 붙어서 **어절로 겹침을 재면 실제보다 낮게 나온다**
 * ("밤이에요" 와 "밤입니다" 가 남남이 된다). 글자 3-gram 이 그 결을 넘어 닮음을 잡는다.
 */
function trigrams(text) {
  const flat = text.replace(/\s+/g, "");
  const out = new Set();
  for (let i = 0; i + 3 <= flat.length; i++) out.add(flat.slice(i, i + 3));
  return out;
}

function jaccard(a, b) {
  let hit = 0;
  for (const g of a) if (b.has(g)) hit++;
  return hit / (a.size + b.size - hit || 1);
}

/**
 * **여지 표현.** ADR-60 이 글 전체에서 한 번까지로 못 박은 것 —
 * 이게 많으면 서로 다른 주장이 전부 같은 무주장으로 평평해진다.
 * 고치기 전 실제 화면은 450자에 다섯 번이었다.
 */
const HEDGE = /수( 도)? 있|수도 있|일지( 도)? 모르|가능성|것 같|듯하|듯 하|지 않을까/g;

/** 문단은 빈 줄로 나뉜다 (`paragraphs()` 와 같은 규칙) */
const paras = (body) => body.split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean);

/**
 * **판박이 문구 찾기.** 여러 사람 글에 똑같이 나오는 긴 토막 —
 * `사수자리의 활기와` 같은 것이 여기서 잡힌다. 유사도 평균은 낮아도
 * 이런 토막이 있으면 나란히 놓고 본 사람은 바로 알아챈다.
 */
function shared(texts, n = 8, least = 3) {
  const flats = texts.map((t) => t.replace(/\s+/g, ""));
  const countOf = (g) => flats.reduce((c, f) => c + (f.includes(g) ? 1 : 0), 0);

  const tally = new Map();
  flats.forEach((f) => {
    const once = new Set();
    for (let i = 0; i + n <= f.length; i++) once.add(f.slice(i, i + n));
    for (const g of once) tally.set(g, (tally.get(g) ?? 0) + 1);
  });

  const kept = [];
  for (const [gram, c] of [...tally.entries()].filter(([, k]) => k >= least).sort((a, b) => b[1] - a[1])) {
    if (kept.some(([g]) => g.includes(gram))) continue;
    /*
     * **토막이 아니라 문장이 보여야 한다.** 8자 창으로만 세면 같은 문장의 겹친 토막이
     * 열두 줄로 나와서 정작 몇 개가 판박이인지 안 보인다.
     * 인원수가 그대로인 동안 양쪽으로 늘려 **가장 긴 공통 토막**까지 키운다.
     */
    const host = flats.find((f) => f.includes(gram));
    let s = host.indexOf(gram);
    let e = s + gram.length;
    while (s > 0 && countOf(host.slice(s - 1, e)) === c) s--;
    while (e < host.length && countOf(host.slice(s, e + 1)) === c) e++;
    const whole = host.slice(s, e);
    if (kept.some(([g]) => g.includes(whole))) continue;
    kept.push([whole, c]);
    if (kept.length >= 8) break;
  }
  return kept;
}

const pct = (n) => `${(n * 100).toFixed(1)}%`;
const avg = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

function analyse(run) {
  const ok = run.filter((r) => r.fortune?.body);
  console.log(`\n${"─".repeat(64)}`);
  console.log(`운세 ${ok.length}/${run.length}건`);
  if (!ok.length) return void console.log("잰 것이 없습니다.");

  /*
   * **규칙 문구가 섞이면 나머지 숫자가 거짓말이 된다.** 열다섯 가지뿐이라
   * (headline 5 × body 3) 그것들끼리는 유사도 1.0 이고, 그게 평균을 끌어올린다.
   */
  const ruled = ok.filter((r) => r.fortune.fallback).length;
  if (ruled) {
    console.log(`\n⚠️  규칙 문구 ${ruled}건 (${pct(ruled / ok.length)}) — LLM 이 답하지 않았습니다.`);
    console.log("    키·모델 이름·타임아웃을 먼저 보세요. 이 상태의 유사도는 의미가 없습니다.");
  }

  /* 참가자는 headline 과 본문을 함께 본다. 본문만 재면 머리글이 다른데 1.000 으로 찍힌다 */
  const bodies = ok.map((r) => r.fortune.body);
  const whole = ok.map((r) => `${r.fortune.headline}\n${r.fortune.body}`);

  // ── ADR-60 이 프롬프트에 못 박은 것들이 지켜졌나
  const counts = bodies.map((b) => paras(b).length);
  const three = counts.filter((n) => n === 3).length;
  const hedges = bodies.map((b) => (b.match(HEDGE) ?? []).length);
  const once = hedges.filter((n) => n <= 1).length;
  const lens = bodies.map((b) => b.replace(/\s+/g, "").length);

  console.log("\n■ 프롬프트 규칙 (ADR-60)");
  console.log(`  문단 3개      ${three}/${ok.length} (${pct(three / ok.length)}) · 실제 ${[...new Set(counts)].sort().join("·")}문단`);
  console.log(`  여지 ≤1회     ${once}/${ok.length} (${pct(once / ok.length)}) · 평균 ${avg(hedges).toFixed(2)}회 · 최대 ${Math.max(...hedges)}회`);
  console.log(`  길이          평균 ${Math.round(avg(lens))}자 · 최대 ${Math.max(...lens)}자 (고치기 전 화면은 ~700자)`);

  // ── 서로 얼마나 닮았나
  const grams = whole.map(trigrams);
  const pairs = [];
  for (let i = 0; i < grams.length; i++)
    for (let j = i + 1; j < grams.length; j++) pairs.push([jaccard(grams[i], grams[j]), i, j]);
  pairs.sort((a, b) => b[0] - a[0]);
  const scores = pairs.map((p) => p[0]);
  const mid = scores.slice().sort((a, b) => a - b)[Math.floor(scores.length / 2)];

  /*
   * **숫자만으로는 못 읽는다.** 이 앱의 실제 글로 눈금을 잡아뒀다 —
   *   0.04~0.09  규칙 문구 중 **서로 다른** 본문끼리 (사람이 보기에 완전히 다른 글)
   *   0.56       뼈대는 같고 명사만 바꾼 글 (사람이 보면 바로 "같은 틀" 이라고 안다)
   *   1.00       같은 글
   * **0.3 을 넘는 쌍이 눈에 띄게 많으면 나란히 놓고 본 참가자가 알아챈다.**
   */
  console.log("\n■ 서로 얼마나 닮았나 (글자 3-gram 자카드 · 낮을수록 갈린다)");
  console.log("  눈금 · 다른 글 0.04~0.09 · 틀만 같은 글 0.56 · 같은 글 1.00");
  console.log(`  평균 ${scores.length ? avg(scores).toFixed(3) : "-"} · 중앙 ${mid?.toFixed(3)} · 최대 ${scores[0]?.toFixed(3)} · 최소 ${scores.at(-1)?.toFixed(3)}`);
  console.log(`  0.30 이상인 쌍 ${scores.filter((s) => s >= 0.3).length} / ${scores.length}`);
  console.log("\n  가장 닮은 쌍");
  for (const [s, i, j] of pairs.slice(0, 3)) {
    console.log(`   ${s.toFixed(3)}  ${ok[i].who} × ${ok[j].who}`);
    console.log(`          "${ok[i].fortune.headline}"  /  "${ok[j].fortune.headline}"`);
  }

  const stock = shared(whole);
  console.log("\n■ 판박이 문구 (여러 사람 글에 똑같이 나오는 8자 이상)");
  if (!stock.length) console.log("  없음");
  for (const [gram, c] of stock) console.log(`  ${String(c).padStart(3)}명  …${gram}…`);

  // ── 미션
  const missions = ok.filter((r) => r.mission?.mission);
  if (missions.length) {
    const when = missions.filter((r) => /때|직후|직전|하고 나|되면/.test(r.mission.mission)).length;
    /* 매력 어절이 미션에 실제로 나오나. ADR-60 이 "쓰라는 말이 없었다" 고 고친 자리다 */
    const usesCharm = missions.filter((r) =>
      r.charms.some((c) => c.split(/\s+/).some((w) => w.length >= 2 && r.mission.mission.includes(w))),
    ).length;
    /* lead 가 운세를 유의어로 옮겨 적나. ADR-60 이 본문 전달을 끊은 이유다 */
    const echo = missions
      .filter((r) => r.mission.lead)
      .map((r) => jaccard(trigrams(r.mission.lead), trigrams(r.fortune.headline)));

    console.log(`\n■ 미션 ${missions.length}건`);
    console.log(`  '언제' 가 있다  ${when}/${missions.length} (${pct(when / missions.length)})`);
    console.log(`  본인 매력을 쓴다 ${usesCharm}/${missions.length} (${pct(usesCharm / missions.length)})`);
    if (echo.length)
      console.log(`  lead↔headline 겹침 평균 ${avg(echo).toFixed(3)} · 최대 ${Math.max(...echo).toFixed(3)} (낮아야 안 베낀 것)`);
  }
  console.log(`${"─".repeat(64)}\n`);
}

// ─────────────────────────────────────────── 뽑는 법

/** 사람마다 **다른** 매력을 준다 — 다 같으면 "매력을 썼나" 를 잴 수 없다 */
const CHARMS = [
  ["요리를 잘해요", "매운 걸 잘 먹어요", "장을 잘 봐요"],
  ["노래를 좋아해요", "공연을 자주 가요", "플레이리스트가 길어요"],
  ["잘 웃어요", "리액션이 커요", "분위기를 잘 띄워요"],
  ["오래 들어요", "말을 잘 정리해요", "질문이 많아요"],
  ["등산을 좋아해요", "새벽에 일어나요", "체력이 좋아요"],
  ["영화를 많이 봐요", "옛날 영화를 좋아해요", "엔딩크레딧까지 봐요"],
  ["강아지를 키워요", "동물을 좋아해요", "산책을 자주 해요"],
  ["여행을 자주 가요", "짐을 가볍게 싸요", "길을 잘 찾아요"],
];
const MBTI = ["ENFP", "ISTJ", "INFP", "ESTP", "ISFJ", "ENTJ"];

async function collect() {
  if (!BASE) exit("주소가 없습니다. 예) node scripts/fortune-spread.mjs https://tone-pick-qa.<계정>.workers.dev");
  if (!PIN) exit("MASTER_PIN 이 없습니다.");

  const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
  if (!health.label) exit("연습용 환경이 아닙니다. ENV_LABEL 이 없는 곳에서는 돌리지 않습니다.");
  console.log(`환경 ${health.label} · ${BASE} · ${PEOPLE}명`);

  const host = client();
  if ((await host("/host/pin", { method: "POST", body: { pin: PIN } })).status !== 200)
    exit("운영자 PIN 이 맞지 않습니다.");

  const stamp = Date.now();
  const made = await host("/host/events", {
    method: "POST",
    body: {
      name: `운세 측정 ${new Date(stamp).toISOString().slice(11, 16)}`,
      partyAt: stamp + 86400_000,
      prevoteAt: stamp + 3600_000,
      voteEndAt: stamp + 86400_000 - 3600_000,
      revealAt: stamp + 86400_000 + 3 * 3600_000,
      requestId: `spread-${stamp}`,
    },
  });
  if (made.status !== 200) exit(`회차를 만들지 못했습니다: ${JSON.stringify(made.body)}`);
  const eventId = made.body.id;

  const phones = Array.from({ length: PEOPLE }, (_, i) => `010${String(stamp).slice(-4)}${String(i).padStart(4, "0")}`);
  const invited = await host(`/host/events/${eventId}/invites`, { method: "POST", body: { phones } });
  if (invited.status !== 200) exit(`초대에 실패했습니다: ${JSON.stringify(invited.body)}`);
  const tokenOf = new Map(invited.body.map((i) => [i.phone, i.token]));

  /*
   * 남28 / 여12, 22~34세 — ADR-57 을 맞출 때 쓴 것과 같은 분포다.
   * **생년월일이 사람마다 다르다.** 결과 색이 거기서 갈리므로(`fortuneSeed`)
   * 같은 날로 넣으면 마흔 명이 같은 결을 받고 이 측정 전체가 무의미해진다.
   */
  const people = Array.from({ length: PEOPLE }, (_, i) => {
    const gender = i < Math.round(PEOPLE * 0.7) ? "M" : "F";
    const age = 22 + (i % 13);
    return {
      i,
      gender,
      age,
      nickname: `손님${i}`,
      realName: `가짜${i}`,
      mbti: MBTI[i % MBTI.length],
      charms: CHARMS[i % CHARMS.length],
      birth: `${2026 - age}${String(1 + ((i * 7) % 12)).padStart(2, "0")}${String(1 + ((i * 11) % 28)).padStart(2, "0")}`,
    };
  });

  console.log("등록하는 중…");
  const joined = [];
  await pool(people, WIDTH, async (p) => {
    const c = client();
    await c(`/events/${eventId}/enter`, { method: "POST", body: { token: tokenOf.get(phones[p.i]) } });
    const res = await c("/register", {
      method: "POST",
      body: {
        nickname: p.nickname, realName: p.realName, age: p.age, gender: p.gender,
        instagram: `spread_${p.i}`, mbti: p.mbti, charms: p.charms,
      },
    });
    if (res.status === 200) joined.push({ ...p, call: c });
  });
  console.log(`등록 ${joined.length}/${PEOPLE}`);

  // 운세는 매력 투표부터, 미션은 파티부터 열린다 (ADR-20 후기)
  await host(`/host/events/${eventId}/phase`, { method: "POST", body: { to: "prevote" } });
  await host(`/host/events/${eventId}/phase`, { method: "POST", body: { to: "party" } });

  console.log("운세를 여는 중… (한 건이 몇 초 걸립니다)");
  const run = [];
  await pool(joined, WIDTH, async (p) => {
    const f = await p.call("/fortune", { method: "POST", body: { birth: p.birth } });
    const m = f.status === 200 ? await p.call("/fortune/mission", { method: "POST" }) : null;
    run.push({
      who: `${p.nickname}(${p.gender}${p.age})`,
      birth: p.birth,
      charms: p.charms,
      fortune: f.status === 200 ? f.body : null,
      mission: m?.status === 200 ? m.body : null,
    });
  });

  const file = `fortune-run-${stamp}.json`;
  writeFileSync(file, JSON.stringify(run, null, 2));
  console.log(`\n원본을 ${file} 에 남겼습니다 — 재는 법을 고치면 \`--from ${file}\` 으로 다시 부르지 않고 잽니다.`);
  console.log(`회차 ${eventId} 는 QA 에 남아 있습니다. 다 봤으면 운영자 콘솔에서 지우세요.`);
  return run;
}

function client() {
  let cookie = null;
  return async function call(path, { method = "GET", body } = {}) {
    const res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : {} };
  };
}

/** 폭을 정해 흘려보낸다. 다 한꺼번에 던지면 서버가 아니라 여기가 줄을 세운다 */
async function pool(items, width, run) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(width, queue.length) }, async () => {
      while (queue.length) await run(queue.shift());
    }),
  );
}

function exit(why) {
  console.error(`❌ ${why}`);
  process.exit(1);
}

analyse(FROM ? JSON.parse(readFileSync(FROM, "utf8")) : await collect());
