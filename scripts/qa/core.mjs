/**
 * 무대의 핵심 — 배역 · 명령 · 리모컨 페이지 (슬라이스 35, ADR-97).
 *
 * **CLI(`stage.mjs`)와 무대 워커(`worker/`)가 이 파일 하나를 같이 쓴다.** 그래서 여기에는
 * `node:` 모듈도 `process` 도 없다 — 워커 안에서도 돌아야 한다. 밖과 닿는 길은 넷뿐이고 전부
 * 부르는 쪽이 넣어 준다:
 *
 *   fetch       QA 를 부르는 길. CLI 는 전역 `fetch`, 워커는 서비스 바인딩(`env.APP.fetch`)
 *   base        그 요청의 주소 머리. 워커는 바인딩이라 아무 호스트나 된다(`https://app`)
 *   publicBase  **사람에게 보여 줄** 주소 머리 — 참가 링크·운영자 주소. 없으면 `base`
 *   log         `createLog()` 가 만든 것. 터미널과 리모컨이 같은 줄을 본다
 *
 * ⚠️ **표적을 고르는 입력을 여기 두지 마라** (S-A2). `base` 는 부르는 쪽의 설정이 정한다 —
 * 명령(`run`)이 주소나 워커 이름을 받는 순간 공개된 워커에서 프로덕션을 겨눌 수 있다.
 * ⚠️ **경로를 받아 QA 로 넘기는 명령도 두지 마라** — 무대 워커가 국가 문 우회로가 된다 (ADR-97 후기).
 * QA 를 부르는 경로는 아래 `run` 의 갈래에 박힌 것뿐이다.
 *
 * **전부 공개 API 다** (ADR-7 후기). 앱에 시연 코드를 넣지 않는다 — 배역은 실제 경로
 * (`/enter` → `/register`)로 등록하고, 사람마다 세션 쿠키를 따로 든다. **번호는 전부 가짜다.**
 */

/** 배역 PIN 번호. 전원 같다 — 회차마다, 사람마다 따로라 같아도 된다 */
export const STAGE_PIN = "2468";

/** 닉네임·실명에 숫자를 쓸 수 없다 — 일련번호를 한글로 읽는다 (rehearsal.mjs 와 같은 표) */
const hangulSeq = (n) => String(n).replace(/[0-9]/g, (d) => "영일이삼사오육칠팔구"[Number(d)]);
const NICKS = ["달빛", "바람", "구름", "별빛", "노을", "이슬", "파도", "숲길", "새벽", "봄비", "호수", "들꽃",
  "햇살", "강물", "눈꽃", "나무", "바다", "하늘", "여울", "산책", "모래", "안개", "조약돌", "소나기",
  "무지개", "밤하늘", "첫눈", "가을", "봄바람", "은하수", "잔디", "돌담", "등불", "그늘", "물결", "노랑"];
const MBTI = ["ENFP", "ISTJ", "INFJ", "ESTP", "INTP", "ESFJ", "ENTJ", "ISFP"];
const CHARMS = [
  ["웃음이 많아요", "먼저 말을 걸어요", "잘 들어줘요"],
  ["요리를 좋아해요", "산책을 자주 해요", "책을 읽어요"],
  ["농담을 잘해요", "약속을 지켜요", "새로운 걸 좋아해요"],
  ["차분해요", "관찰력이 좋아요", "혼자 있는 시간도 좋아해요"],
];

/**
 * 가짜 번호 (S-C2). **실제 번호가 들어올 입력이 없다** — 번호는 여기서만 만든다.
 * 무대를 만든 시각의 끝 네 자리로 무대끼리 갈라, 나란히 선 두 무대가 같은 번호를 쓰지 않게 한다.
 */
const fakePhone = (stamp, n) => `010${String(stamp).slice(-4)}${String(n).padStart(4, "0")}`;

