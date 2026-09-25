/**
 * 무대 워커 — 컴퓨터 없이 온라인에서 QA 무대를 세운다 (슬라이스 35 · 37, ADR-97 · ADR-99).
 *
 *   /                   무대 목록 · 새 무대 · 남은 몫
 *   POST /new           무대를 세운다 (걸음을 나눠서) → /s/<id>/
 *   /s/<id>/            무대 화면 — 한 탭에 운영자와 참가자 화면을 틀로 (`view.ts`)
 *   /s/<id>/state       무대 화면이 그릴 것 (JSON)
 *   POST /s/<id>/cmd    명령 한 줄 → 무대 화면이 그릴 것
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
import { DAILY, buildCost, tooBig } from "./budget.ts";
import { clearCookie, cookieDomain, plantCookie } from "./plant.ts";
import { ENROLL_BATCH, PER_GENDER, START_PHASES, lobbyOf, type Env, type Want } from "./stage-do.ts";
import { stagePage } from "./view.ts";

export { LobbyDO, StageDO } from "./stage-do.ts";

const PHASE_NAME: Record<Want["phase"], string> = {
  prevote: "매력 투표",
  party: "파티 (자리 발행까지)",
  done: "발표 뒤",
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
  const qa = health?.ok ? `QA 연결됨 · ${esc(health.label ?? "라벨 없음")}` : "QA 에 닿지 못했어요";
  const list = rows.length
    ? rows
        .map(
          (r) =>
            `<li><a href="s/${esc(r.id)}/">무대 ${esc(r.code)}</a> <small>${r.people}명 · ${new Date(r.at).toISOString().slice(5, 16).replace("T", " ")} UTC</small></li>`,
        )
        .join("")
    : "<li><small>열린 무대가 없어요</small></li>";
  const opts = (xs: readonly string[], names?: Record<string, string>, pick?: string) =>
    xs.map((x) => `<option value="${x}"${x === pick ? " selected" : ""}>${names?.[x] ?? x}</option>`).join("");
  const nums = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
  return html(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>무대 · QA 도구</title>
<link rel="icon" href="data:,">
<style>
body{margin:0;padding:12px;font:16px/1.5 system-ui;background:#111;color:#eee;max-width:560px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:18px 0 6px}small{color:#9a9}a{color:#a29bfe}
label{display:block;margin:8px 0 2px;font-size:14px;color:#bbb}
.pair{display:flex;gap:10px}.pair>div{flex:1}
select{width:100%;font-size:17px;padding:10px;border-radius:10px;border:1px solid #444;background:#222;color:#fff}
button{width:100%;margin-top:14px;font-size:17px;padding:13px;border-radius:10px;border:0;background:#6c5ce7;color:#fff}
ul{padding-left:18px}.err{color:#ff7675}
</style>
<h1>무대</h1><small>${qa}</small>
${error ? `<p class="err">${esc(error)}</p>` : ""}
<h2>열린 무대</h2><ul>${list}</ul>
<h2>새 무대</h2>
<form method="post" action="new" onsubmit="this.querySelector('button').disabled=true;this.querySelector('button').textContent='세우는 중… (사람이 많으면 수십 초 걸려요)'">
<div class="pair">
<div><label>남자</label><select name="men">${opts(nums(PER_GENDER.min, PER_GENDER.max), undefined, "6")}</select></div>
<div><label>여자</label><select name="women">${opts(nums(PER_GENDER.min, PER_GENDER.max), undefined, "6")}</select></div>
</div>
<label>시작 단계 — 모두 등록을 마친 뒤예요</label><select name="phase">${opts(START_PHASES, PHASE_NAME, "prevote")}</select>
<button>무대 세우기</button>
</form>
<p><small>남은 QA 호출: ${fmt(left)}번. 매일 오전 9시에 ${fmt(DAILY)}번으로 다시 채워져요. 무대 하나는 사람 수의 두 배쯤 들어요.</small></p>
<p><small>로그인이 없어서 주소를 아는 사람은 누구나 쓸 수 있어요. 다른 사람이 세운 무대는 닫지 말아주세요.</small></p>
<p><small>번호는 전부 가짜예요. 무대를 닫으면 회차를 지우고, 12시간 동안 손대지 않은 무대는 저절로 닫혀요.</small></p>`);
}

/**
 * 무대를 세운다 — 걸음을 나눠서 (`core.mjs` 의 `beginStage`). 요청 하나가 QA 를 부를 수 있는 횟수에 끝이 있어서,
 * 등록은 `ENROLL_BATCH` 명씩 무대 DO 를 여러 번 부른다. 하루 몫이 모자랄 무대는 **시작하기 전에** 거절한다 —
 * 가다가 막히면 등록하던 사람들이 몫만 먹고 지워진다.
 */
async function build(env: Env, form: FormData): Promise<{ id: string; code: string; people: number } | { error: string }> {
  const phase = String(form.get("phase") ?? "prevote") as Want["phase"];
  const want: Want = {
    men: clamp(form.get("men"), PER_GENDER.min, PER_GENDER.max, 6),
    women: clamp(form.get("women"), PER_GENDER.min, PER_GENDER.max, 6),
    phase: START_PHASES.includes(phase) ? phase : "prevote",
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
  if (!step.ok) return { error: `무대를 못 세웠어요 — ${step.message}` };
  const view = await stub.view();
  return { id: id.toString(), code: view?.event.code ?? "?", people };
}

/** 페이지가 보낸 번호 목록. 숫자만, 많아야 무대 인원만큼 */
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
      if (!(await lobbyOf(env).has(id))) return text("그런 무대가 없어요.", 404);
      const stub = env.STAGE.get(env.STAGE.idFromString(id));
      const lobby = lobbyOf(env);
      if (rest === "") return see(`/s/${id}/`);

      if (rest === "/" && request.method === "GET") {
        const [view, left] = await Promise.all([stub.view(), lobby.left(Date.now())]);
        if (!view) return text("그런 무대가 없어요.", 404);
        return html(
          stagePage({ id, view, left, daily: DAILY, qa: env.QA_PUBLIC_URL, hostPin: env.QA_PIN, plantable: !!whereToPlant(request, env) }),
        );
      }
      if (rest === "/state" && request.method === "GET") {
        const [view, left] = await Promise.all([stub.view(), lobby.left(Date.now())]);
        return view ? json({ view, left }) : text("그런 무대가 없어요.", 404);
      }
      if (rest === "/cmd" && request.method === "POST") {
        const { line } = (await request.json().catch(() => ({}))) as { line?: unknown };
        const view = typeof line === "string" && line.trim() ? await stub.command(line.slice(0, 200)) : await stub.view();
        return view ? json({ view, left: await lobby.left(Date.now()) }) : text("그런 무대가 없어요.", 404);
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
        // 이 페이지가 심은 세션도 함께 거둔다 — 닫힌 무대의 쿠키를 부모 도메인에 남기지 않는다
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
