/**
 * 운세가 사람마다 얼마나 갈리는가.  마흔 명분을 뽑아 서로 얼마나 닮았는지 잰다.
 *
 *   MASTER_PIN=**** node scripts/fortune-spread.mjs https://tone-pick-qa.<계정>.workers.dev --temp 1.2
 *   node scripts/fortune-spread.mjs --from fortune-run-....json          # 안 부르고 다시 재기만
 *   node scripts/fortune-spread.mjs --compare a.json b.json c.json       # 온도를 고르는 표
 *
 * **온도 스윕** — 서버가 `LLM_TEMPERATURE` 를 읽으므로 값마다 배포가 한 번씩 필요하다.
 * PR 은 필요 없다:
 *
 *   npx wrangler deploy --env qa --var LLM_TEMPERATURE:0.8
 *   MASTER_PIN=0000 node scripts/fortune-spread.mjs <QA주소> --temp 0.8
 *   npx wrangler deploy --env qa --var LLM_TEMPERATURE:1.2
 *   MASTER_PIN=0000 node scripts/fortune-spread.mjs <QA주소> --temp 1.2
 *   node scripts/fortune-spread.mjs --compare fortune-run-t*.json
 *
 * 기준선은 **값을 안 넣은 판**이다 (`--temp 기본`) — 그게 지금 프로덕션이 쓰는 것이다.
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
/**
 * 이 판이 **어느 온도로 뽑힌 것인지**. 서버가 쓰는 값이라 스크립트는 알 수 없어서 받아 적는다 —
 * 배포할 때 넣은 값을 그대로 쓴다. 안 적으면 나중에 비교표에서 어느 줄이 뭔지 알 수 없다.
 */
const TEMP = arg("--temp", null);
/** 저장해 둔 판 여럿을 나란히 놓는다 — 온도를 고르는 자리 */
const COMPARE = process.argv.includes("--compare")
  ? process.argv.slice(process.argv.indexOf("--compare") + 1).filter((a) => a.endsWith(".json"))
  : null;
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
function shared(texts, n = 8, least = 3, limit = 50) {
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
    if (kept.length >= limit) break;
  }
  return kept;
}

const pct = (n) => `${(n * 100).toFixed(1)}%`;
const avg = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

/**
 * 한 판을 숫자로 만든다. **보고서와 비교표가 같은 함수를 본다** —
 * 따로 세면 한쪽만 고쳐져 두 화면이 다른 말을 하게 된다.
 */
function measure(run) {
  const ok = run.filter((r) => r.fortune?.body);
  if (!ok.length) return null;

  const bodies = ok.map((r) => r.fortune.body);
  /* 참가자는 headline 과 본문을 함께 본다. 본문만 재면 머리글이 다른데 1.000 으로 찍힌다 */
  const whole = ok.map((r) => `${r.fortune.headline}\n${r.fortune.body}`);

  const grams = whole.map(trigrams);
  const pairs = [];
  for (let i = 0; i < grams.length; i++)
    for (let j = i + 1; j < grams.length; j++) pairs.push([jaccard(grams[i], grams[j]), i, j]);
  pairs.sort((a, b) => b[0] - a[0]);
  const scores = pairs.map((p) => p[0]);

  const counts = bodies.map((b) => paras(b).length);
  const hedges = bodies.map((b) => (b.match(HEDGE) ?? []).length);
  const missions = ok.filter((r) => r.mission?.mission);

  return {
    n: ok.length,
    asked: run.length,
    ruled: ok.filter((r) => r.fortune.fallback).length,
    threePara: counts.filter((n) => n === 3).length,
    paraKinds: [...new Set(counts)].sort(),
    hedgeOnce: hedges.filter((n) => n <= 1).length,
    hedgeAvg: avg(hedges),
    hedgeMax: Math.max(...hedges),
    lenAvg: avg(bodies.map((b) => b.replace(/\s+/g, "").length)),
    lenMax: Math.max(...bodies.map((b) => b.replace(/\s+/g, "").length)),
    simAvg: avg(scores),
    simMid: scores.slice().sort((a, b) => a - b)[Math.floor(scores.length / 2)],
    simMax: scores[0],
    simMin: scores.at(-1),
    close: scores.filter((s) => s >= 0.3).length,
    totalPairs: scores.length,
    pairs,
    /* 상한은 **표시용**이다. 비교표가 보는 건 개수와 최다 인원이라 여기서 자르면 안 된다 */
    stock: shared(whole),
    ok,
    missions,
  };
}

