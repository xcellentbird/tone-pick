/**
 * 지난 파티 한 판을 **평가용 자료**로 뽑는다 (`eval/parties/`).
 *
 *   MASTER_PIN=**** node scripts/party-export.mjs                       # 회차가 하나면 그걸로
 *   MASTER_PIN=**** node scripts/party-export.mjs --event <회차id|코드>
 *   MASTER_PIN=**** node scripts/party-export.mjs --url https://tone-pick-qa... --name qa-연습
 *
 * `buildSeating` 을 실제 파티의 사람 구성으로 돌려보려고 만든 것이다 — 나이 분포·성비·테이블 수가
 * 지어낸 표본과 다르기 때문에, 나이차 벌점이나 `MEET_GAP` 을 건드릴 때 이 판으로 재본다.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * **가명으로 바꾸는 것** — 이름·전화번호·인스타는 값을 버리고 자리만 채운다.
 * 닉네임은 남긴다 (운영자가 자리 결과를 눈으로 읽을 때 필요하다).
 *
 * ⚠️ **그래도 이건 실제 사람들의 자료다.** 닉네임 · 나이 · MBTI · 매력 문구가 함께 있으면
 *    그 파티에 있던 사람은 서로를 알아본다. 매력 문구는 **본인이 쓴 문장**이라 특히 그렇다.
 *    저장소에 넣으면 git 기록에 영구히 남고 GitHub 로 나간다 — `.gitignore` 의 `tmp/` 줄이
 *    같은 이유로 회고용 뽑기를 막고 있다. 넣을지는 **볼 때마다 다시 정하라.**
 *    닉네임까지 지우려면 `--anon-nick` 을 준다 (`사람1`·`사람2`…).
 *
 * ⚠️ **매력 투표와 콕의 방향(누가 누구에게)이 들어간다.** 2.12.0 의 콕 이력 CSV(ADR-82)가
 *    운영자에게 그 통로를 열었다 — `buildSeating` 이 받는 `votes`·`pokes` 와 같은 모양으로 담는다.
 *    그래서 이 판으로 **끌림까지 그대로 재생**할 수 있다.
 *
 *    그만큼 무겁다. **일방적인 호감이 이 파일 안에 있다** — 참가자에게는 끝까지 드러나지 않고
 *    운영 중 콘솔에도 안 뜨는 것이다 (ADR-22·76). 저장소에 넣는 것은 그것을 git 기록에
 *    영구히 남기는 일이다. 방향이 필요 없으면 `--no-pairs` 로 뺀다.
 */
import { writeFileSync, mkdirSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d;
};
const has = (n) => args.includes(`--${n}`);

const BASE = flag("url", "https://tone-pick.tone-party.workers.dev").replace(/\/$/, "");
const WANT = flag("event", null);
const NAME = flag("name", null);
const PIN = process.env.MASTER_PIN;

if (!PIN) {
  console.error("MASTER_PIN 을 환경변수로 주세요:  MASTER_PIN=**** node scripts/party-export.mjs");
  process.exit(1);
}

let cookie = "";
/** 따옴표 안의 쉼표·줄바꿈을 견디는 작은 CSV 파서 */
function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x !== ""));
}

async function call(path, asText = false) {
  const res = await fetch(`${BASE}${path}`, {
    method: path === "/api/host/pin" ? "POST" : "GET",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: path === "/api/host/pin" ? JSON.stringify({ pin: PIN }) : undefined,
  });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  if (!res.ok) throw new Error(`${path} → ${res.status} ${(await res.text()).slice(0, 160)}`);
  return asText ? res.text() : res.json();
}

