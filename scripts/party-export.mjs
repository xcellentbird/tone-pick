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
 * ⚠️ **매력 투표의 방향(누가 누구에게)은 들어가지 않는다.** 운영자 API 가 주지 않기 때문이다 —
 *    `hostState` 에는 사람별 **보낸/받은 수**와 **상호 쌍**만 있고 한쪽만 향한 표는 없다
 *    (ADR-76 이 지키는 선이다). 방향까지 넣으려면 서버에 내보내기 통로를 새로 여는 일이고,
 *    그건 일방적인 호감을 응답에 싣는 일이라 이 앱이 하지 않기로 한 것이다.
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
async function call(path) {
  const res = await fetch(`${BASE}${path}`, {
    method: path === "/api/host/pin" ? "POST" : "GET",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: path === "/api/host/pin" ? JSON.stringify({ pin: PIN }) : undefined,
  });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  if (!res.ok) throw new Error(`${path} → ${res.status} ${(await res.text()).slice(0, 160)}`);
  return res.json();
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
     * 사람별 수만 있다. **방향은 없다** — 운영자 API 가 주지 않는다 (머리말 참고).
     * `pre` 는 매력 투표, `party` 는 콕이다.
     */
    voteSent: num(st.sent?.pre),
    voteReceived: num(st.received?.pre),
    pokeSent: num(st.sent?.party),
    pokeReceived: num(st.received?.party),
    /** 서로 찌른 쌍. 발표에서 양쪽에 공개된 것이라 여기 있어도 새로 드러나는 게 없다 */
    mutual: (st.mutual ?? []).map(([a, b]) => [idx.get(a) ?? a, idx.get(b) ?? b]),
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
