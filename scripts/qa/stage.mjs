/**
 * 무대(stage) — QA 를 손으로 하는 도구.  배역을 만들고, 그때그때 상황을 재현하고, 여러 화면을 나란히 본다.
 *
 *   npm run qa                              # 로컬 워커(127.0.0.1:8787)에 회차 + 가짜 6명, 등록 중
 *   npm run qa -- --people 8 --phase party --watch
 *   npm run qa -- --phase prevote --watch --remote     # 폰에서 http://<Mac 주소>:7000 리모컨
 *   MASTER_PIN=**** npm run qa -- https://tone-pick-qa.<계정>.workers.dev --watch
 *
 * 세 부분이 한 프로세스다.
 *
 *   배역(cast)   회차를 만들고 가짜 참가자를 **실제 경로**(`/enter` → `/register`)로 등록한다.
 *                사람마다 세션 쿠키를 따로 든다 — 리허설(`rehearsal.mjs`)과 같은 길이다
 *   리모컨       터미널(또는 `--remote` 로 폰)에서 명령을 친다. `poke 3 5` · `phase party` ·
 *                `seating 2` · `publish` · `late` · `lock 4` … 전부 **공개 API** 다.
 *                운영자 콘솔이 할 수 있는 일은 콘솔에서 하는 게 맞다 — 그것도 검수 대상이다.
 *                여기 있는 건 콘솔이 못 하는 것(참가자로서 움직이기)과, 손이 많이 가는 것뿐이다
 *   창 벽        `--watch` 면 Chromium 하나에 창을 여럿 띄운다 — 운영자 하나, 참가자 여럿.
 *                컨텍스트가 갈려 있어 창마다 **다른 사람**이고, 폰 크기 + 터치 에뮬레이션이다.
 *                진짜 폰도 한 자리 두려면 scrcpy 로 미러링해 옆에 놓는다
 *
 * **앱은 한 줄도 안 건드린다.** 시연 도구를 앱 안에 두지 않는다(ADR-7 후기) — 이 파일은
 * `scripts/` 에만 있고 번들에 안 실린다. QA 워커는 main 과 같은 바이너리 그대로다.
 *
 * **표적은 로컬이 기본이다.** `wrangler dev` 는 마음대로 부숴도 되고, `.dev.vars` 에
 * `ALLOW_TEST_ENDPOINTS=1` 을 넣으면 시간 이동(`now +30m`)까지 된다 — 그 훅은 설계상
 * 로컬·테스트에만 존재한다. QA 를 표적으로 잡으면 `label` 이 없는 곳(프로덕션)은 시작을
 * 거부한다 (리허설과 같은 가드). **번호는 전부 가짜다** — QA 에도 실제 번호를 넣지 마라.
 *
 * 끝나면 회차를 지운다 (`--keep` 이면 남긴다). 만든 것을 `.stage.json` 에 적어 두므로
 * `--attach` 로 다시 붙을 수 있다 — 창 벽만 다시 띄울 때 배역을 새로 만들 필요가 없다.
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

// ─────────────────────────────────────────── 인자

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const target = args.find((a) => !a.startsWith("--") && !isValueOf(a));
function isValueOf(a) {
  const i = args.indexOf(a);
  return i > 0 && args[i - 1].startsWith("--") && !["watch", "remote", "keep", "attach", "help"].includes(args[i - 1].slice(2));
}

if (flag("help")) {
  console.log(`사용법: npm run qa -- [local|qa|<주소>] [옵션]
  --people N       가짜 참가자 수 (기본 6)
  --phase P        reg(기본) · prevote · party · done   — party 는 투표 마감 → 자리 발행까지 한다
  --tables T       party 로 갈 때 자리 초안의 테이블 수 (기본 2)
  --config k=v     회차 설정. 예: --config maxPre=2 --config maxParty=3 --config pokeNotify=0
  --watch          창 벽을 연다 (기본: 운영자 + 참가자 1~4)
  --views a,b,c    창을 열 배역: host, 번호, all  (예: --views host,1,2)
  --remote [포트]  폰 리모컨 (기본 7000, 같은 Wi-Fi 에서 http://<이 컴퓨터>:7000)
  --keep           끝낼 때 회차를 지우지 않는다
  --attach         .stage.json 의 지난 무대에 다시 붙는다 (배역을 새로 안 만든다)
  HEADLESS=1       창을 화면에 안 띄운다 (스크린샷·자동 확인용)`);
  process.exit(0);
}

const ROOT = new URL("../..", import.meta.url).pathname;
const HERE = new URL(".", import.meta.url).pathname;
const STATE_FILE = path.join(HERE, ".stage.json");
const SNAP_DIR = path.join(HERE, ".snaps");

const BASE =
  !target || target === "local" ? "http://127.0.0.1:8787" : target === "qa" ? process.env.QA_URL ?? "" : target.replace(/\/$/, "");
if (!BASE) {
  console.error("qa 를 표적으로 잡으려면 QA_URL=https://tone-pick-qa.<계정>.workers.dev 를 주거나 주소를 직접 적어주세요.");
  process.exit(1);
}
const LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(BASE);
const PEOPLE = Number(opt("people", 6));
const PHASE = opt("phase", "reg");
const TABLES = Number(opt("tables", 2));
const KEEP = flag("keep");
const ATTACH = flag("attach");
const WATCH = flag("watch");
const REMOTE = flag("remote") ? Number(opt("remote", 7000)) || 7000 : 0;
const HEADLESS = process.env.HEADLESS === "1";
const VIEWS = opt("views", "host,1,2,3,4").split(",").map((s) => s.trim()).filter(Boolean);

/** 회차 설정. 기본은 앱 기본값에 알림만 켠 것 — 받은 콕이 방송으로 닿는 순간을 보는 게 QA 의 절반이라 */
const config = { maxPre: 1, maxParty: 2, allowUndoPre: true, allowUndo: true, preNotify: true, pokeNotify: true };
for (let i = 0; i < args.length; i++) {
  if (args[i] !== "--config") continue;
  const [k, v] = String(args[i + 1] ?? "").split("=");
  if (!(k in config)) continue;
  config[k] = typeof config[k] === "number" ? Number(v) : !(v === "0" || v === "false");
}

