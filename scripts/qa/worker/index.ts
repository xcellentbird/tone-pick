/**
 * 무대 워커 — 컴퓨터 없이 온라인에서 QA 무대를 세운다 (슬라이스 35, ADR-97).
 *
 *   /                   무대 목록 · 새 무대 · 남은 횟수
 *   POST /new           무대를 세운다 → /s/<id>/
 *   /s/<id>/            리모컨 (CLI 의 페이지 그대로 + 참가자마다 여는 링크)
 *   /s/<id>/log · POST /s/<id>/cmd · POST /s/<id>/close
 *
 * **로그인이 없다** (S-B1, ADR-97 후기 4). 대신 한국 밖에서는 열리지 않고(QA 와 같은 국가 문, S-B3),
 * 무대 세우기와 명령에 **하루 상한**이 있다 (S-B2, `budget.ts`) — 계정의 하루 한도를 프로덕션과 같이 쓴다.
 * **표적은 설정 파일의 바인딩 `APP` 하나다** (S-A2) — 주소나 워커 이름을 받는 입력이 없다.
 * ⚠️ **경로나 본문을 받아 QA 로 그대로 넘기는 라우트를 만들지 마라** — 바인딩 요청에는 `cf` 가 없어
 * QA 의 국가 문을 안 타고, 하루 상한도 명령 한 줄 단위로만 센다. QA 를 부르는 말은 `core.mjs` 의 명령뿐이다.
 *
 * 앱 코드(`src/`)는 한 줄도 안 건드린다. 번호는 전부 가짜다.
 */
import { DAILY } from "./budget.ts";
import { PEOPLE_MAX, TABLES_MAX, lobbyOf, type Env } from "./stage-do.ts";

export { LobbyDO, StageDO } from "./stage-do.ts";

const PHASES = ["reg", "prevote", "party", "done"] as const;
const PHASE_NAME: Record<(typeof PHASES)[number], string> = {
  reg: "등록 중",
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
const see = (to: string) => new Response(null, { status: 303, headers: { location: to } });

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

/** 숫자 칸. 범위 밖이면 가까운 끝으로 — 폼을 손으로 고쳐 보내도 서브요청 상한을 못 넘긴다 */
const clamp = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

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
<style>
body{margin:0;padding:12px;font:16px/1.5 system-ui;background:#111;color:#eee}
h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:18px 0 6px}small{color:#9a9}a{color:#a29bfe}
label{display:block;margin:8px 0 2px;font-size:14px;color:#bbb}
select{width:100%;font-size:17px;padding:10px;border-radius:10px;border:1px solid #444;background:#222;color:#fff}
button{width:100%;margin-top:14px;font-size:17px;padding:13px;border-radius:10px;border:0;background:#6c5ce7;color:#fff}
ul{padding-left:18px}.err{color:#ff7675}
</style>
<h1>무대</h1><small>${qa}</small>
${error ? `<p class="err">${esc(error)}</p>` : ""}
<h2>열린 무대</h2><ul>${list}</ul>
<h2>새 무대</h2>
<form method="post" action="new" onsubmit="this.querySelector('button').disabled=true;this.querySelector('button').textContent='세우는 중… (몇 초 걸려요)'">
<label>가짜 참가자</label><select name="people">${opts(nums(2, PEOPLE_MAX), undefined, "6")}</select>
<label>단계</label><select name="phase">${opts(PHASES, PHASE_NAME, "reg")}</select>
<label>파티로 갈 때 테이블 수</label><select name="tables">${opts(nums(1, TABLES_MAX), undefined, "2")}</select>
<button>무대 세우기</button>
</form>
<p><small>남은 횟수: 무대 ${left.stage}번, 명령 ${left.command}번. 매일 오전 9시에 무대 ${DAILY.stage}번, 명령 ${DAILY.command}번으로 다시 채워져요.</small></p>
<p><small>로그인이 없어서 주소를 아는 사람은 누구나 쓸 수 있어요. 다른 사람이 세운 무대는 닫지 말아주세요.</small></p>
<p><small>번호는 전부 가짜예요. 무대를 닫으면 회차를 지우고, 12시간 동안 손대지 않은 무대는 저절로 닫혀요.</small></p>`);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (regionBlocked(request, env)) {
      return text("한국에서만 들어올 수 있어요.\n해외에 있거나 VPN 을 켜 두었다면 끄고 다시 열어주세요.", 403);
    }

    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/" && request.method === "GET") return lobbyPage(env);

    if (path === "/new" && request.method === "POST") {
      // 하루 상한 (S-B2). 세우는 도중에 실패해도 센다 — 그때도 QA 는 이미 불렸다
      const no = await lobbyOf(env).take("stage", Date.now());
      if (no) return lobbyPage(env, no);
      const form = await request.formData();
      const phase = String(form.get("phase") ?? "reg");
      const want = {
        people: clamp(form.get("people"), 2, PEOPLE_MAX, 6),
        phase: (PHASES as readonly string[]).includes(phase) ? phase : "reg",
        tables: clamp(form.get("tables"), 1, TABLES_MAX, 2),
      };
      const id = env.STAGE.newUniqueId();
      const res = await env.STAGE.get(id).build(want);
      if (!res.ok) return lobbyPage(env, `무대를 못 세웠어요 — ${res.message}`);
      await lobbyOf(env).add({ id: id.toString(), code: res.code, people: want.people, at: Date.now() });
      return see(`/s/${id.toString()}/`);
    }

    const m = /^\/s\/([0-9a-f]{64})(\/.*)?$/.exec(path);
    if (m) {
      const [, id, rest = ""] = m;
      // 목록에 없는 아이디로 빈 DO 를 깨우지 않는다
      if (!(await lobbyOf(env).has(id))) return text("그런 무대가 없어요.", 404);
      const stub = env.STAGE.get(env.STAGE.idFromString(id));
      if (rest === "") return see(`/s/${id}/`);
      if (rest === "/" && request.method === "GET") {
        const page = await stub.page();
        return page ? html(page) : text("그런 무대가 없어요.", 404);
      }
      if (rest === "/log" && request.method === "GET") return text(await stub.logText());
      if (rest === "/cmd" && request.method === "POST") {
        const { line } = (await request.json().catch(() => ({}))) as { line?: unknown };
        if (typeof line === "string" && line.trim()) await stub.command(line.slice(0, 200));
        return text("ok");
      }
      if (rest === "/close" && request.method === "POST") {
        await stub.close();
        return see("/");
      }
    }
    return text("없는 주소예요.", 404);
  },
} satisfies ExportedHandler<Env>;