/** 회차 설정 기본값. 앱 기본에 알림만 켠 것 — 받은 콕이 방송으로 닿는 순간을 보는 게 QA 의 절반이라 */
export const STAGE_CONFIG = { maxPre: 1, maxParty: 2, preNotify: true, pokeNotify: true };

/** 이 무대가 끝났을 때 남는 줄 수. 리모컨은 그중 뒤 60줄을 본다 (S-D3) */
const LOG_MAX = 200;
export const LOG_VIEW = 60;

/**
 * 로그. **터미널과 리모컨이 같은 줄을 본다** — 둘이 다른 이야기를 하면 폰으로 친 명령이
 * 터미널에서 안 보인다. `print` 는 CLI 가 `console.log` 를, 워커는 아무것도 안 넘긴다.
 */
export function createLog(print = () => {}, lines = []) {
  return {
    lines,
    say(...parts) {
      const line = parts.join(" ");
      print(line);
      lines.push(`${new Date().toTimeString().slice(0, 8)}  ${line}`);
      if (lines.length > LOG_MAX) lines.shift();
    },
  };
}

/** 무대를 못 세웠다. `code` 로 부르는 쪽이 자기 말로 바꿔 말한다 (CLI 는 터미널 안내를 붙인다) */
export class StageError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * 쿠키를 손으로 들고 다니는 HTTP 클라이언트. **사람마다 하나** — 세션이 달라야 하니 한 통을 못 쓴다.
 * `onSkew` 로 서버 시각과의 차이를 무대에 알린다 (`schedule +30s` 가 서버 시계로 잰다).
 */