/** 운영자 PIN. 로컬은 .dev.vars 에서, 그 밖은 환경변수에서 — 프로덕션 PIN 을 여기 넣을 일은 없다 */
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

// ─────────────────────────────────────────── 재료

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
const STAGE_PIN = "2468";

const log = [];
/** 터미널과 리모컨이 같은 줄을 본다 */
function say(...parts) {
  const line = parts.join(" ");
  console.log(line);
  log.push(`${new Date().toTimeString().slice(0, 8)}  ${line}`);
  if (log.length > 200) log.shift();
}

/** 쿠키를 손으로 들고 다니는 HTTP 클라이언트. 사람마다 하나씩 — 세션이 달라야 하니 한 통을 못 쓴다 */
function client(saved) {
  const cookies = new Map(Object.entries(saved?.cookies ?? {}));
  const c = {
    ref: saved?.ref,
    cookies,
    async call(p, { method = "GET", body } = {}) {
      const res = await fetch(`${BASE}/api${p}`, {
        method,
        headers: {
          "content-type": "application/json",
          ...(cookies.size ? { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
          ...(c.ref ? { "x-tp-ref": c.ref } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      for (const sc of res.headers.getSetCookie()) {
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
      if (t) serverSkew = t - Date.now();
      return { status: res.status, body: json };
    },
    toJSON: () => ({ ref: c.ref, cookies: Object.fromEntries(cookies) }),
  };
  return c;
}
let serverSkew = 0;
const serverNow = () => Date.now() + serverSkew;

const fail = (what, res) =>
  say(`  ✗ ${what}: ${res.status}${res.body?.error ? " " + res.body.error : ""}${res.body?.message ? " — " + res.body.message : ""}`);

// ─────────────────────────────────────────── 무대 상태

/** @type {{ base: string, event: {id: string, code: string, name: string}, host: any, cast: any[] }} */
let stage;
const host = () => stage.host;
const cast = () => stage.cast;

function save() {
  fs.writeFileSync(STATE_FILE, JSON.stringify({ base: BASE, event: stage.event, host: stage.host.toJSON(), cast: stage.cast.map(personaJSON) }, null, 1));
}
const personaJSON = (p) => ({ n: p.n, id: p.id, nickname: p.nickname, gender: p.gender, age: p.age, phone: p.phone, pin: p.pin, session: p.session.toJSON() });

/** 배역 하나를 실제 경로로 등록한다 — 명단 확인(초대 쿠키) → 등록(참가자 쿠키) */
async function enroll(n, phone) {
  const i = n - 1;
  const session = client();
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
}

async function build() {
  const health = await fetch(`${BASE}/api/health`).then((r) => r.json()).catch(() => null);
  if (!health?.ok) {
    console.error(`❌ ${BASE} 에 닿지 못했습니다. 로컬이면 먼저 \`npm run dev:worker\` 를 띄우세요.`);
    process.exit(1);
  }
  if (!LOCAL && !health.label) {
    console.error("❌ 연습용 환경이 아닙니다 (ENV_LABEL 없음). 프로덕션에는 무대를 세우지 않습니다.");
    process.exit(1);
  }
  say(`환경 ${health.label ?? "로컬"} · ${BASE}`);

  const pin = masterPin();
  if (!pin) {
    console.error("❌ 운영자 PIN 이 없습니다. 로컬은 .dev.vars 의 MASTER_PIN, 그 밖은 MASTER_PIN=**** 로 주세요.");
    process.exit(1);
  }
  const h = client();
  const login = await h.call("/host/pin", { method: "POST", body: { pin } });
  if (login.status !== 200) return fail("운영자 PIN", login), process.exit(1);

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
  if (made.status !== 200) return fail("회차 만들기", made), process.exit(1);
  stage = { base: BASE, event: { id: made.body.id, code: made.body.code, name: made.body.name ?? "" }, host: h, cast: [] };
  say(`회차 ${stage.event.code} (${stage.event.id}) · 설정 ${JSON.stringify(config)}`);

  const phones = Array.from({ length: PEOPLE }, (_, i) => `010${String(stamp).slice(-4)}${String(i + 1).padStart(4, "0")}`);
  const inv = await h.call(`/host/events/${stage.event.id}/invites`, { method: "POST", body: { phones } });
  if (inv.status !== 200) return fail("초대 명단", inv), process.exit(1);

  for (let n = 1; n <= PEOPLE; n++) {
    const p = await enroll(n, phones[n - 1]);
    if (p) stage.cast.push(p);
  }
  say(`배역 ${stage.cast.length}명 등록 (PIN 번호는 전원 ${STAGE_PIN})`);
  save();

  await gotoPhase(PHASE);
}

async function attach() {
  const s = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  if (s.base !== BASE) {
    console.error(`❌ .stage.json 은 ${s.base} 의 무대입니다. 같은 주소로 붙이세요.`);
    process.exit(1);
  }
  stage = {
    base: s.base,
    event: s.event,
    host: client(s.host),
    cast: s.cast.map((p) => ({ ...p, session: client(p.session) })),
  };
  const st = await host().call(`/host/events/${stage.event.id}/state`);
  if (st.status !== 200) return fail("지난 무대에 붙기", st), process.exit(1);
  say(`지난 무대에 붙었습니다 — 회차 ${stage.event.code} · ${stage.cast.length}명 · 단계 ${st.body.meta.phase}`);
}

/** 단계를 만든다. party 는 표를 닫고 자리를 발행해야 파티가 열려 있는 모양이 된다 */
async function gotoPhase(to) {
  if (to === "reg") return;
  const order = ["prevote", "party", "done"];
  if (!order.includes(to)) return say(`  ? 모르는 단계 ${to} (prevote · party · done)`);
  await run("phase prevote");
  if (to === "prevote") return;
  await run("voteend");
  await run(`seating ${TABLES}`);
  await run("publish");
  await run("phase party");
  if (to === "done") await run("phase done");
}

// ─────────────────────────────────────────── 창 벽 (Playwright)

let pw = null; // { chromium, browser, windows: Map<key, {context, page}>, screen }
const PHONE = { width: 390, height: 844 };
const HOST_WIN = { width: 440, height: 900 };

async function openBrowser() {
  if (pw) return pw;
  const { chromium } = await import("playwright");
  // 보통은 `npx playwright install chromium` 이 받아둔 것을 쓴다. 다른 크로미엄을 쓰려면 PW_CHROMIUM=경로
  const browser = await chromium.launch({ headless: HEADLESS, executablePath: process.env.PW_CHROMIUM || undefined });
  pw = { chromium, browser, windows: new Map(), screen: null, slot: 0 };
  browser.on("disconnected", () => (pw = null));
  return pw;
}

/** 배역 하나(또는 운영자)를 자기 창으로 연다. 쿠키와 이름표를 심어 로그인된 채로 뜬다 */
async function openWindow(key) {
  const w = await openBrowser();
  if (w.windows.has(key)) return say(`  창 ${key} 은 이미 열려 있습니다`);
  const isHost = key === "host";
  const p = isHost ? null : persona(key);
  if (!isHost && !p) return say(`  ? ${key} 가 누군지 모르겠습니다 (host 또는 번호·닉네임)`);
  const session = isHost ? host() : p.session;
  const size = isHost ? HOST_WIN : PHONE;
  const context = await w.browser.newContext({
    viewport: size,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    baseURL: BASE,
  });
  await context.addCookies(
    [...session.cookies].map(([name, value]) => ({ name, value, url: BASE, httpOnly: true, sameSite: "Lax" })),
  );
  const ref = session.ref ?? "";
  const label = isHost ? "운영자" : `${p.n} · ${p.nickname}`;
  // 창을 구분하는 작은 이름표. 앱이 아니라 이 브라우저에만 얹힌다 — 손잡이 아래, 만질 수 없게
  await context.addInitScript(
    ({ ref, label }) => {
      try {
        if (ref) sessionStorage.setItem("tp.ref", ref);
      } catch {}
      addEventListener("DOMContentLoaded", () => {
        const tag = document.createElement("div");
        tag.textContent = label;
        tag.style.cssText =
          "position:fixed;right:6px;bottom:6px;z-index:99999;padding:2px 8px;border-radius:999px;background:#000c;color:#fff;font:600 11px/1.6 system-ui;pointer-events:none;opacity:.8";
        document.body.appendChild(tag);
      });
    },
    { ref, label },
  );
  const page = await context.newPage();
  page.on("pageerror", (e) => say(`  ⚠️ [${label}] 페이지 오류: ${e.message}`));
  await page.goto(isHost ? `/host/${stage.event.id}` : `/e/${stage.event.code}`);
  w.windows.set(key, { context, page, label });
  await tile(page, size, w.slot++);
  say(`  창 열림 — ${label}`);
}

/** 창을 화면에 격자로 놓는다. 헤드리스에서는 창이 없어 조용히 넘어간다 */
async function tile(page, size, slot) {
  if (HEADLESS) return;
  try {
    if (!pw.screen) {
      pw.screen = await page.evaluate(() => ({
        w: screen.availWidth,
        h: screen.availHeight,
        x: screen.availLeft ?? 0,
        y: screen.availTop ?? 0,
      }));
    }
    const gap = 8;
    const chrome = 88; // 탭·주소창 몫
    const cols = Math.max(1, Math.floor(pw.screen.w / (PHONE.width + gap)));
    const col = slot % cols;
    const row = Math.floor(slot / cols);
    const cdp = await page.context().newCDPSession(page);
    const { windowId } = await cdp.send("Browser.getWindowForTarget");
    await cdp.send("Browser.setWindowBounds", {
      windowId,
      bounds: {
        left: pw.screen.x + col * (PHONE.width + gap),
        top: pw.screen.y + row * Math.min(PHONE.height + chrome + gap, Math.floor(pw.screen.h / 2)),
        width: size.width,
        height: size.height + chrome,
        windowState: "normal",
      },
    });
    await cdp.detach();
  } catch (e) {
    say(`  (창 배치 실패 — ${e.message.split("\n")[0]})`);
  }
}

async function closeWindow(key) {
  const w = pw?.windows.get(key);
  if (!w) return say(`  창 ${key} 이 없습니다`);
  await w.context.close();
  pw.windows.delete(key);
  say(`  창 닫힘 — ${w.label}`);
}

async function snap(name) {
  if (!pw || pw.windows.size === 0) return say("  열린 창이 없습니다 (--watch 또는 open)");
  const dir = path.join(SNAP_DIR, `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}${name ? "-" + name : ""}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const [key, w] of pw.windows) {
    await w.page.screenshot({ path: path.join(dir, `${key}.png`) });
  }
  say(`  스크린샷 ${pw.windows.size}장 → ${path.relative(ROOT, dir)}`);
}

// ─────────────────────────────────────────── 명령

function persona(who) {
  const s = String(who).trim();
  return cast().find((p) => String(p.n) === s || p.nickname === s || p.id === s) ?? null;
}
const name = (p) => `${p.n}번 ${p.nickname}`;

const HELP = `
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
  now +30m                시간 이동 (로컬 + ALLOW_TEST_ENDPOINTS=1 일 때만)
  open A|host|all · close A · snap [이름] · url A|host
  keep · delete · quit
`;

const dur = (s) => {
  const m = /^\+?(\d+)(s|m|h)$/.exec(String(s ?? ""));
  return m ? Number(m[1]) * { s: 1000, m: 60_000, h: 3600_000 }[m[2]] : null;
};

async function run(line) {
  const [cmd, ...rest] = line.trim().split(/\s+/);
  if (!cmd) return;
  const H = (p, o) => host().call(`/host/events/${stage.event.id}${p}`, o);
  const pair = () => {
    const a = persona(rest[0]);
    const b = persona(rest[1]);
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
      return say(HELP);
    case "cast":
      for (const p of cast()) say(`  ${String(p.n).padStart(2)}  ${p.nickname.padEnd(4)}  ${p.gender === "M" ? "남" : "여"} ${p.age}  ${p.phone}  PIN ${p.pin}`);
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
      const tableCount = Number(rest[0] ?? TABLES);
      const xi = rest.indexOf("-x");
      const exclude = xi >= 0 ? (rest[xi + 1] ?? "").split(",").map(persona).filter(Boolean).map((p) => p.id) : [];
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
      const p = persona(rest[0]);
      if (!p) return say("  ? 누구를?");
      return ok(`${name(p)} ${cmd === "seat" ? "앉히기" : "자리에서 빼기"}`, await H(`/seating/${cmd}`, { method: "POST", body: { playerId: p.id, ...(await roundOf()) } }));
    }
    case "announce": {
      const [text, a, b] = rest.join(" ").split("|").map((s) => s.trim());
      if (!text) return say("  ? 문구가 필요합니다");
      return ok(`알림 "${text}"${a && b ? ` (투표 ${a} / ${b})` : ""}`, await H("/announcements", { method: "POST", body: { text, ...(a && b ? { poll: { a, b } } : {}) } }));
    }
    case "late": {
      const n = cast().length + 1;
      const phone = `010${String(Date.now()).slice(-4)}${String(n).padStart(4, "0")}`;
      const inv = await H("/invites", { method: "POST", body: { phones: [phone] } });
      if (inv.status !== 200) return fail("초대", inv);
      const p = await enroll(n, phone);
      if (!p) return;
      cast().push(p);
      save();
      return say(`  ✓ ${name(p)} 늦게 합류 (${phone} · PIN ${p.pin})`);
    }
    case "kick": {
      const p = persona(rest[0]);
      if (!p) return say("  ? 누구를?");
      return ok(`${name(p)} 삭제`, await H(`/players/${p.id}`, { method: "DELETE" }));
    }
    case "pinreset": {
      const p = persona(rest[0]);
      if (!p) return say("  ? 누구를?");
      return ok(`${name(p)} PIN 번호 초기화`, await H(`/players/${p.id}/pin/reset`, { method: "POST" }));
    }
    case "lock": {
      const p = persona(rest[0]);
      if (!p) return say("  ? 누구를?");
      // 입장 시도 제한은 접속지 해시로 센다 — 여기서 틀린 만큼 이 컴퓨터의 시도가 소모된다
      for (let i = 0; i < 5; i++) {
        const wrong = String((Number(p.pin) + 1111 * (i + 1)) % 10000).padStart(4, "0");
        const res = await client().call(`/events/${stage.event.id}/enter`, { method: "POST", body: { phone: p.phone, pin: wrong } });
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
      return ok(`${rest[0]} 을 ${rest[1]} 뒤로`, await H("/schedule", { method: "PUT", body: { ...cur.body.meta.schedule, [key]: serverNow() + d } }));
    }
    case "now": {
      const d = dur(rest[0]);
      if (d === null) return say("  ? 예: now +30m");
      const res = await fetch(`${BASE}/api/__test__/now`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ at: serverNow() + d }) });
      if (res.status === 404) return say("  ✗ 시간 이동 훅이 없습니다 — 로컬에서 .dev.vars 에 ALLOW_TEST_ENDPOINTS=1 을 넣고 다시 띄우세요 (QA·프로덕션에는 없습니다)");
      const body = await res.json().catch(() => ({}));
      if (res.status !== 200) return fail("시간 이동", { status: res.status, body });
      serverSkew = body.now - Date.now();
      return say(`  ✓ 서버 시각 → ${new Date(body.now).toTimeString().slice(0, 8)}`);
    }
    case "open": {
      const who = rest[0] ?? "all";
      const keys = who === "all" ? ["host", ...cast().map((p) => String(p.n))] : [who];
      for (const k of keys) await openWindow(k === "host" ? "host" : String(persona(k)?.n ?? k));
      return;
    }
    case "close":
      return closeWindow(rest[0] === "host" ? "host" : String(persona(rest[0])?.n ?? rest[0]));
    case "snap":
      return snap(rest.join("-"));
    case "url": {
      if (rest[0] === "host") return say(`  ${BASE}/host  (운영자 PIN 으로 들어감)`);
      const p = persona(rest[0]);
      if (!p) return say("  ? 누구를?");
      return say(`  ${BASE}/j/${stage.event.id}  →  번호 ${p.phone} · PIN ${p.pin}  (${name(p)})`);
    }
    case "keep":
      keepOnExit = true;
      return say("  끝낼 때 회차를 남깁니다");
    case "delete":
      keepOnExit = true;
      return ok("회차 삭제", await H("", { method: "DELETE" }));
    case "quit":
    case "exit":
      return shutdown();
    default:
      return say(`  ? ${cmd} — help 를 쳐보세요`);
  }
}

let keepOnExit = KEEP;
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  try {
    if (pw) await pw.browser.close().catch(() => {});
    if (!keepOnExit && stage) {
      const res = await host().call(`/host/events/${stage.event.id}`, { method: "DELETE" });
      say(res.status === 200 ? `회차 ${stage.event.code} 삭제` : `회차 삭제 실패 ${res.status} — 운영자 콘솔에서 지우세요`);
      try {
        fs.unlinkSync(STATE_FILE);
      } catch {}
    } else if (stage) say(`회차 ${stage.event.code} 를 남겨 둡니다 (--attach 로 다시 붙을 수 있습니다)`);
  } finally {
    process.exit(0);
  }
}

// ─────────────────────────────────────────── 폰 리모컨

function remotePage() {
  const rows = cast()
    .map((p) => `<tr><td>${p.n}</td><td>${p.nickname}</td><td>${p.gender === "M" ? "남" : "여"} ${p.age}</td><td>${p.phone}</td><td>${p.pin}</td></tr>`)
    .join("");
  const chips = ["cast", "state", "phase prevote", "voteend", `seating ${TABLES}`, "publish", "shuffle", "phase party", "phase done", "late", "snap"]
    .map((c) => `<button data-cmd="${c}">${c}</button>`)
    .join("");
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>무대 · ${stage.event.code}</title>
<style>
body{margin:0;padding:12px;font:16px/1.5 system-ui;background:#111;color:#eee}
h1{font-size:18px;margin:0 0 8px}small{color:#9a9}
form{display:flex;gap:8px;margin:10px 0}input{flex:1;font-size:18px;padding:12px;border-radius:10px;border:1px solid #444;background:#222;color:#fff}
button{font-size:16px;padding:12px 14px;border-radius:10px;border:0;background:#6c5ce7;color:#fff}
.chips{display:flex;flex-wrap:wrap;gap:8px}.chips button{background:#333}
table{width:100%;border-collapse:collapse;font-size:14px;margin-top:10px}td{padding:6px 4px;border-bottom:1px solid #333}
pre{background:#000;padding:10px;border-radius:10px;font-size:13px;white-space:pre-wrap;max-height:40vh;overflow:auto}
</style>
<h1>무대 ${stage.event.code} <small>${BASE}</small></h1>
<form id="f"><input id="c" placeholder="poke 3 5" autocomplete="off" autocapitalize="off"><button>실행</button></form>
<div class="chips">${chips}</div>
<table>${rows}</table>
<pre id="log"></pre>
<script>
const f=document.getElementById('f'),c=document.getElementById('c'),logEl=document.getElementById('log');
async function send(line){await fetch('/cmd',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({line})});refresh();}
f.onsubmit=e=>{e.preventDefault();if(c.value.trim())send(c.value);c.value='';};
document.querySelectorAll('[data-cmd]').forEach(b=>b.onclick=()=>send(b.dataset.cmd));
async function refresh(){const r=await fetch('/log');logEl.textContent=await r.text();logEl.scrollTop=logEl.scrollHeight;}
refresh();setInterval(refresh,1500);
</script>`;
}

function startRemote(port) {
  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(remotePage());
    }
    if (req.method === "GET" && req.url === "/log") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      return res.end(log.slice(-60).join("\n"));
    }
    if (req.method === "POST" && req.url === "/cmd") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const { line } = JSON.parse(body || "{}");
      if (line) {
        say(`> ${line}`);
        await run(line).catch((e) => say(`  ✗ ${e.message}`));
      }
      res.writeHead(200);
      return res.end("ok");
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(port, "0.0.0.0", () => {
    const ip = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal)?.address;
    say(`리모컨: http://${ip ?? "<이 컴퓨터 주소>"}:${port}  (같은 Wi-Fi 의 폰에서)`);
  });
}

// ─────────────────────────────────────────── 시작

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

if (ATTACH) await attach();
else await build();

if (WATCH) {
  const keys = VIEWS.includes("all") ? ["host", ...cast().map((p) => String(p.n))] : VIEWS;
  for (const k of keys) {
    if (k === "host") await openWindow("host");
    else if (persona(k)) await openWindow(String(persona(k).n));
  }
}
if (REMOTE) startRemote(REMOTE);

if (process.env.STAGE_SCRIPT) {
  // 자동 확인용: 명령을 세미콜론으로 이어 주면 차례로 치고 끝낸다
  for (const line of process.env.STAGE_SCRIPT.split(";")) {
    say(`> ${line.trim()}`);
    await run(line).catch((e) => say(`  ✗ ${e.message}`));
  }
  await shutdown();
}

say("명령을 치세요 (help). Ctrl-C 로 끝내면 회차를 지웁니다" + (keepOnExit ? " — 지금은 --keep" : ""));
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "무대> " });
rl.prompt();
rl.on("line", async (line) => {
  await run(line).catch((e) => say(`  ✗ ${e.message}`));
  rl.prompt();
});
rl.on("close", shutdown);