function analyse(run, label) {
  const m = measure(run);
  console.log(`\n${"─".repeat(64)}`);
  console.log(`운세 ${m ? m.n : 0}/${run.length}건${label ? ` · temperature ${label}` : ""}`);
  if (!m) return void console.log("잰 것이 없습니다.");

  /*
   * **규칙 문구가 섞이면 나머지 숫자가 거짓말이 된다.** 열다섯 가지뿐이라
   * (headline 5 × body 3) 그것들끼리는 유사도 1.0 이고, 그게 평균을 끌어올린다.
   */
  if (m.ruled) {
    console.log(`\n⚠️  규칙 문구 ${m.ruled}건 (${pct(m.ruled / m.n)}) — LLM 이 답하지 않았습니다.`);
    console.log("    키·모델 이름·타임아웃을 먼저 보세요. 이 상태의 유사도는 의미가 없습니다.");
  }

  console.log("\n■ 프롬프트 규칙 (ADR-60)");
  console.log(`  문단 3개      ${m.threePara}/${m.n} (${pct(m.threePara / m.n)}) · 실제 ${m.paraKinds.join("·")}문단`);
  console.log(`  여지 ≤1회     ${m.hedgeOnce}/${m.n} (${pct(m.hedgeOnce / m.n)}) · 평균 ${m.hedgeAvg.toFixed(2)}회 · 최대 ${m.hedgeMax}회`);
  console.log(`  길이          평균 ${Math.round(m.lenAvg)}자 · 최대 ${m.lenMax}자 (고치기 전 화면은 ~700자)`);

  /*
   * **숫자만으로는 못 읽는다.** 이 앱의 실제 글로 눈금을 잡아뒀다 —
   *   0.04~0.09  규칙 문구 중 **서로 다른** 본문끼리 (사람이 보기에 완전히 다른 글)
   *   0.56       뼈대는 같고 명사만 바꾼 글 (사람이 보면 바로 "같은 틀" 이라고 안다)
   *   1.00       같은 글
   */
  console.log("\n■ 서로 얼마나 닮았나 (글자 3-gram 자카드 · 낮을수록 갈린다)");
  console.log("  눈금 · 다른 글 0.04~0.09 · 틀만 같은 글 0.56 · 같은 글 1.00");
  console.log(`  평균 ${m.simAvg.toFixed(3)} · 중앙 ${m.simMid?.toFixed(3)} · 최대 ${m.simMax?.toFixed(3)} · 최소 ${m.simMin?.toFixed(3)}`);
  console.log(`  0.30 이상인 쌍 ${m.close} / ${m.totalPairs}`);
  console.log("\n  가장 닮은 쌍");
  for (const [s, i, j] of m.pairs.slice(0, 3)) {
    console.log(`   ${s.toFixed(3)}  ${m.ok[i].who} × ${m.ok[j].who}`);
    console.log(`          "${m.ok[i].fortune.headline}"  /  "${m.ok[j].fortune.headline}"`);
  }

  console.log(`\n■ 판박이 문구 ${m.stock.length}개 (여러 사람 글에 똑같이 나오는 8자 이상)`);
  if (!m.stock.length) console.log("  없음");
  for (const [gram, c] of m.stock.slice(0, 8)) console.log(`  ${String(c).padStart(3)}명  …${gram}…`);
  if (m.stock.length > 8) console.log(`  … 외 ${m.stock.length - 8}개`);

  if (m.missions.length) {
    const when = m.missions.filter((r) => /때|직후|직전|하고 나|되면/.test(r.mission.mission)).length;
    /* 매력 어절이 미션에 실제로 나오나. ADR-60 이 "쓰라는 말이 없었다" 고 고친 자리다 */
    const usesCharm = m.missions.filter((r) =>
      r.charms.some((c) => c.split(/\s+/).some((w) => w.length >= 2 && r.mission.mission.includes(w))),
    ).length;
    /* lead 가 운세를 유의어로 옮겨 적나. ADR-60 이 본문 전달을 끊은 이유다 */
    const echo = m.missions.filter((r) => r.mission.lead).map((r) => jaccard(trigrams(r.mission.lead), trigrams(r.fortune.headline)));

    console.log(`\n■ 미션 ${m.missions.length}건`);
    console.log(`  '언제' 가 있다  ${when}/${m.missions.length} (${pct(when / m.missions.length)})`);
    console.log(`  본인 매력을 쓴다 ${usesCharm}/${m.missions.length} (${pct(usesCharm / m.missions.length)})`);
    if (echo.length)
      console.log(`  lead↔headline 겹침 평균 ${avg(echo).toFixed(3)} · 최대 ${Math.max(...echo).toFixed(3)} (낮아야 안 베낀 것)`);
  }
  console.log(`${"─".repeat(64)}\n`);
}

