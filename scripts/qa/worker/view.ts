/**
 * 무대 화면 — **한 탭에 운영자와 참가자 화면을 한꺼번에** (슬라이스 37, ADR-99).
 *
 * 화면은 전부 **진짜 QA 를 틀(iframe)로** 연다. 무대가 흉내 내 그리면 그 순간부터 진짜와 달라진다 (ADR-7).
 * 참가자 틀은 이름이 `tp.<이름표>` 라서 그 참가자로 뜨고(앱 `session.ts`), 세션 쿠키는 `/view` 가 심는다 —
 * **틀을 만들기 전에 심는다.** 운영자 틀은 쿠키를 안 심으므로 처음 한 번 운영자 PIN 을 친다 (`plant.ts`).
 *
 * 위 단추로 볼 화면을 고른다 — 운영자를 포함해 `MAX_SCREENS` 개까지, 더 고르면 가장 먼저 고른 것이 빠진다.
 * 이미 떠 있는 틀은 **옮기지 않는다** — 틀을 DOM 에서 옮기면 다시 읽혀서 보던 자리를 잃는다.
 *
 * ⚠️ **이 페이지는 스스로 다시 읽지 않는다** (S-D3). 틀들은 QA 의 실시간을 각자 듣고, 이 페이지의 로그는
 * 명령을 친 뒤에만 바뀐다 — 명령의 답에 무대가 실려 온다. 켜 둔 탭이 몇 초마다 읽으면 하루에 한도를 혼자 넘는다.
 *
 * 페이지 본문에는 **세션 토큰이 없다.** 이름표(비밀이 아니다)와 가짜 번호 · PIN 까지다.
 */
import type { StageView } from "./stage-do.ts";

/** 한 번에 띄우는 화면 수. 그 이상은 어느 것도 제대로 안 보인다 (옛 데모 뷰와 같은 판단, ADR-7) */
export const MAX_SCREENS = 4;

interface PageModel {
  id: string;
  view: StageView;
  left: number;
  daily: number;
  qa: string;
  /** QA 의 공통 운영자 PIN — 설정 파일에 적힌 공개 값이다. 운영자 틀에 처음 한 번 친다 */
  hostPin: string;
  plantable: boolean;
}

/** `<script type="application/json">` 에 넣을 JSON — `</script>` 로 닫히지 않게 `<` 를 푼다 */
const embed = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

