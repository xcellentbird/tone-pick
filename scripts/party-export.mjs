/**
 * 지난 파티 한 판을 **평가용 자료**로 뽑는다 (`eval/parties/`).
 *
 *   MASTER_PIN=**** node scripts/party-export.mjs                       # 회차가 하나면 그걸로
 *   MASTER_PIN=**** node scripts/party-export.mjs --event <회차id|코드>
 *   MASTER_PIN=**** node scripts/party-export.mjs --url https://tone-pick-qa... --name qa-연습
 *   MASTER_PIN=**** node scripts/party-export.mjs --seating --name 9월회차   # 자리 계산용 최소 판
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
 * ⚠️ **매력 투표와 콕의 방향(누가 누구에게)이 들어간다.** 앱은 그 방향을 내주지 않는다 —
 *    콕 로그 파일(ADR-84)을 Cloudflare 에서 받아 `--pokes` 로 넘긴다. 찌름·되돌림을 다시 셈해
 *    `buildSeating` 이 받는 `votes`·`pokes` 와 같은 모양으로 담는다. 그래서 **끌림까지 그대로 재생**할 수 있다.
 *
 *      npx wrangler r2 object get tone-pick-logs/poke-logs/<회차id>.csv --remote --file tmp/poke-log.csv
 *      MASTER_PIN=**** node scripts/party-export.mjs --pokes tmp/poke-log.csv
 *
 *    로그는 ADR-84 를 배포한 뒤의 파티에만 있다. 그 전 파티는 `--no-pairs` 로 뽑는다.
 *
 *    그만큼 무겁다. **일방적인 호감이 이 파일 안에 있다** — 참가자에게는 끝까지 드러나지 않고
 *    운영 중 콘솔에도 안 뜨는 것이다 (ADR-22·76). 저장소에 넣는 것은 그것을 git 기록에
 *    영구히 남기는 일이다. 방향이 필요 없으면 `--no-pairs` 로 뺀다.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

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
const POKES = flag("pokes", null);
/**
 * **자리 계산에 필요한 것만** 뽑는다 — 나이·성별·테이블 수·라운드 수·라운드별 자리.
 *
 * 이름도 닉네임도 MBTI 도 매력 문구도 콕도 들어가지 않는다. `buildSeating` 이 나이와 성별로
 * 하는 일(누가 누구를 만나게 되는가)을 재는 데는 그것이면 충분하고, **남에게 건네도 되는
 * 가장 작은 판**이라 알고리즘을 손볼 때 주고받기 좋다. 사람은 번호로만 구분된다.
 */
const SEATING_ONLY = has("seating");

if (!PIN) {
  console.error("MASTER_PIN 을 환경변수로 주세요:  MASTER_PIN=**** node scripts/party-export.mjs");
  process.exit(1);
}
/*
 * 방향 없이 조용히 뽑지 않는다. 예전에는 CSV 를 못 받으면 빈 값으로 넘어갔는데,
 * 그러면 **끌림이 0 인 판**이 끌림을 재생하는 판처럼 저장된다.
 */