/**
 * **온도를 고르는 표.** 여러 판을 나란히 놓는다.
 *
 * 온도를 올리면 글이 갈리지만(유사도↓) **규칙을 덜 지키고 JSON 이 깨진다**(규칙문구↑).
 * 그 둘이 만나는 무릎을 눈으로 찾는 자리다 — 한 판만 보고는 못 고른다.
 */
function compare(files) {
  const rows = files.map((f) => {
    const raw = JSON.parse(readFileSync(f, "utf8"));
    const run = Array.isArray(raw) ? raw : raw.run;
    return { label: (Array.isArray(raw) ? null : raw.temperature) ?? "?", file: f, m: measure(run) };
  }).filter((r) => r.m);
  if (!rows.length) return void console.log("읽을 판이 없습니다.");

  /* 터미널에서 한글·한자는 **두 칸**을 먹는다. 글자 수로 맞추면 머리글과 값이 어긋난다 */
  const wide = (t) => [...String(t)].reduce((n, ch) => n + (/[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch) ? 2 : 1), 0);
  const col = (t, w) => " ".repeat(Math.max(0, w - wide(t))) + t;
  const lead = (t, w) => t + " ".repeat(Math.max(0, w - wide(t)));
  console.log(`\n${"─".repeat(74)}`);
  console.log("온도별 비교 — 갈라짐(유사도↓)과 규칙 지킴이 맞바뀐다\n");
  console.log(
    `  ${lead("온도", 10)}${col("인원", 6)}${col("규칙문구", 10)}${col("문단3", 8)}${col("여지≤1", 9)}` +
      `${col("유사도", 9)}${col("0.3이상", 10)}${col("판박이", 8)}${col("최다", 7)}`,
  );
  for (const { label, m } of rows) {
    /* 판박이는 **몇 개인지**와 **가장 많은 것이 몇 명에게 나왔는지**를 함께 본다 */
    const most = m.stock.length ? Math.max(...m.stock.map(([, c]) => c)) : 0;
    console.log(
      `  ${lead(label, 10)}${col(m.n, 6)}${col(pct(m.ruled / m.n), 10)}${col(pct(m.threePara / m.n), 8)}` +
        `${col(pct(m.hedgeOnce / m.n), 9)}${col(m.simAvg.toFixed(3), 9)}${col(`${m.close}/${m.totalPairs}`, 10)}` +
        `${col(m.stock.length, 8)}${col(most ? `${most}명` : "-", 7)}`,
    );
  }
  console.log("\n  고르는 법 — **규칙문구가 0% 인 줄만 후보다.** 그중에서 유사도와 `0.3이상` 이 낮고");
  console.log("  문단3·여지≤1 이 높게 남는 것을 고른다.");
  console.log("  ⚠️ 규칙문구가 섞인 줄은 유사도가 **낮든 높든 못 쓴다.** 규칙 문구는 열다섯 가지뿐이라");
  console.log("  섞이면 유사도가 오히려 **올라간다**(같은 글이 여럿 생긴다) — 두 가지가 섞인 값이다.");
  console.log(`${"─".repeat(74)}\n`);
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

  const file = `fortune-run-${TEMP ? `t${TEMP}-` : ""}${stamp}.json`;
  /* 온도를 파일 안에 함께 남긴다 — 파일 이름만 믿으면 옮겨 적다 뒤바뀐다 */
  writeFileSync(file, JSON.stringify({ temperature: TEMP, at: stamp, run }, null, 2));
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

if (COMPARE?.length) {
  compare(COMPARE);
} else if (FROM) {
  /* 옛 판은 배열로 저장됐다. 읽는 자리를 하나로 둔다 — 저장된 자료는 코드보다 오래 산다 */
  const raw = JSON.parse(readFileSync(FROM, "utf8"));
  analyse(Array.isArray(raw) ? raw : raw.run, Array.isArray(raw) ? null : raw.temperature);
} else {
  analyse(await collect(), TEMP);
}
