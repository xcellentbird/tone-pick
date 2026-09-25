/**
 * 스테이지 워커 — 컴퓨터 없이 온라인에서 QA 스테이지를 만든다 (슬라이스 35 · 37, ADR-97 · ADR-99).
 *
 *   /                   스테이지 목록 · 새 스테이지 · 남은 몫
 *   POST /new           스테이지를 만든다 (걸음을 나눠서) → /s/<id>/
 *   /s/<id>/            스테이지 화면 — 한 탭에 운영자와 참가자 화면을 틀로 (`view.ts`)
 *   /s/<id>/state       스테이지 화면이 그릴 것 (JSON)
 *   POST /s/<id>/cmd    명령 한 줄 → 스테이지 화면이 그릴 것
 *   POST /s/<id>/drain  자동 콕의 남은 줄을 한 묶음 → 스테이지 화면이 그릴 것
 *   POST /s/<id>/view   고른 참가자의 세션을 심고, 뺀 사람의 것을 거둔다 (`plant.ts`)
 *   POST /s/<id>/close  닫기 · 회차 삭제
 *
 * **로그인이 없다** (S-B1, ADR-97 후기 4). 대신 한국 밖에서는 열리지 않고(QA 와 같은 국가 문, S-B3),
 * QA 를 부르는 횟수에 **하루 상한**이 있다 (`budget.ts`) — 계정의 하루 한도를 프로덕션과 같이 쓴다.
 * **표적은 설정 파일의 바인딩 `APP` 하나다** (S-A2) — 주소나 워커 이름을 받는 입력이 없다.
 * ⚠️ **경로나 본문을 받아 QA 로 그대로 넘기는 라우트를 만들지 마라** — 바인딩 요청에는 `cf` 가 없어
 * QA 의 국가 문을 안 타고, 하루 상한도 우회한다. QA 를 부르는 말은 `core.mjs` 의 명령뿐이다.
 * 틀은 QA 를 **브라우저가 직접** 연다 — 이 워커를 거치지 않는다.
 *
 * 앱 코드(`src/`)가 이 도구를 위해 가진 것은 틀 이름을 이름표로 읽는 몇 줄뿐이다 (ADR-99). 번호는 전부 가짜다.
 */
import { AGE_LIMIT, STAGE_AGES, ageRange } from "../core.mjs";
import { DAILY, buildCost, tooBig } from "./budget.ts";
import { clearCookie, cookieDomain, plantCookie } from "./plant.ts";
import { ENROLL_BATCH, PER_GENDER, START_PHASES, lobbyOf, type Env, type Want } from "./stage-do.ts";
import { stagePage } from "./view.ts";

export { LobbyDO, StageDO } from "./stage-do.ts";

const PHASE_NAME: Record<Want["phase"], string> = {
  reg: "등록",
  prevote: "매력 투표",
  party: "파티",
  done: "커플 발표 후",
};

const esc = (s: unknown) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
const text = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const see = (to: string, headers: [string, string][] = []) => {
  const h = new Headers({ location: to });
  for (const [k, v] of headers) h.append(k, v);
  return new Response(null, { status: 303, headers: h });
};
const fmt = (n: number) => n.toLocaleString("ko-KR");

/**
 * 한국 밖에서는 열리지 않는다 (S-B3). QA 의 국가 문(ADR-92)과 **같은 값, 같은 규칙**이다 — 이 도구가 여는
 * 참가 링크와 운영자 콘솔이 어차피 한국에서만 열리고, 로그인이 없는 지금은 아무 데나 훑는 봇이 하루 상한을
 * 먼저 써 버리는 것을 이 문이 줄인다. 나라는 `cf.country` 로만 본다 — 헤더로 읽지 마라. 모르는 나라는 통과한다.
 */