if (!POKES && !has("no-pairs") && !SEATING_ONLY) {
  console.error("콕 방향은 로그 파일에서 읽습니다 (ADR-84). 둘 중 하나를 주세요:");
  console.error("  --pokes <파일>   npx wrangler r2 object get tone-pick-logs/poke-logs/<회차id>.csv --remote --file tmp/poke-log.csv");
  console.error("  --no-pairs       방향 없이 뽑는다");
  console.error("  --seating        나이·성별·테이블 수·자리만 (가장 작은 판)");
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
   * 방향이 있는 표·콕 — 콕 로그 파일(ADR-84)을 **처음부터 다시 셈한다.** 찌름 +1, 되돌림 −1.
   * 로그는 아이디가 아니라 **닉네임+실명**으로 사람을 적으므로 그걸로 잇는다
   * (실명은 여기서만 쓰고 파일에는 안 남는다). 지금 명단에 없는 사람의 줄은 건너뛴다.
   * 칸은 머리글 이름으로 찾는다 — 로그에 칸이 더해져도 여기가 조용히 어긋나지 않게.
   */
  const pairs = { pre: {}, party: {} };
  if (!has("no-pairs") && !SEATING_ONLY) {
    const key = new Map(players.map((p, i) => [`${p.nickname}\u0000${p.realName}`, `p${i}`]));
    const [head = [], ...rows] = parseCsv(readFileSync(POKES, "utf8").replace(/^\uFEFF/, ""));
    const at = (name) => {
      const i = head.indexOf(name);
      if (i < 0) throw new Error(`${POKES} 에 '${name}' 칸이 없습니다 — 콕 로그 파일이 맞나요?`);
      return i;
    };
    const c = { kind: at("구분"), round: at("라운드"), from: at("보낸 사람"), fromName: at("보낸 사람 실명"), to: at("받은 사람"), toName: at("받은 사람 실명") };
    for (const r of rows) {
      const round = r[c.round] === "사전 투표" ? "pre" : r[c.round] === "파티" ? "party" : null;
      const step = r[c.kind] === "찌름" ? 1 : r[c.kind] === "되돌림" ? -1 : 0;
      const from = key.get(`${r[c.from]}\u0000${r[c.fromName]}`);
      const to = key.get(`${r[c.to]}\u0000${r[c.toName]}`);
      if (!round || !step || !from || !to) continue;
      const k = `${from}>${to}`;
      pairs[round][k] = (pairs[round][k] ?? 0) + step;
      if (pairs[round][k] <= 0) delete pairs[round][k];
    }
  }

  /** 라운드별 자리. 사람은 번호(`p0`)뿐이라 이름이 없다 */
  const rounds = seatings.map((s) => ({
    round: s.round,
    tableCount: s.tableCount,
    seats: s.seats.map((x) => ({ playerId: idx.get(x.playerId) ?? x.playerId, table: x.table })),
  }));

  /*
   * **자리만 뽑는 판** — 사람은 `["M", 28]` 두 값뿐이다. 이름도 닉네임도 MBTI 도 매력도 콕도 없다.
   * 여기 없는 것은 자리 계산이 안 쓰는 것이고, 안 쓰는 것은 건네지 않는다.
   */
  const seatingOnly = {
    label: NAME ?? `party-${new Date().toISOString().slice(0, 10)}`,
    people: people.length,
    men: people.filter((p) => p.gender === "M").length,
    women: people.filter((p) => p.gender === "F").length,
    rounds: rounds.length,
    tableCounts: rounds.map((r) => r.tableCount),
    /** `[성별, 나이]` — 차례는 등록 순이고 아무 뜻이 없다 */
    players: people.map((p) => [p.gender, p.age]),
    seatings: rounds,
  };

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
     * 콕 로그 파일(ADR-84, `--pokes`)에서 다시 셈한다. `--no-pairs` 면 비어 있다.
     *
     * ⚠️ **여기 일방적인 호감이 들어 있다.** 참가자에게는 끝까지 드러나지 않는 값이다.
     */
    votes: pairs.pre,
    pokes: pairs.party,
    /** 라운드별 자리 — 알고리즘이 실제로 무엇을 만들었는지의 기록 */
    seatings: rounds,
  };

  const body = SEATING_ONLY ? seatingOnly : out;
  mkdirSync("eval/parties", { recursive: true });
  const file = `eval/parties/${body.label.replace(/[^\w가-힣.-]/g, "-")}${SEATING_ONLY ? ".seating" : ""}.json`;
  writeFileSync(file, JSON.stringify(body, null, 1) + "\n", "utf8");
  console.error(`${file} — ${body.people}명 (남 ${body.men}/여 ${body.women}) · ${body.rounds}라운드`);
  if (SEATING_ONLY) {
    // 건네려고 뽑는 판이라 화면에도 그대로 뿌린다 — 파일을 찾아 열지 않아도 복사된다
    process.stdout.write(JSON.stringify(body) + "\n");
    console.error("나이·성별·테이블 수·자리뿐입니다. 이름·닉네임·MBTI·매력·콕은 없습니다.");
  } else {
    console.error("이름·전화번호·인스타는 가명입니다." + (has("anon-nick") ? " 닉네임도 지웠습니다." : " 닉네임은 그대로입니다."));
  }
  console.error("⚠️ 커밋하면 git 기록에 영구히 남습니다. 넣을지 다시 한 번 보세요.");
} catch (e) {
  console.error("실패:", e.message);
  process.exit(1);
}