export function stagePage(m: PageModel): string {
  const code = m.view.event.code.replace(/[^0-9A-Za-z]/g, "");
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>무대 ${code} · QA 도구</title>
<link rel="icon" href="data:,">
<style>
html,body{height:100%}
body{margin:0;display:flex;flex-direction:column;font:14px/1.4 system-ui;background:#111;color:#eee}
a{color:#a29bfe}small,.dim{color:#9a9}
.top{padding:8px 12px;display:flex;flex-direction:column;gap:6px;border-bottom:1px solid #333}
.row{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.row>b{min-width:34px;color:#aaa;font-weight:600}
.grow{flex:1}
button,select,input{font:inherit;color:#eee;background:#2a2a2a;border:1px solid #3a3a3a;border-radius:8px;padding:5px 9px}
button{cursor:pointer}button.main{background:#6c5ce7;border-color:#6c5ce7;color:#fff}
button.danger{background:#b33;border-color:#b33;color:#fff}
.strip{display:flex;gap:4px;overflow-x:auto;flex:1;min-width:0;padding-bottom:2px;scrollbar-width:thin}
.chip{padding:3px 8px;border-radius:999px;flex:none;white-space:nowrap}
.chip.m{box-shadow:inset 3px 0 #74b9ff}.chip.f{box-shadow:inset 3px 0 #fd79a8}
.chip.on{background:#6c5ce7;border-color:#6c5ce7;color:#fff}
.sep{width:1px;align-self:stretch;background:#333;margin:0 4px}
.warn{background:#5a3a00;color:#ffd;padding:6px 10px;border-radius:8px}
.wall{flex:1;display:flex;gap:10px;padding:10px;overflow-x:auto;justify-content:safe center;min-height:520px}
.screen{flex:1 1 0;min-width:320px;max-width:430px;display:flex;flex-direction:column;background:#000;border-radius:12px;overflow:hidden}
.screen header{display:flex;gap:6px;align-items:center;padding:5px 8px;background:#1d1d1d}
.screen header button{padding:2px 7px}
.screen iframe{flex:1;border:0;width:100%;background:#fff}
.empty{align-self:center;color:#9a9}
details{border-top:1px solid #333;padding:6px 12px}
summary{cursor:pointer;color:#bbb}
pre{background:#000;padding:8px;border-radius:8px;font-size:12px;white-space:pre-wrap;max-height:28vh;overflow:auto;margin:6px 0}
table{border-collapse:collapse;font-size:12px}td{padding:3px 8px;border-bottom:1px solid #2a2a2a}
body.busy .top button,body.busy .top select{opacity:.55;pointer-events:none}
@media (max-width:760px){.wall{flex-direction:column;align-items:stretch}.screen{max-width:none;min-height:82vh}}
</style>
<div class="top">
  <div class="row">
    <b>무대 ${code}</b><span id="phase" class="dim"></span><span id="count" class="dim"></span>
    <span class="grow"></span>
    <small id="left"></small>
    <button type="button" id="reread">다시 읽기</button>
    <a href="../../">목록</a>
    <form method="post" action="close" id="closeForm" onsubmit="return confirm('회차 ${code} 를 지우고 무대를 닫을까요? 되돌릴 수 없어요.')">
      <input type="hidden" name="planted" id="planted"><button class="danger">닫기 · 회차 삭제</button>
    </form>
  </div>
  <div class="row"><b>단계</b>
    <button type="button" data-cmd="phase prevote">매력 투표 시작</button>
    <button type="button" data-cmd="voteend">투표 마감</button>
    <button type="button" id="seatBtn">자리 짜기</button>
    <button type="button" data-cmd="publish">자리 발행</button>
    <button type="button" data-cmd="shuffle">자리 섞기</button>
    <button type="button" data-cmd="phase party">파티 시작</button>
    <button type="button" data-cmd="phase done">커플 발표</button>
    <span class="sep"></span>
    <button type="button" data-cmd="late">늦게 온 사람</button>
  </div>
  <div class="row"><b>화면</b><button type="button" class="chip" data-view="host">운영자</button><span class="sep"></span><span class="dim">남</span><div class="strip" id="men"></div></div>
  <div class="row"><b></b><span class="dim">여</span><div class="strip" id="women"></div></div>
  <div class="row"><b>콕</b>
    <select id="from" aria-label="보내는 사람"></select> → <select id="to" aria-label="받는 사람"></select>
    <button type="button" class="main" data-poke="poke">콕</button>
    <button type="button" data-poke="unpoke">되돌리기</button>
    <button type="button" data-poke="mutual">서로 콕</button>
    <span class="sep"></span>
    <button type="button" data-cmd="spray 20">콕 뿌리기 20번</button>
    <button type="button" id="crowdBtn">받는 사람에게 5명이 콕</button>
    <button type="button" data-cmd="pairs 3">서로 콕 3쌍</button>
  </div>
  ${m.plantable ? "" : `<div class="warn">이 주소로 연 도구는 참가자 화면에 자동으로 들어갈 수 없어요. QA 와 같은 사이트의 도구 주소로 열어주세요.</div>`}
</div>
<main class="wall" id="wall"></main>
<details id="more"><summary>로그 · 명령 · 배역표</summary>
  <form id="cmdForm" class="row"><input id="cmd" class="grow" placeholder="poke 3 5 · crowd 2 8 · seating 4 · help" autocomplete="off" autocapitalize="off"><button class="main">실행</button></form>
  <pre id="log"></pre>
  <table id="cast"></table>
</details>
<script type="application/json" id="model">${embed(m)}</script>
<script>
const M = JSON.parse(document.getElementById('model').textContent);
const $ = (s) => document.querySelector(s);
const MAX = ${MAX_SCREENS};
const PHASE = { reg: '등록 중', prevote: '매력 투표', party: '파티', done: '발표 뒤' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const who = (n) => M.view.cast.find((p) => p.n === n);
const label = (p) => p.n + ' ' + p.nickname + ' · ' + (p.gender === 'M' ? '남' : '여') + ' ' + p.age;

// 고른 화면은 이 브라우저에만 기억한다 — 새로 고쳐도 같은 화면으로 (없어도 처음 셋으로 뜬다)
const KEY = 'stage:' + M.id + ':views';
function remembered() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(v) ? v.filter((k) => k === 'host' || who(k)).slice(-MAX) : null;
  } catch { return null; }
}
function remember() { try { localStorage.setItem(KEY, JSON.stringify(views)); } catch {} }
function firstThree() {
  const m = M.view.cast.find((p) => p.gender === 'M'), f = M.view.cast.find((p) => p.gender === 'F');
  return ['host', m && m.n, f && f.n].filter((k) => k !== undefined);
}
let views = remembered() || firstThree();
const planted = new Set();

/** 참가자 세션을 심고 거둔다. **틀을 만들기 전에** 끝나야 틀이 그 사람으로 뜬다 */
async function plant(show, hide) {
  show = show.filter((n) => n !== 'host'); hide = hide.filter((n) => n !== 'host');
  if (!show.length && !hide.length) return;
  await fetch('view', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ show, hide }) }).catch(() => {});
  show.forEach((n) => planted.add(n)); hide.forEach((n) => planted.delete(n));
  $('#planted').value = [...planted].join(',');
}

function toggle(k) {
  const i = views.indexOf(k), hide = [];
  if (i >= 0) { views.splice(i, 1); hide.push(k); }
  else { views.push(k); if (views.length > MAX) hide.push(views.shift()); }
  remember();
  plant(views.includes(k) ? [k] : [], hide).then(() => { renderWall(); renderChips(); pickDefaults(); });
}

/** 화면 단추. 남녀를 줄로 갈라 둘 다 늘 보이게 한다 — 100명이면 한 칸에 몰아 넣을 때 한쪽이 밑으로 숨었다 */
function renderChips() {
  const chip = (p) => '<button type="button" class="chip ' + (p.gender === 'M' ? 'm' : 'f') + (views.includes(p.n) ? ' on' : '') + '" data-view="' + p.n + '">' + esc(p.n + ' ' + p.nickname) + '</button>';
  const men = M.view.cast.filter((p) => p.gender === 'M'), women = M.view.cast.filter((p) => p.gender === 'F');
  $('#men').innerHTML = men.map(chip).join('');
  $('#women').innerHTML = women.map(chip).join('');
  document.querySelector('[data-view="host"]').classList.toggle('on', views.includes('host'));
  $('#count').textContent = '· 남 ' + men.length + ' · 여 ' + women.length;
}

/** 틀. 이미 떠 있는 것은 그대로 둔다 — 옮기거나 다시 만들면 보던 자리를 잃는다 */
const screens = new Map();
function frameFor(k) {
  const el = document.createElement('section');
  el.className = 'screen';
  const p = k === 'host' ? null : who(k);
  const title = p ? esc(label(p)) : '운영자 <small>· 처음 한 번 PIN ' + esc(M.hostPin) + '</small>';
  el.innerHTML = '<header><span class="grow">' + title + '</span><button type="button" title="이 화면 다시 읽기">↻</button><button type="button" title="이 화면 빼기">✕</button></header>';
  const f = document.createElement('iframe');
  if (p) f.name = 'tp.' + p.ref;
  f.src = p ? M.qa + '/e/' + M.view.event.code : M.qa + '/host/' + M.view.event.id;
  el.appendChild(f);
  const [reload, drop] = el.querySelectorAll('header button');
  reload.onclick = () => (p ? plant([k], []) : Promise.resolve()).then(() => { f.src = f.src; });
  drop.onclick = () => toggle(k);
  return el;
}
function renderWall() {
  const wall = $('#wall');
  for (const [k, el] of screens) if (!views.includes(k)) { el.remove(); screens.delete(k); }
  for (const k of views) if (!screens.has(k)) { const el = frameFor(k); screens.set(k, el); wall.appendChild(el); }
  wall.querySelector('.empty')?.remove();
  if (!views.length) wall.insertAdjacentHTML('beforeend', '<p class="empty">위에서 볼 화면을 골라주세요.</p>');
}

/** 보내는 사람 · 받는 사람 — 지금 보는 참가자 둘로 채운다. A 가 B 를 찌르고 B 의 화면을 보는 게 가장 흔하다 */
function renderSelects() {
  const opts = M.view.cast.map((p) => '<option value="' + p.n + '">' + esc(label(p)) + '</option>').join('');
  $('#from').innerHTML = opts; $('#to').innerHTML = opts;
}
function pickDefaults() {
  const shown = views.filter((k) => k !== 'host').map(who).filter(Boolean);
  const a = shown[0] || M.view.cast[0];
  if (!a) return;
  const b = shown.find((p) => p.gender !== a.gender) || shown[1] || M.view.cast.find((p) => p.gender !== a.gender);
  if (a) $('#from').value = a.n;
  if (b) $('#to').value = b.n;
}

function apply(data) {
  const castChanged = data.view.cast.length !== M.view.cast.length;
  M.view = data.view; M.left = data.left;
  $('#phase').textContent = '· ' + (PHASE[M.view.phase] || M.view.phase);
  $('#left').textContent = '남은 QA 호출 ' + M.left.toLocaleString('ko-KR') + ' / ' + M.daily.toLocaleString('ko-KR');
  $('#seatBtn').textContent = '자리 짜기 (' + M.view.tables + '테이블)';
  const log = $('#log');
  log.textContent = M.view.lines.join('\\n');
  log.scrollTop = log.scrollHeight;
  $('#cast').innerHTML = '<tr><td>번호</td><td>닉네임</td><td>성별 나이</td><td>전화번호</td><td>PIN</td></tr>'
    + M.view.cast.map((p) => '<tr><td>' + p.n + '</td><td>' + esc(p.nickname) + '</td><td>' + (p.gender === 'M' ? '남' : '여') + ' ' + p.age + '</td><td>' + esc(p.phone) + '</td><td>' + esc(p.pin) + '</td></tr>').join('');
  if (castChanged) { renderChips(); renderSelects(); pickDefaults(); }
}

let busy = false;
function closed() {
  document.body.classList.add('busy');
  $('#log').textContent = '무대가 닫혔어요. 목록으로 돌아가 새로 세워주세요.';
  $('#more').open = true;
}
async function run(line) {
  if (busy) return;
  busy = true; document.body.classList.add('busy');
  try {
    const r = await fetch('cmd', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ line }) });
    if (r.status === 404) return closed();
    apply(await r.json());
  } catch {
    $('#log').textContent += '\\n  ✗ 도구에 닿지 못했어요 — 다시 눌러주세요';
  } finally {
    busy = false; if (!$('#log').textContent.startsWith('무대가 닫혔어요')) document.body.classList.remove('busy');
  }
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.view) return toggle(t.dataset.view === 'host' ? 'host' : Number(t.dataset.view));
  if (t.dataset.cmd) return run(t.dataset.cmd);
  if (t.dataset.poke) return run(t.dataset.poke + ' ' + $('#from').value + ' ' + $('#to').value);
});
$('#seatBtn').onclick = () => run('seating ' + M.view.tables);
$('#crowdBtn').onclick = () => run('crowd ' + $('#to').value + ' 5');
$('#reread').onclick = async () => {
  const r = await fetch('state').catch(() => null);
  if (!r) return;
  if (r.status === 404) return closed();
  apply(await r.json());
};
$('#cmdForm').onsubmit = (e) => { e.preventDefault(); const v = $('#cmd').value.trim(); if (v) run(v); $('#cmd').value = ''; };

renderChips(); renderSelects(); pickDefaults();
apply({ view: M.view, left: M.left });
// 처음 뜰 때 지금 볼 참가자를 모두 심고 나서 틀을 만든다
plant(views, []).then(renderWall);
</script>`;
}
