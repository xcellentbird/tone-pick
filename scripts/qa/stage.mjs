/**
 * 무대(stage) — QA 를 손으로 하는 도구.  배역을 만들고, 그때그때 상황을 재현하고, 여러 화면을 나란히 본다.
 *
 *   npm run qa                              # 로컬 워커(127.0.0.1:8787)에 회차 + 가짜 6명, 등록 중
 *   npm run qa -- --people 8 --phase party --watch
 *   npm run qa -- --phase prevote --watch --remote     # 폰에서 http://<Mac 주소>:7000 리모컨
 *   MASTER_PIN=**** npm run qa -- https://tone-pick-qa.<계정>.workers.dev --watch
 *
 * **핵심은 `core.mjs` 에 있다** (슬라이스 35, ADR-97) — 배역 만들기 · 명령 · 리모컨 페이지.
 * 무대 워커(`worker/`)가 같은 파일을 쓴다. 여기 남은 것은 **컴퓨터에서만 되는 것**뿐이다:
 * 인자 읽기, `.stage.json`, 창 벽(Playwright), 같은 Wi-Fi 리모컨, 터미널.
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
import { LOG_VIEW, STAGE_CONFIG, StageError, buildStage, createLog, restoreStage } from "./core.mjs";

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
  --people N       가짜 참가자 수 (기본 6 — 남녀 반씩)
  --men M --women W  남녀를 따로 (각각 주면 --people 대신 쓴다)
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
const MEN = opt("men", undefined);
const WOMEN = opt("women", undefined);
const PHASE = opt("phase", "reg");
const TABLES = Number(opt("tables", 2));
const KEEP = flag("keep");
const ATTACH = flag("attach");
const WATCH = flag("watch");
const REMOTE = flag("remote") ? Number(opt("remote", 7000)) || 7000 : 0;
const HEADLESS = process.env.HEADLESS === "1";
const VIEWS = opt("views", "host,1,2,3,4").split(",").map((s) => s.trim()).filter(Boolean);

/** 회차 설정. 기본값은 core 가 든다 (`STAGE_CONFIG`) — 무대 워커와 같은 모양이어야 한다 */
const config = { ...STAGE_CONFIG };
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

// ─────────────────────────────────────────── 무대 상태

const log = createLog(console.log);
const say = (...parts) => log.say(...parts);

/** @type {Awaited<ReturnType<typeof buildStage>>} */
let stage;

/** `.stage.json` 에 적는다. **받은 무대를 쓴다** — 세우는 중(`buildStage` 안)에는 `stage` 가 아직 비어 있다 */
function save(s = stage) {
  fs.writeFileSync(STATE_FILE, JSON.stringify({ base: BASE, ...s.toJSON() }, null, 1));
}

/**
 * core 가 모르는 것 — 이 컴퓨터에서만 되는 명령. core 의 명령보다 먼저 본다.
 * 무대 워커에는 이것들이 없고, 거기서 치면 core 가 `이 무대에는 없어요` 로 답한다.
 */
const CLI_HELP = `  now +30m                시간 이동 (로컬 + ALLOW_TEST_ENDPOINTS=1 일 때만)
  open A|host|all · close A · snap [이름]   창 벽
  keep · quit
`;
const platform = {
  open: async (rest) => {
    const who = rest[0] ?? "all";
    const keys = who === "all" ? ["host", ...stage.cast.map((p) => String(p.n))] : [who];
    for (const k of keys) await openWindow(k === "host" ? "host" : String(stage.persona(k)?.n ?? k));
  },
  close: (rest) => closeWindow(rest[0] === "host" ? "host" : String(stage.persona(rest[0])?.n ?? rest[0])),
  snap: (rest) => snap(rest.join("-")),
  keep: () => {
    keepOnExit = true;
    say("  끝낼 때 회차를 남깁니다");
  },
  quit: () => shutdown(),
  exit: () => shutdown(),
};

const env = {
  fetch: (...a) => fetch(...a),
  base: BASE,
  publicBase: BASE,
  log,
  platform,
  help: CLI_HELP,
  // 훅이 없는 곳(QA·프로덕션)에서는 core 가 404 를 보고 그렇다고 말한다
  timeTravel: true,
  // 요청 하나의 몫이 없다 — 자동 콕을 한 번에 다 보낸다 (무대 워커는 `BULK_MAX` 씩 나눈다)
  batch: Infinity,
  onChange: (s) => save(s),
};