function client(env, saved, onSkew = () => {}) {
  const cookies = new Map(Object.entries(saved?.cookies ?? {}));
  const c = {
    ref: saved?.ref,
    cookies,
    async call(p, { method = "GET", body } = {}) {
      const res = await env.fetch(`${env.base}/api${p}`, {
        method,
        headers: {
          "content-type": "application/json",
          ...(cookies.size ? { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
          ...(c.ref ? { "x-tp-ref": c.ref } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      for (const sc of res.headers.getSetCookie?.() ?? []) {
        const pair = sc.split(";")[0];
        const i = pair.indexOf("=");
        const name = pair.slice(0, i).trim();
        const value = pair.slice(i + 1).trim();
        if (/max-age=0/i.test(sc) || !value) cookies.delete(name);
        else cookies.set(name, value);
      }
      const text = await res.text();
      let json = {};
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = { raw: text.slice(0, 120) };
      }
      const t = Number(res.headers.get("x-server-time"));
      if (t) onSkew(t - Date.now());
      return { status: res.status, body: json };
    },
    toJSON: () => ({ ref: c.ref, cookies: Object.fromEntries(cookies) }),
  };
  return c;
}

const dur = (s) => {
  const m = /^\+?(\d+)(s|m|h)$/.exec(String(s ?? ""));
  return m ? Number(m[1]) * { s: 1000, m: 60_000, h: 3600_000 }[m[2]] : null;
};

/** 어느 무대에나 있는 명령. 무대마다 더하는 것(창 벽 등)은 부르는 쪽이 `help` 에 덧붙인다 */
export const HELP = `
  cast                    배역 명단 (번호 · 닉네임 · 성별 · 번호 · PIN)
  state                   회차 단계 · 콕 수 · 자리 라운드
  poke A B  /  unpoke A B  A가 B를 콕 (매력 투표 중이면 표, 파티 중이면 콕) · 되돌리기
  mutual A B              A→B, B→A 를 한 번에
  phase reg|prevote|party|done      단계 넘기기 (done = 발표)
  voteend                 매력 투표 지금 마감
  seating T [-x A,B]      자리 초안 (T 테이블, -x 뺄 사람) · publish · shuffle · swap A B · seat A · unseat A · discard
  announce 문구 [| 보기A | 보기B]   운영자 알림 (보기 둘을 주면 투표)
  late                    한 명 더 등록 (늦게 온 사람)
  kick A · pinreset A     참가자 삭제 · PIN 번호 초기화
  lock A                  A 의 번호로 PIN 을 다섯 번 틀린다 (잠금 재현)
  schedule prevote|party|voteend|reveal +30s|+5m   예약 시각을 지금부터 N 뒤로
  url A|host              참가 링크 · 번호 · PIN
  delete                  회차 삭제
`;

/**
 * 어떤 무대에는 없는 명령 (S-C4). **조용히 무시하지 않는다** — 그러면 명령을 잘못 친 줄 안다.
 * 무대가 `platform` 으로 직접 맡으면 그쪽이 먼저다.
 */
const ELSEWHERE = new Set(["open", "close", "snap", "now", "keep", "quit", "exit"]);

/**
 * 무대를 새로 세운다 (S-C1). 운영자로 들어가 회차를 만들고, 가짜 번호를 명단에 넣고,
 * 한 명씩 **실제 경로로** 등록한 뒤 원하는 단계까지 간다.
 *
 * @param {object} env  fetch · base · publicBase · log · platform · timeTravel · onChange
 * @param {object} want people · phase · tables · config · pin · practiceOnly
 */
export async function buildStage(env, want) {
  const { log } = env;
  const health = await env
    .fetch(`${env.base}/api/health`)
    .then((r) => r.json())
    .catch(() => null);
  if (!health?.ok) throw new StageError("unreachable", `${env.publicBase ?? env.base} 에 닿지 못했습니다.`);
  // 연습용 환경에만 선다 — QA 에만 있는 `ENV_LABEL` 이 그 증거다 (리허설과 같은 가드)
  if (want.practiceOnly && !health.label) {
    throw new StageError("not_practice", "연습용 환경이 아닙니다 (ENV_LABEL 없음). 프로덕션에는 무대를 세우지 않습니다.");
  }
  log.say(`환경 ${health.label ?? "로컬"} · ${env.publicBase ?? env.base}`);

  if (!want.pin) throw new StageError("no_pin", "운영자 PIN 이 없습니다.");
  const stage = makeStage(env, { tables: want.tables });
  const h = stage.newClient();
  const login = await h.call("/host/pin", { method: "POST", body: { pin: want.pin } });
  if (login.status !== 200) throw new StageError("login", failText("운영자 PIN", login));

  const config = { ...STAGE_CONFIG, ...want.config };
  const stamp = Date.now();
  const partyAt = stamp + 86400_000;
  const made = await h.call("/host/events", {
    method: "POST",
    body: {
      name: `무대 ${new Date(stamp).toTimeString().slice(0, 5)}`,
      partyAt,
      prevoteAt: stamp + 3600_000,
      voteEndAt: partyAt - 3600_000,
      revealAt: partyAt + 3 * 3600_000,
      config,
      requestId: `stage-${stamp}`,
    },
  });
  if (made.status !== 200) throw new StageError("create", failText("회차 만들기", made));
  stage.event = { id: made.body.id, code: made.body.code, name: made.body.name ?? "" };
  stage.host = h;
  stage.stamp = stamp;
  log.say(`회차 ${stage.event.code} (${stage.event.id}) · 설정 ${JSON.stringify(config)}`);

  /*
   * 여기서부터 실패하면 **만든 회차를 지우고** 던진다. 안 그러면 회차만 QA 에 남는다 —
   * 무대 워커에서는 목록에도 안 올라 아무도 못 닫는 회차가 된다.
   */
  try {
    const phones = Array.from({ length: want.people }, (_, i) => fakePhone(stamp, i + 1));
    const inv = await h.call(`/host/events/${stage.event.id}/invites`, { method: "POST", body: { phones } });
    if (inv.status !== 200) throw new StageError("invites", failText("초대 명단", inv));

    for (let n = 1; n <= want.people; n++) {
      const p = await stage.enroll(n, phones[n - 1]);
      if (p) stage.cast.push(p);
    }
    log.say(`배역 ${stage.cast.length}명 등록 (PIN 번호는 전원 ${STAGE_PIN})`);
    await env.onChange?.(stage);

    await stage.gotoPhase(want.phase ?? "reg");
  } catch (e) {
    await stage.close().catch(() => {});
    throw e;
  }
  return stage;
}

/** 저장해 둔 무대에 다시 붙는다. 세션 쿠키째 되살리므로 배역을 새로 만들지 않는다 */
export function restoreStage(env, saved) {
  const stage = makeStage(env, { tables: saved.tables });
  stage.event = saved.event;
  stage.stamp = saved.stamp;
  stage.host = stage.newClient(saved.host);
  stage.cast = saved.cast.map((p) => ({ ...p, session: stage.newClient(p.session) }));
  stage.deleted = !!saved.deleted;
  return stage;
}

const failText = (what, res) =>
  `${what}: ${res.status}${res.body?.error ? " " + res.body.error : ""}${res.body?.message ? " — " + res.body.message : ""}`;

function makeStage(env, { tables = 2 } = {}) {
  const { log } = env;
  const say = (...parts) => log.say(...parts);
  const fail = (what, res) => say(`  ✗ ${failText(what, res)}`);

  const stage = {
    /** @type {{ id: string, code: string, name: string }} */
    event: null,
    host: null,
    /** @type {any[]} */
    cast: [],
    tables,
    stamp: 0,
    /** 회차를 지웠는가. 지운 뒤에는 닫을 때 다시 지우지 않는다 */
    deleted: false,
    skew: 0,
    log,
    serverNow: () => Date.now() + stage.skew,
    newClient: (saved) => client(env, saved, (d) => (stage.skew = d)),

    persona(who) {
      const s = String(who).trim();
      return stage.cast.find((p) => String(p.n) === s || p.nickname === s || p.id === s) ?? null;
    },

    /** 저장할 모양. 세션 쿠키가 들어 있다 — **가짜 참가자의 것뿐**이고, 무대를 닫으면 지운다 */
    toJSON() {
      return {
        event: stage.event,
        stamp: stage.stamp,
        tables: stage.tables,
        deleted: stage.deleted,
        host: stage.host.toJSON(),
        cast: stage.cast.map((p) => ({
          n: p.n, id: p.id, nickname: p.nickname, gender: p.gender, age: p.age, phone: p.phone, pin: p.pin,
          session: p.session.toJSON(),
        })),
      };
    },

    /** 배역 하나를 실제 경로로 등록한다 — 명단 확인(초대 쿠키) → 등록(참가자 쿠키) */
    async enroll(n, phone) {
      const i = n - 1;
      const session = stage.newClient();
      const probe = await session.call(`/events/${stage.event.id}/enter`, { method: "POST", body: { phone } });
      if (probe.status !== 200) return fail(`${n}번 입장`, probe), null;
      session.ref = probe.body.ref;
      const nickname = i < NICKS.length ? NICKS[i] : `손님${hangulSeq(n)}`;
      const input = {
        nickname,
        realName: `가상${hangulSeq(n)}`,
        age: 24 + ((i * 7) % 18),
        gender: i % 2 === 0 ? "M" : "F",
        instagram: `stage_${n}`,
        mbti: MBTI[i % MBTI.length],
        charms: CHARMS[i % CHARMS.length],
        pin: STAGE_PIN,
      };
      const reg = await session.call("/register", { method: "POST", body: input });
      if (reg.status !== 200) return fail(`${n}번 등록`, reg), null;
      return { n, id: reg.body.state.me.id, nickname, gender: input.gender, age: input.age, phone, pin: STAGE_PIN, session };
    },

    /** 단계를 만든다. party 는 표를 닫고 자리를 발행해야 파티가 열려 있는 모양이 된다 */
    async gotoPhase(to) {
      if (to === "reg") return;
      const order = ["prevote", "party", "done"];
      if (!order.includes(to)) return say(`  ? 모르는 단계 ${to} (prevote · party · done)`);
      await stage.run("phase prevote");
      if (to === "prevote") return;
      await stage.run("voteend");
      await stage.run(`seating ${stage.tables}`);
      await stage.run("publish");
      await stage.run("phase party");
      if (to === "done") await stage.run("phase done");
    },

    /**
     * 무대를 닫는다 (S-C3). `keep` 이 아니면 회차를 지운다 — 가짜 참가자라도 QA 에 쌓아 두지 않는다.
     * @returns {Promise<boolean>} 회차를 지웠는가 (이미 지웠거나 남기기로 했으면 false)
     */
    async close({ keep = false } = {}) {
      if (keep || stage.deleted || !stage.event) return false;
      const res = await stage.host.call(`/host/events/${stage.event.id}`, { method: "DELETE" });
      if (res.status === 200) {
        stage.deleted = true;
        say(`회차 ${stage.event.code} 삭제`);
        return true;
      }
      say(`회차 삭제 실패 ${res.status} — 운영자 콘솔에서 지우세요`);
      return false;
    },

    /** 명령 한 줄. 무대마다 더한 명령(`env.platform`)이 먼저다 */
    async run(line) {
      return runLine(env, stage, line, { say, fail });
    },

    /**
     * 폰 리모컨 (S-D1). **주소를 상대 경로로 부른다**(`cmd`·`log`) — CLI 는 `/` 에, 무대 워커는
     * 무대마다 다른 경로에 이 페이지를 둔다. 어느 쪽이든 같은 자리 옆의 `cmd`·`log` 를 부른다.
     *
     * `links` 면 배역마다 **여는 링크**를 붙인다 (S-D2) — 창 벽이 없는 무대에서는 폰이 곧 창이다.
     * 탭마다 세션이 갈려(ADR-44) 폰 하나에서 탭마다 다른 참가자가 된다. 링크는 회차마다 하나라
     * 누구인지는 옆에 적힌 번호와 PIN 번호가 정한다. `hostPin` 을 주면 운영자 콘솔 줄도 선다 —
     * QA 의 공통 PIN 은 설정 파일에 적힌 공개 값(`0000`)이라 보여 줘도 되는 것이다.
     * `footer` 는 부르는 쪽이 붙이는 HTML 이다(무대 닫기 버튼 등) — **사용자 입력을 넣지 마라**, 거르지 않는다.
     *
     * `poll` 이면 로그를 1.5초마다 다시 읽는다 (S-D3) — CLI 는 터미널로 친 명령도 로그에 쓰므로 그래야 보인다.
     * 끄면 명령을 친 뒤, 탭으로 돌아왔을 때, `로그 다시 읽기` 를 눌렀을 때만 읽는다. 무대 워커는 끈다 —
     * 로그를 쓰는 것이 리모컨의 명령뿐이고, 한 번 읽을 때마다 DO 가 깨는데 그 하루 한도를 프로덕션과 같이 쓴다.
     */
    remotePage({ chips = [], links = false, hostPin = "", footer = "", poll = true } = {}) {
      const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
      const pub = env.publicBase ?? env.base;
      const join = `${pub}/j/${stage.event.id}`;
      const open = (href, text) => `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(text)}</a>`;
      const rows = stage.cast
        .map(
          (p) =>
            `<tr><td>${p.n}</td><td>${esc(p.nickname)}</td><td>${p.gender === "M" ? "남" : "여"} ${p.age}</td><td>${p.phone}</td><td>${p.pin}</td>` +
            (links ? `<td>${open(join, "열기")}</td>` : "") +
            `</tr>`,
        )
        .join("");
      const hostRow =
        links && hostPin
          ? `<p class="host">운영자 콘솔 ${open(`${pub}/host/${stage.event.id}`, "열기")} · PIN ${esc(hostPin)}</p>`
          : "";
      const all = ["cast", "state", "phase prevote", "voteend", `seating ${stage.tables}`, "publish", "shuffle", "phase party", "phase done", "late", ...chips];
      const chipHtml = all.map((c) => `<button data-cmd="${esc(c)}">${esc(c)}</button>`).join("");
      return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>무대 · ${esc(stage.event.code)}</title>
<style>
body{margin:0;padding:12px;font:16px/1.5 system-ui;background:#111;color:#eee}
h1{font-size:18px;margin:0 0 8px}small{color:#9a9}
form{display:flex;gap:8px;margin:10px 0}input{flex:1;font-size:18px;padding:12px;border-radius:10px;border:1px solid #444;background:#222;color:#fff}
button{font-size:16px;padding:12px 14px;border-radius:10px;border:0;background:#6c5ce7;color:#fff}
.chips{display:flex;flex-wrap:wrap;gap:8px}.chips button{background:#333}
table{width:100%;border-collapse:collapse;font-size:14px;margin-top:10px}td{padding:6px 4px;border-bottom:1px solid #333}
a{color:#a29bfe}.host{margin:10px 0 0;font-size:14px}
pre{background:#000;padding:10px;border-radius:10px;font-size:13px;white-space:pre-wrap;max-height:40vh;overflow:auto}
#reload{background:#333}
</style>
<h1>무대 ${esc(stage.event.code)} <small>${esc(env.publicBase ?? env.base)}</small></h1>
<form id="f"><input id="c" placeholder="poke 3 5" autocomplete="off" autocapitalize="off"><button>실행</button></form>
<div class="chips">${chipHtml}</div>
${hostRow}
<table>${rows}</table>
<pre id="log"></pre>
${poll ? "" : `<button type="button" id="reload">로그 다시 읽기</button>`}
${footer}
<script>
const f=document.getElementById('f'),c=document.getElementById('c'),logEl=document.getElementById('log');
async function send(line){await fetch('cmd',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({line})});refresh();}
f.onsubmit=e=>{e.preventDefault();if(c.value.trim())send(c.value);c.value='';};
document.querySelectorAll('[data-cmd]').forEach(b=>b.onclick=()=>send(b.dataset.cmd));
async function refresh(){const r=await fetch('log');logEl.textContent=await r.text();logEl.scrollTop=logEl.scrollHeight;}
refresh();${poll ? "setInterval(refresh,1500);" : "document.getElementById('reload').onclick=refresh;document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});"}
</script>`;
    },
  };
  return stage;
}

/** 명령 한 줄을 푼다. 갈래마다 **공개 API 하나** — 운영자 콘솔이나 참가자 화면이 부르는 그 경로다 */
async function runLine(env, stage, line, { say, fail }) {
  const [cmd, ...rest] = String(line ?? "").trim().split(/\s+/);
  if (!cmd) return;
  if (env.platform?.[cmd]) return env.platform[cmd](rest);

  const name = (p) => `${p.n}번 ${p.nickname}`;
  const H = (p, o) => stage.host.call(`/host/events/${stage.event.id}${p}`, o);
  const pair = () => {
    const a = stage.persona(rest[0]);
    const b = stage.persona(rest[1]);
    if (!a || !b) say("  ? 두 사람이 필요합니다 (번호 또는 닉네임)");
    return a && b ? [a, b] : null;
  };
  const ok = (what, res) => (res.status === 200 ? say(`  ✓ ${what}`) : fail(what, res));
  /** 자리 조작의 표적 라운드. 초안이 있으면 그것(round 생략), 없으면 마지막 발행 라운드 — 화면이 아는 것을 여기선 물어본다 */
  const roundOf = async () => {
    const st = await H("/state");
    const last = st.body?.seatings?.at(-1);
    return last && last.status === "published" ? { round: last.round } : {};
  };

  switch (cmd) {
    case "help":
    case "?":
      return say(HELP + (env.help ?? ""));
    case "cast":
      for (const p of stage.cast) say(`  ${String(p.n).padStart(2)}  ${p.nickname.padEnd(4)}  ${p.gender === "M" ? "남" : "여"} ${p.age}  ${p.phone}  PIN ${p.pin}`);
      return;
    case "state": {
      const st = await H("/state");
      if (st.status !== 200) return fail("상태", st);
      const m = st.body.meta;
      const rounds = (st.body.seatings ?? []).map((r) => `${r.round}라운드 ${r.status} ${r.tableCount}테이블`).join(" · ") || "없음";
      say(`  단계 ${m.phase} · 참가자 ${st.body.players.length} · 콕 사전 ${st.body.pokeCount?.pre ?? 0} 파티 ${st.body.pokeCount?.party ?? 0} · 상호 ${st.body.mutual?.length ?? 0}쌍 · 자리 ${rounds}`);
      say(`  일정 ${Object.entries(m.schedule).map(([k, v]) => `${k} ${v ? new Date(v).toTimeString().slice(0, 8) : "-"}`).join(" · ")}`);
      return;
    }
    case "poke":
    case "unpoke": {
      const ab = pair();
      if (!ab) return;
      const [a, b] = ab;
      return ok(`${name(a)} → ${name(b)} ${cmd === "poke" ? "콕" : "되돌리기"}`, await a.session.call(`/${cmd}`, { method: "POST", body: { toId: b.id } }));
    }
    case "mutual": {
      const ab = pair();
      if (!ab) return;
      const [a, b] = ab;
      ok(`${name(a)} → ${name(b)}`, await a.session.call("/poke", { method: "POST", body: { toId: b.id } }));
      ok(`${name(b)} → ${name(a)}`, await b.session.call("/poke", { method: "POST", body: { toId: a.id } }));
      return;
    }
    case "phase":
      return ok(`단계 → ${rest[0]}`, await H("/phase", { method: "POST", body: { to: rest[0] } }));
    case "voteend":
      return ok("매력 투표 마감", await H("/vote-end", { method: "POST" }));
    case "seating": {
      const tableCount = Number(rest[0] ?? stage.tables);
      const xi = rest.indexOf("-x");
      const exclude = xi >= 0 ? (rest[xi + 1] ?? "").split(",").map(stage.persona).filter(Boolean).map((p) => p.id) : [];
      return ok(`자리 초안 ${tableCount}테이블${exclude.length ? ` (뺌 ${exclude.length})` : ""}`, await H("/seating", { method: "POST", body: { tableCount, exclude } }));
    }
    case "publish":
      return ok("자리 발행", await H("/seating/publish", { method: "POST" }));
    case "shuffle":
      return ok("자리 섞기", await H("/seating/shuffle", { method: "POST" }));
    case "discard":
      return ok("자리 초안 버리기", await H("/seating", { method: "DELETE" }));
    case "swap": {
      const ab = pair();
      if (!ab) return;
      const [a, b] = ab;
      return ok(`맞교환 ${name(a)} ↔ ${name(b)}`, await H("/seating/swap", { method: "POST", body: { a: a.id, b: b.id, ...(await roundOf()) } }));
    }
    case "seat":
    case "unseat": {
      const p = stage.persona(rest[0]);
      if (!p) return say("  ? 누구를?");
      return ok(`${name(p)} ${cmd === "seat" ? "앉히기" : "자리에서 빼기"}`, await H(`/seating/${cmd}`, { method: "POST", body: { playerId: p.id, ...(await roundOf()) } }));
    }
    case "announce": {
      const [text, a, b] = rest.join(" ").split("|").map((s) => s.trim());
      if (!text) return say("  ? 문구가 필요합니다");
      return ok(`알림 "${text}"${a && b ? ` (투표 ${a} / ${b})` : ""}`, await H("/announcements", { method: "POST", body: { text, ...(a && b ? { poll: { a, b } } : {}) } }));
    }
    case "late": {
      const n = stage.cast.length + 1;
      const phone = fakePhone(Date.now(), n);
      const inv = await H("/invites", { method: "POST", body: { phones: [phone] } });
      if (inv.status !== 200) return fail("초대", inv);
      const p = await stage.enroll(n, phone);
      if (!p) return;
      stage.cast.push(p);
      await env.onChange?.(stage);
      return say(`  ✓ ${name(p)} 늦게 합류 (${phone} · PIN ${p.pin})`);
    }
    case "kick": {
      const p = stage.persona(rest[0]);
      if (!p) return say("  ? 누구를?");
      return ok(`${name(p)} 삭제`, await H(`/players/${p.id}`, { method: "DELETE" }));
    }
    case "pinreset": {
      const p = stage.persona(rest[0]);
      if (!p) return say("  ? 누구를?");
      return ok(`${name(p)} PIN 번호 초기화`, await H(`/players/${p.id}/pin/reset`, { method: "POST" }));
    }
    case "lock": {
      const p = stage.persona(rest[0]);
      if (!p) return say("  ? 누구를?");
      // 입장 시도 제한은 접속지 해시로 센다 — 여기서 틀린 만큼 이 무대가 선 자리의 시도가 소모된다
      for (let i = 0; i < 5; i++) {
        const wrong = String((Number(p.pin) + 1111 * (i + 1)) % 10000).padStart(4, "0");
        const res = await stage.newClient().call(`/events/${stage.event.id}/enter`, { method: "POST", body: { phone: p.phone, pin: wrong } });
        say(`  ${i + 1}번째 틀림 → ${res.status} ${res.body.error ?? ""}`);
        if (res.body.error === "pin_locked") break;
      }
      return;
    }
    case "schedule": {
      const key = { prevote: "prevoteAt", party: "partyAt", voteend: "voteEndAt", reveal: "revealAt" }[rest[0]];
      const d = dur(rest[1]);
      if (!key || d === null) return say("  ? 예: schedule reveal +30s");
      const cur = await H("/state");
      if (cur.status !== 200) return fail("일정 읽기", cur);
      return ok(`${rest[0]} 을 ${rest[1]} 뒤로`, await H("/schedule", { method: "PUT", body: { ...cur.body.meta.schedule, [key]: stage.serverNow() + d } }));
    }
    case "now": {
      // 시간 이동은 **로컬에만** 있다 (`ALLOW_TEST_ENDPOINTS`). 여럿이 쓰는 QA 의 시계를 한 사람이 옮기게 두지 않는다
      if (!env.timeTravel) break;
      const d = dur(rest[0]);
      if (d === null) return say("  ? 예: now +30m");
      const res = await env.fetch(`${env.base}/api/__test__/now`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ at: stage.serverNow() + d }) });
      if (res.status === 404) return say("  ✗ 시간 이동 훅이 없습니다 — 로컬에서 .dev.vars 에 ALLOW_TEST_ENDPOINTS=1 을 넣고 다시 띄우세요 (QA·프로덕션에는 없습니다)");
      const body = await res.json().catch(() => ({}));
      if (res.status !== 200) return fail("시간 이동", { status: res.status, body });
      stage.skew = body.now - Date.now();
      return say(`  ✓ 서버 시각 → ${new Date(body.now).toTimeString().slice(0, 8)}`);
    }
    case "url": {
      const pub = env.publicBase ?? env.base;
      if (rest[0] === "host") return say(`  ${pub}/host  (운영자 PIN 으로 들어감)`);
      const p = stage.persona(rest[0]);
      if (!p) return say("  ? 누구를?");
      return say(`  ${pub}/j/${stage.event.id}  →  번호 ${p.phone} · PIN ${p.pin}  (${name(p)})`);
    }
    case "delete": {
      const res = await H("", { method: "DELETE" });
      if (res.status === 200) stage.deleted = true;
      return ok("회차 삭제", res);
    }
  }
  if (ELSEWHERE.has(cmd)) return say(`  ${cmd} — 이 무대에는 없어요`);
  return say(`  ? ${cmd} — help 를 쳐보세요`);
}