function regionBlocked(request: Request, env: Env): boolean {
  const allow = (env.ALLOWED_COUNTRIES ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  if (!allow.length) return false;
  const country = (request as { cf?: { country?: string } }).cf?.country?.toUpperCase();
  if (!country) return false;
  return !allow.includes(country);
}

/** 숫자 칸. 범위 밖이면 가까운 끝으로 — 폼을 손으로 고쳐 보내도 상한을 못 넘긴다 */
const clamp = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** 참가자 세션을 어디에 심나 — 도구를 연 주소와 QA 주소가 부모를 함께 쓸 때만 (`plant.ts`) */
function whereToPlant(request: Request, env: Env) {
  const tool = new URL(request.url);
  const domain = cookieDomain(tool.hostname, new URL(env.QA_PUBLIC_URL).hostname);
  return domain === null ? null : { domain, secure: tool.protocol === "https:" };
}

async function lobbyPage(env: Env, error = ""): Promise<Response> {
  const [{ rows, left }, health] = await Promise.all([
    lobbyOf(env).view(Date.now()),
    env.APP.fetch("https://app/api/health")
      .then((r) => r.json() as Promise<{ ok?: boolean; label?: string }>)
      .catch(() => null),
  ]);
  // 연습용 표시(ENV_LABEL)가 없는 서버에는 스테이지를 만들지 않는다 (`beginStage` 의 practiceOnly)
  const conn = !health?.ok
    ? { cls: "bad", text: "QA 연결 안 됨" }
    : health.label
      ? { cls: "ok", text: "QA 연결됨" }
      : { cls: "warn", text: "연습용 서버가 아니에요" };
  /** 만든 시각 — 한국 시간으로. 하루 몫이 다시 차는 때(오전 9시)도 한국 시간이다 */
  const kst = (at: number) => {
    const d = new Date(at + 9 * 3600_000);
    return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  };
  const stages = rows
    .map(
      (r) =>
        `<li><a class="stage" href="s/${esc(r.id)}/"><b>${esc(r.code)}</b><span>${r.people}명 · ${kst(r.at)}</span></a></li>`,
    )
    .join("");
  const nums = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  const age = (name: string, value: number, label: string) =>
    `<input type="number" inputmode="numeric" name="${name}" value="${value}" min="${AGE_LIMIT.min}" max="${AGE_LIMIT.max}" step="1" aria-label="${label}">`;
  /** 한 성별의 칸 — 인원 · 평균 나이 · 나이 범위 */
  const side = (key: "m" | "f", g: "M" | "F", title: string, count: string) => {
    const a = STAGE_AGES[g];
    const people = nums(PER_GENDER.min, PER_GENDER.max)
      .map((n) => `<option value="${n}"${n === 6 ? " selected" : ""}>${n}명</option>`)
      .join("");
    return `<fieldset class="side ${key}"><legend>${title}</legend>
<label>인원<select name="${count}">${people}</select></label>
<label>평균 나이<input type="number" inputmode="numeric" name="${key}_avg" value="${a.avg}" min="${AGE_LIMIT.min}" max="${AGE_LIMIT.max}" step="1"></label>
<div class="lab">나이 범위</div>
<div class="range">${age(`${key}_min`, a.min, `${title} 최소 나이`)}<span>~</span>${age(`${key}_max`, a.max, `${title} 최대 나이`)}</div>
</fieldset>`;
  };
  const phases = START_PHASES.map(
    (p, i) => `<label><input type="radio" name="phase" value="${p}"${i === 0 ? " checked" : ""}><span>${PHASE_NAME[p]}</span></label>`,
  ).join("");
  return html(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>QA 스테이지</title>
<link rel="icon" href="data:,">
<style>
:root{color-scheme:dark;--bg:#0f0f14;--panel:#17171f;--panel-2:#1f1f29;--line:#2d2d3a;--text:#ececf2;--dim:#9b9bb0;
--accent:#7565f2;--accent-soft:#a29bfe;--on-accent:#fff;--men:#74b9ff;--women:#fd79a8;--ok:#4cd28a;--warn:#ffb86b;--bad:#ff7675;
--r-lg:18px;--r:14px;--r-sm:10px;--gap:12px}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif}
.wrap{max-width:760px;margin:0 auto;padding:32px 20px 56px}
header{display:flex;align-items:center;flex-wrap:wrap;gap:var(--gap);margin-bottom:32px}
h1{margin:0;font-size:24px;letter-spacing:-.02em}
.pills{display:flex;flex-wrap:wrap;gap:8px;margin-left:auto}
.pill{display:inline-flex;align-items:center;gap:7px;padding:5px 12px;border-radius:999px;background:var(--panel);border:1px solid var(--line);color:var(--dim);font-size:13px;line-height:1.3;white-space:nowrap}
.dot{width:8px;height:8px;border-radius:50%;background:var(--ok)}
.pill.warn .dot{background:var(--warn)}.pill.bad .dot{background:var(--bad)}
section{margin-bottom:32px}
h2{margin:0 0 12px;font-size:13px;font-weight:600;color:var(--dim);letter-spacing:.04em}
.stages{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}
.stage{display:flex;flex-direction:column;gap:2px;padding:14px 16px;border-radius:var(--r);background:var(--panel);border:1px solid var(--line);color:inherit;text-decoration:none}
.stage:hover,.stage:focus-visible{border-color:var(--accent);outline:none}
.stage b{font-size:18px;letter-spacing:.06em}
.stage span{color:var(--dim);font-size:13px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:var(--r-lg);padding:20px}
.sides{display:grid;grid-template-columns:1fr 1fr;gap:var(--gap)}
.side{margin:0;min-width:0;padding:14px 14px 16px;border:0;border-radius:var(--r);background:var(--panel-2);box-shadow:inset 0 3px 0 var(--men)}
.side.f{box-shadow:inset 0 3px 0 var(--women)}
.side legend{float:left;width:100%;margin:0 0 4px;padding:0;font-size:16px;font-weight:700}
.side legend::before{content:"";display:inline-block;width:9px;height:9px;margin-right:8px;border-radius:50%;background:var(--men);vertical-align:1px}
.side.f legend::before{background:var(--women)}
label,.lab{display:block;margin-top:12px;font-size:13px;color:var(--dim)}
label>select,label>input{display:block;margin-top:5px}
select,input{width:100%;font:inherit;font-size:16px;color:var(--text);background:var(--bg);border:1px solid var(--line);border-radius:var(--r-sm);padding:10px 12px}
input[type=number]{-moz-appearance:textfield}input::-webkit-outer-spin-button,input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
select:focus,input:focus{outline:2px solid var(--accent);outline-offset:1px}
.range{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:6px;margin-top:5px;color:var(--dim)}
.phase{margin-top:18px}
.seg{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:6px}
.seg label{margin:0;position:relative}
.seg input{position:absolute;opacity:0;width:1px;height:1px}
.seg span{display:block;padding:10px 4px;border-radius:var(--r-sm);background:var(--bg);border:1px solid var(--line);color:var(--dim);font-size:14px;text-align:center;cursor:pointer;white-space:nowrap}
.seg input:checked+span{background:var(--accent);border-color:var(--accent);color:var(--on-accent);font-weight:600}
.seg input:focus-visible+span{outline:2px solid var(--accent-soft);outline-offset:1px}
.go{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;margin-top:20px;padding:14px;border:0;border-radius:var(--r);background:var(--accent);color:var(--on-accent);font:inherit;font-size:16px;font-weight:700;cursor:pointer}
.go:disabled{opacity:.7;cursor:progress}
.go:disabled::before{content:"";width:16px;height:16px;border-radius:50%;border:2px solid var(--on-accent);border-right-color:transparent;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.err{margin:0 0 24px;padding:12px 16px;border-radius:var(--r);background:rgba(255,118,117,.12);border:1px solid var(--bad);color:var(--text)}
@media (max-width:520px){.wrap{padding:24px 16px 40px}header{margin-bottom:24px}.pills{margin-left:0}.card{padding:14px}.seg{grid-template-columns:repeat(2,1fr)}}
</style>
<div class="wrap">
<header>
  <h1>QA 스테이지</h1>
  <div class="pills">
    <span class="pill ${conn.cls}"><i class="dot"></i>${conn.text}</span>
    <span class="pill">남은 호출 ${fmt(left)} / ${fmt(DAILY)}</span>
  </div>
</header>
${error ? `<div class="err" role="alert">${esc(error)}</div>` : ""}
${stages ? `<section><h2>진행 중인 스테이지</h2><ul class="stages">${stages}</ul></section>` : ""}
<section>
<h2>새 스테이지</h2>
<form class="card" method="post" action="new" onsubmit="const b=this.querySelector('.go');b.disabled=true;b.lastChild.textContent='만드는 중…'">
<div class="sides">${side("m", "M", "남자", "men")}${side("f", "F", "여자", "women")}</div>
<div class="phase"><div class="lab">시작 단계</div><div class="seg" role="radiogroup" aria-label="시작 단계">${phases}</div></div>
<button class="go"><span>스테이지 만들기</span></button>
</form>
</section>
</div>`);
}

/**
 * 스테이지를 만든다 — 걸음을 나눠서 (`core.mjs` 의 `beginStage`). 요청 하나가 QA 를 부를 수 있는 횟수에 끝이 있어서,
 * 등록은 `ENROLL_BATCH` 명씩 스테이지 DO 를 여러 번 부른다. 하루 몫이 모자랄 스테이지는 **시작하기 전에** 거절한다 —
 * 가다가 막히면 등록하던 사람들이 몫만 먹고 지워진다.
 */
async function build(env: Env, form: FormData): Promise<{ id: string; code: string; people: number } | { error: string }> {
  const phase = String(form.get("phase") ?? "reg") as Want["phase"];
  // 나이는 앱이 받는 범위 안으로, 최소 ≤ 평균 ≤ 최대 — 폼을 손으로 고쳐 보내도 등록이 거절되지 않게
  const ages = (g: "M" | "F", key: string) =>
    ageRange({ avg: form.get(`${key}_avg`), min: form.get(`${key}_min`), max: form.get(`${key}_max`) }, STAGE_AGES[g]);
  const want: Want = {
    men: clamp(form.get("men"), PER_GENDER.min, PER_GENDER.max, 6),
    women: clamp(form.get("women"), PER_GENDER.min, PER_GENDER.max, 6),
    ages: { M: ages("M", "m"), F: ages("F", "f") },
    phase: START_PHASES.includes(phase) ? phase : "reg",
  };
  const people = want.men + want.women;
  const need = buildCost(people, Math.ceil(people / ENROLL_BATCH));
  const left = await lobbyOf(env).left(Date.now());
  if (left < need) return { error: tooBig(need, left) };

  const id = env.STAGE.newUniqueId();
  const stub = env.STAGE.get(id);
  let step = await stub.start(want);
  while (step.ok && step.pending > 0) step = await stub.enroll();
  if (step.ok) step = await stub.finish(want.phase);
  if (!step.ok) return { error: `스테이지를 만들지 못했어요. ${step.message}` };
  const view = await stub.view();
  return { id: id.toString(), code: view?.event.code ?? "?", people };
}

/** 페이지가 보낸 번호 목록. 숫자만, 많아야 스테이지 인원만큼 */
const numbers = (v: unknown): number[] =>
  Array.isArray(v) ? v.filter((x): x is number => Number.isInteger(x) && x > 0).slice(0, 200) : [];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (regionBlocked(request, env)) {
      return text("한국에서만 들어올 수 있어요.\n해외에 있거나 VPN 을 켜 두었다면 끄고 다시 열어주세요.", 403);
    }

    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/" && request.method === "GET") return lobbyPage(env);

    if (path === "/new" && request.method === "POST") {
      const made = await build(env, await request.formData());
      if ("error" in made) return lobbyPage(env, made.error);
      await lobbyOf(env).add({ id: made.id, code: made.code, people: made.people, at: Date.now() });
      return see(`/s/${made.id}/`);
    }

    const m = /^\/s\/([0-9a-f]{64})(\/.*)?$/.exec(path);
    if (m) {
      const [, id, rest = ""] = m;
      // 목록에 없는 아이디로 빈 DO 를 깨우지 않는다
      if (!(await lobbyOf(env).has(id))) return text("그런 스테이지가 없어요.", 404);
      const stub = env.STAGE.get(env.STAGE.idFromString(id));
      const lobby = lobbyOf(env);
      if (rest === "") return see(`/s/${id}/`);

      if (rest === "/" && request.method === "GET") {
        const [view, left] = await Promise.all([stub.view(), lobby.left(Date.now())]);
        if (!view) return text("그런 스테이지가 없어요.", 404);
        return html(
          stagePage({ id, view, left, daily: DAILY, qa: env.QA_PUBLIC_URL, hostPin: env.QA_PIN, plantable: !!whereToPlant(request, env) }),
        );
      }
      if (rest === "/state" && request.method === "GET") {
        const [view, left] = await Promise.all([stub.view(), lobby.left(Date.now())]);
        return view ? json({ view, left }) : text("그런 스테이지가 없어요.", 404);
      }
      if (rest === "/cmd" && request.method === "POST") {
        const { line } = (await request.json().catch(() => ({}))) as { line?: unknown };
        const view = typeof line === "string" && line.trim() ? await stub.command(line.slice(0, 200)) : await stub.view();
        return view ? json({ view, left: await lobby.left(Date.now()) }) : text("그런 스테이지가 없어요.", 404);
      }
      if (rest === "/drain" && request.method === "POST") {
        const view = await stub.drain();
        return view ? json({ view, left: await lobby.left(Date.now()) }) : text("그런 스테이지가 없어요.", 404);
      }
      if (rest === "/view" && request.method === "POST") {
        const where = whereToPlant(request, env);
        if (!where) return new Response(null, { status: 204 });
        const body = (await request.json().catch(() => ({}))) as { show?: unknown; hide?: unknown };
        const { plant, clear } = await stub.sessions(numbers(body.show), numbers(body.hide));
        const headers = new Headers({ "cache-control": "no-store" });
        for (const s of plant) {
          const c = plantCookie(s.ref, s.token, where);
          if (c) headers.append("set-cookie", c);
        }
        for (const ref of clear) {
          const c = clearCookie(ref, where);
          if (c) headers.append("set-cookie", c);
        }
        return new Response(null, { status: 204, headers });
      }
      if (rest === "/close" && request.method === "POST") {
        // 이 페이지가 심은 세션도 함께 거둔다 — 닫힌 스테이지의 쿠키를 부모 도메인에 남기지 않는다
        const form = await request.formData().catch(() => null);
        const hide = String(form?.get("planted") ?? "")
          .split(",")
          .map(Number)
          .filter((n) => Number.isInteger(n) && n > 0);
        const where = whereToPlant(request, env);
        const { clear } = where ? await stub.sessions([], hide) : { clear: [] };
        await stub.close();
        return see(
          "/",
          clear.flatMap((ref) => {
            const c = where && clearCookie(ref, where);
            return c ? [["set-cookie", c] as [string, string]] : [];
          }),
        );
      }
    }
    return text("없는 주소예요.", 404);
  },
} satisfies ExportedHandler<Env>;