/** core 가 던진 것을 이 터미널의 말로 바꾼다 — 로컬이면 무엇을 띄워야 하는지까지 */
function die(e) {
  if (!(e instanceof StageError)) throw e;
  const hint = {
    unreachable: `❌ ${BASE} 에 닿지 못했습니다. 로컬이면 먼저 \`npm run dev:worker\` 를 띄우세요.`,
    not_practice: "❌ 연습용 환경이 아닙니다 (ENV_LABEL 없음). 프로덕션에는 무대를 세우지 않습니다.",
    no_pin: "❌ 운영자 PIN 이 없습니다. 로컬은 .dev.vars 의 MASTER_PIN, 그 밖은 MASTER_PIN=**** 로 주세요.",
  }[e.code];
  console.error(hint ?? `  ✗ ${e.message}`);
  process.exit(1);
}

async function build() {
  stage = await buildStage(env, {
    ...(MEN !== undefined || WOMEN !== undefined ? { men: Number(MEN ?? 0), women: Number(WOMEN ?? 0) } : { people: PEOPLE }),
    phase: PHASE,
    tables: TABLES,
    config,
    pin: masterPin(),
    // 로컬은 라벨이 없어도 된다 — 마음대로 부숴도 되는 자리다
    practiceOnly: !LOCAL,
  }).catch(die);
}

async function attach() {
  const s = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  if (s.base !== BASE) {
    console.error(`❌ .stage.json 은 ${s.base} 의 무대입니다. 같은 주소로 붙이세요.`);
    process.exit(1);
  }
  stage = restoreStage(env, { tables: TABLES, ...s });
  const st = await stage.host.call(`/host/events/${stage.event.id}/state`);
  if (st.status !== 200) {
    say(`  ✗ 지난 무대에 붙기: ${st.status}`);
    process.exit(1);
  }
  say(`지난 무대에 붙었습니다 — 회차 ${stage.event.code} · ${stage.cast.length}명 · 단계 ${st.body.meta.phase}`);
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
  const p = isHost ? null : stage.persona(key);
  if (!isHost && !p) return say(`  ? ${key} 가 누군지 모르겠습니다 (host 또는 번호·닉네임)`);
  const session = isHost ? stage.host : p.session;
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

let keepOnExit = KEEP;
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  try {
    if (pw) await pw.browser.close().catch(() => {});
    if (stage && !stage.deleted && keepOnExit) {
      say(`회차 ${stage.event.code} 를 남겨 둡니다 (--attach 로 다시 붙을 수 있습니다)`);
    } else if (stage) {
      await stage.close();
      try {
        fs.unlinkSync(STATE_FILE);
      } catch {}
    }
  } finally {
    process.exit(0);
  }
}

// ─────────────────────────────────────────── 폰 리모컨 (같은 Wi-Fi)

function startRemote(port) {
  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(stage.remotePage({ chips: ["snap"] }));
    }
    if (req.method === "GET" && req.url === "/log") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      return res.end(log.lines.slice(-LOG_VIEW).join("\n"));
    }
    if (req.method === "POST" && req.url === "/cmd") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const { line } = JSON.parse(body || "{}");
      if (line) {
        say(`> ${line}`);
        await stage.run(line).catch((e) => say(`  ✗ ${e.message}`));
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
  const keys = VIEWS.includes("all") ? ["host", ...stage.cast.map((p) => String(p.n))] : VIEWS;
  for (const k of keys) {
    if (k === "host") await openWindow("host");
    else if (stage.persona(k)) await openWindow(String(stage.persona(k).n));
  }
}
if (REMOTE) startRemote(REMOTE);

if (process.env.STAGE_SCRIPT) {
  // 자동 확인용: 명령을 세미콜론으로 이어 주면 차례로 치고 끝낸다
  for (const line of process.env.STAGE_SCRIPT.split(";")) {
    say(`> ${line.trim()}`);
    await stage.run(line).catch((e) => say(`  ✗ ${e.message}`));
  }
  await shutdown();
}

say("명령을 치세요 (help). Ctrl-C 로 끝내면 회차를 지웁니다" + (keepOnExit ? " — 지금은 --keep" : ""));
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "무대> " });
rl.prompt();
rl.on("line", async (line) => {
  await stage.run(line).catch((e) => say(`  ✗ ${e.message}`));
  rl.prompt();
});
rl.on("close", shutdown);