try {
  await call("/api/host/pin");
  const events = await call("/api/host/events");
  const target = WANT
    ? events.find((e) => e.id === WANT || e.code === WANT)
    : events.length === 1
      ? events[0]
      : null;
  if (!target) {
    console.error(WANT ? `그런 회차가 없습니다: ${WANT}` : "회차가 여럿입니다. --event 로 골라주세요:");
    for (const e of events) console.error(`  ${e.id}  ${e.code}  ${e.name}  (${e.phase} · ${e.playerCount}명)`);
    process.exit(1);
  }

  const st = await call(`/api/host/events/${target.id}/state`);
  const players = st.players ?? [];
  const seatings = st.seatings ?? [];

  /** 사람마다 붙는 가명. 이름·전화·인스타는 **값을 버리고 자리만 채운다** */
  const people = players.map((p, i) => ({
    id: `p${i}`,
    nickname: has("anon-nick") ? `사람${i + 1}` : p.nickname,
    age: p.age,
    gender: p.gender,
    mbti: p.mbti,
    charms: p.charms,
    realName: `가명${i + 1}`,
    phone: `010${String(i + 1).padStart(8, "0")}`,
    instagram: `@user${i + 1}`,
  }));
  const idx = new Map(players.map((p, i) => [p.id, `p${i}`]));
  const num = (rec) => Object.fromEntries(Object.entries(rec ?? {}).map(([k, v]) => [idx.get(k) ?? k, v]));

  /**
   * 방향이 있는 표·콕. CSV 는 아이디가 아니라 **닉네임+실명**으로 사람을 적으므로 그걸로 잇는다
   * (실명은 여기서만 쓰고 파일에는 안 남는다). 나간 사람 줄은 이름 자리가 비어 있어 건너뛴다.
   */
  const pairs = { pre: {}, party: {} };
  if (!has("no-pairs")) {
    const key = new Map(players.map((p, i) => [`${p.nickname}\u0000${p.realName}`, `p${i}`]));
    const rows = parseCsv(await call(`/api/host/events/${target.id}/pokes.csv`, true).catch(() => ""));
    for (const r of rows.slice(1)) {
      const round = r[0] === "사전 투표" ? "pre" : r[0] === "파티" ? "party" : null;
      const from = key.get(`${r[2]}\u0000${r[3]}`);
      const to = key.get(`${r[6]}\u0000${r[7]}`);
      if (!round || !from || !to) continue;
      const k = `${from}>${to}`;
      pairs[round][k] = (pairs[round][k] ?? 0) + 1;
    }
  }

  const out = {
    /** 이 판이 무엇인지. 회차 아이디·코드는 넣지 않는다 — 실제 회차를 가리키는 열쇠다 */
    label: NAME ?? `party-${new Date().toISOString().slice(0, 10)}`,
    takenAt: new Date().toISOString().slice(0, 10),
    people: people.length,
    men: people.filter((p) => p.gender === "M").length,
    women: people.filter((p) => p.gender === "F").length,
    /** 운영자가 실제로 고른 테이블 수 (라운드마다) */
    tableCounts: seatings.map((s) => s.tableCount),
    rounds: seatings.length,
    players: people,
    /**
     * 사람별 수. `pre` 는 매력 투표, `party` 는 콕이다.
     * 방향은 아래 `votes`·`pokes` 에 따로 있다.
     */
    voteSent: num(st.sent?.pre),
    voteReceived: num(st.received?.pre),
    pokeSent: num(st.sent?.party),
    pokeReceived: num(st.received?.party),
    /** 서로 찌른 쌍. 발표에서 양쪽에 공개된 것이라 여기 있어도 새로 드러나는 게 없다 */
    mutual: (st.mutual ?? []).map(([a, b]) => [idx.get(a) ?? a, idx.get(b) ?? b]),
    /**
     * **방향이 있는 표와 콕** — `buildSeating` 이 받는 모양 그대로다 (`"p0>p3": 2`).
     * 콕 이력 CSV(ADR-82)에서 가져온다. `--no-pairs` 면 비어 있다.
     *
     * ⚠️ **여기 일방적인 호감이 들어 있다.** 참가자에게는 끝까지 드러나지 않는 값이다.
     */
    votes: pairs.pre,
    pokes: pairs.party,
    /** 라운드별 자리 — 알고리즘이 실제로 무엇을 만들었는지의 기록 */
    seatings: seatings.map((s) => ({
      round: s.round,
      tableCount: s.tableCount,
      seats: s.seats.map((x) => ({ playerId: idx.get(x.playerId) ?? x.playerId, table: x.table })),
    })),
  };

  mkdirSync("eval/parties", { recursive: true });
  const file = `eval/parties/${out.label.replace(/[^\w가-힣.-]/g, "-")}.json`;
  writeFileSync(file, JSON.stringify(out, null, 1) + "\n", "utf8");
  console.error(`${file} — ${out.people}명 (남 ${out.men}/여 ${out.women}) · ${out.rounds}라운드`);
  console.error("이름·전화번호·인스타는 가명입니다." + (has("anon-nick") ? " 닉네임도 지웠습니다." : " 닉네임은 그대로입니다."));
  console.error("⚠️ 커밋하면 git 기록에 영구히 남습니다. 넣을지 다시 한 번 보세요.");
} catch (e) {
  console.error("실패:", e.message);
  process.exit(1);
}
