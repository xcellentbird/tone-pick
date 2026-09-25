/**
 * 스테이지 화면 — **한 탭에 운영자와 참가자 화면을 한꺼번에** (슬라이스 37, ADR-99).
 *
 * 화면은 전부 **진짜 QA 를 틀(iframe)로** 연다. 스테이지가 흉내 내 그리면 그 순간부터 진짜와 달라진다 (ADR-7).
 * 참가자 틀은 이름이 `tp.<이름표>` 라서 그 참가자로 뜨고(앱 `session.ts`), 세션 쿠키는 `/view` 가 심는다 —
 * **틀을 만들기 전에 심는다.** 운영자 틀은 쿠키를 안 심으므로 처음 한 번 운영자 PIN 을 친다 (`plant.ts`).
 *
 * **운영자는 늘 맨 왼쪽이다** — 빼지 못하고, 넓은 화면에서는 참가자 틀이 옆으로 흘러도 제자리에 붙어 있다.
 * 참가자는 위 단추로 고른다 — `MAX_SCREENS - 1` 명까지, 더 고르면 가장 먼저 고른 사람이 빠진다.
 * 이미 떠 있는 틀은 **옮기지 않는다** — 틀을 DOM 에서 옮기면 다시 읽혀서 보던 자리를 잃는다.
 *
 * **단계를 넘기는 단추는 두지 않는다** (슬라이스 37 S-A10) — 운영자 틀에 다 있다. 이 화면에는 운영자 화면에 없는
 * 것만 둔다: 볼 화면 고르기, 참가자 추가, 콕. 이 화면은 단계를 따로 기억해서 틀과 어긋나므로 단계를 보여 주지도 않는다.
 *
 * **폰에서는 한 화면씩 옆으로 넘긴다** (가로 스크롤 + 스냅). 앱은 가로로 스크롤하지 않아서 틀 속을 옆으로 밀어도
 * 그 밀기가 이 페이지로 넘어온다 — 크롬의 터치 에뮬레이션으로 앱의 머리 · 목록 · 탭바에서 확인했다.
 * 기기마다 다를 수 있어 **밀지 않고 가는 길**도 둔다: 맨 위 탭, 이름 줄의 ‹ ›. 앱을 도구에 맞추지 않는다 (ADR-99).
 *
 * ⚠️ **이 페이지는 스스로 다시 읽지 않는다** (S-A6). 틀들은 QA 의 실시간을 각자 듣고, 이 페이지의 상태 줄은
 * 명령을 친 뒤에만 바뀐다 — 명령의 답에 스테이지가 실려 온다. 켜 둔 탭이 몇 초마다 읽으면 하루에 한도를 혼자 넘는다.
 * 자동 콕의 `drain` 을 잇는 것은 다시 읽기가 아니다 — 누른 명령의 남은 몫이고, 줄이 줄지 않으면 멈춘다.
 *
 * 페이지 본문에는 **세션 토큰이 없다.** 이름표(비밀이 아니다)와 가짜 번호 · PIN 까지다.
 */
import type { StageView } from "./stage-do.ts";

/** 한 번에 띄우는 화면 수 — 운영자를 포함해서. 그 이상은 어느 것도 제대로 안 보인다 (옛 데모 뷰와 같은 판단, ADR-7) */
export const MAX_SCREENS = 4;

/** 이 폭 아래는 폰이다 — 한 화면씩 넘긴다 */
const NARROW = 760;

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
<title>스테이지 ${code}</title>
<link rel="icon" href="data:,">
<style>
:root{color-scheme:dark}
html,body{height:100%}
body{margin:0;height:100vh;height:100dvh;display:flex;flex-direction:column;overflow:hidden;font:14px/1.4 system-ui;background:#111;color:#eee}
a{color:#a29bfe}small,.dim{color:#9a9}
.top{flex:none;padding:6px 10px;display:flex;flex-direction:column;gap:6px;border-bottom:1px solid #333}
.bar{display:flex;gap:8px;align-items:center;min-width:0}
.bar b,.bar button{flex:none;white-space:nowrap}
.meta{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.grow{flex:1}
.status{font-size:13px;color:#b8f5c9;overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}
.status.bad{color:#ffb3b3}
.status:empty{display:none}
.panel{display:flex;flex-direction:column;gap:6px}
.top.closed .panel{display:none}
.row{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.row>b{min-width:48px;color:#aaa;font-weight:600}
button,select{font:inherit;color:#eee;background:#2a2a2a;border:1px solid #3a3a3a;border-radius:8px;padding:5px 9px}
button{cursor:pointer}button.main{background:#6c5ce7;border-color:#6c5ce7;color:#fff}
button.danger{background:#b33;border-color:#b33;color:#fff}
.strip{display:flex;gap:4px;overflow-x:auto;flex:1;min-width:0;padding-bottom:2px;scrollbar-width:thin}
.chip{padding:3px 8px;border-radius:999px;flex:none;white-space:nowrap}
.chip.m{box-shadow:inset 3px 0 #74b9ff}.chip.f{box-shadow:inset 3px 0 #fd79a8}
.chip.on{background:#6c5ce7;border-color:#6c5ce7;color:#fff}
.sep{width:1px;align-self:stretch;background:#333;margin:0 2px}
.warn{background:#5a3a00;color:#ffd;padding:6px 10px;border-radius:8px}
.pager{display:none;gap:4px;overflow-x:auto;scrollbar-width:none}
.pager button{flex:none;padding:5px 11px;border-radius:999px}
.pager button.on{background:#eee;border-color:#eee;color:#111}
.wall{flex:1;min-height:0;display:flex;gap:10px;padding:10px;overflow-x:auto;overflow-y:hidden;justify-content:safe center;overscroll-behavior-x:contain}
.screen{flex:1 0 320px;max-width:430px;display:flex;flex-direction:column;background:#000;border-radius:12px;overflow:hidden}
.screen.host{position:sticky;left:0;z-index:2;box-shadow:10px 0 14px -8px #000}
.screen header{flex:none;display:flex;gap:6px;align-items:center;min-height:34px;padding:0 8px;background:#1d1d1d;white-space:nowrap}
.screen header .name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
.screen header button{padding:2px 9px}
.screen .nav{display:none}
.screen:first-child .nav[data-step="-1"],.screen:last-child .nav[data-step="1"]{visibility:hidden}
.screen iframe{flex:1;border:0;width:100%;background:#fff}
body.busy .panel button,body.busy .panel select{opacity:.55;pointer-events:none}
@media (max-width:${NARROW}px){
.pager{display:flex}
.wall{padding:0;gap:0;justify-content:flex-start;scroll-snap-type:x mandatory}
.screen{flex:0 0 100%;max-width:none;border-radius:0;scroll-snap-align:start;scroll-snap-stop:always}
.screen.host{position:static;box-shadow:none}
.screen header{min-height:44px;gap:4px}
.screen .nav{display:block;font-size:18px;padding:0 12px}
}
</style>
<header class="top" id="top">
  <div class="bar">
    <b>스테이지 ${code}</b><span class="meta dim" id="meta"></span>
    <span class="grow"></span>
    <button type="button" id="panelBtn" aria-controls="panel" aria-expanded="true">메뉴</button>
  </div>
  <div class="status" id="status" role="status"></div>
  <div class="panel" id="panel">
    <div class="row"><b>화면</b><span class="dim">남</span><div class="strip" id="men"></div></div>
    <div class="row"><b></b><span class="dim">여</span><div class="strip" id="women"></div></div>
    <div class="row"><b>참가자</b>
      <button type="button" data-cmd="late m">남자 추가</button>
      <button type="button" data-cmd="late f">여자 추가</button>
    </div>
    <div class="row"><b>자동 콕</b>
      <button type="button" class="main" data-cmd="auto">자동 콕</button>
      <button type="button" class="main" data-cmd="auto last">마지막 자리 자동 콕</button>
    </div>
    <div class="row"><b>콕</b>
      <select id="from" aria-label="보내는 사람"></select> → <select id="to" aria-label="받는 사람"></select>
      <button type="button" data-poke="poke">콕</button>
      <button type="button" data-poke="unpoke">되돌리기</button>
      <button type="button" data-poke="mutual">서로 콕</button>
      <span class="sep"></span>
      <button type="button" id="crowdBtn">받는 사람에게 5명이 콕</button>
      <button type="button" data-cmd="pairs 3">서로 콕 3쌍</button>
    </div>
    <div class="row"><b></b><small id="left"></small><span class="grow"></span>
      <button type="button" id="reread">스테이지 새로고침</button>
      <a href="../../">목록</a>
      <form method="post" action="close" id="closeForm"><input type="hidden" name="planted" id="planted"><button class="danger">스테이지 닫기</button></form>
    </div>
    ${m.plantable ? "" : `<div class="warn">지금 주소로는 참가자 화면에 자동으로 로그인할 수 없어요. QA 와 같은 도메인에 있는 도구 주소로 열어주세요.</div>`}
  </div>
  <nav class="pager" id="pager" aria-label="화면"></nav>
</header>
<main class="wall" id="wall"></main>
<script type="application/json" id="model">${embed(m)}</script>
<script>
const M = JSON.parse(document.getElementById('model').textContent);
const $ = (s) => document.querySelector(s);
const MAX_PEOPLE = ${MAX_SCREENS - 1};
const narrow = matchMedia('(max-width:${NARROW}px)');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const who = (n) => M.view.cast.find((p) => p.n === n);
const label = (p) => p.n + ' ' + p.nickname + ' · ' + (p.gender === 'M' ? '남' : '여') + ' ' + p.age;

// 고른 참가자는 이 브라우저에만 기억한다 — 운영자는 늘 맨 왼쪽이라 고르는 대상이 아니다
const KEY = 'stage:' + M.id + ':views';
function remembered() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(v) ? v.filter((k) => k !== 'host' && who(k)).slice(-MAX_PEOPLE) : null;
  } catch { return null; }
}
function remember() { try { localStorage.setItem(KEY, JSON.stringify(people)); } catch {} }
function firstPair() {
  const m = M.view.cast.find((p) => p.gender === 'M'), f = M.view.cast.find((p) => p.gender === 'F');
  return [m && m.n, f && f.n].filter((k) => k !== undefined);
}
let people = remembered() || firstPair();
const order = () => ['host'].concat(people);
const planted = new Set();

/** 참가자 세션을 심고 거둔다. **틀을 만들기 전에** 끝나야 틀이 그 사람으로 뜬다 */
async function plant(show, hide) {
  if (!show.length && !hide.length) return;
  await fetch('view', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ show, hide }) }).catch(() => {});
  show.forEach((n) => planted.add(n)); hide.forEach((n) => planted.delete(n));
  $('#planted').value = [...planted].join(',');
}

function toggle(n) {
  const i = people.indexOf(n), hide = [];
  if (i >= 0) { people.splice(i, 1); hide.push(n); }
  else { people.push(n); if (people.length > MAX_PEOPLE) hide.push(people.shift()); }
  remember();
  const added = people.includes(n);
  plant(added ? [n] : [], hide).then(() => { renderWall(); renderChips(); renderPager(); pickDefaults(); if (added) go(n); });
}

/** 화면 단추. 남녀를 줄로 갈라 둘 다 늘 보이게 한다 — 100명이면 한 칸에 몰아 넣을 때 한쪽이 밑으로 숨었다 */
function renderChips() {
  const chip = (p) => {
    const on = people.includes(p.n);
    return '<button type="button" class="chip ' + (p.gender === 'M' ? 'm' : 'f') + (on ? ' on' : '') + '" aria-pressed="' + on + '" data-view="' + p.n + '">' + esc(p.n + ' ' + p.nickname) + '</button>';
  };
  $('#men').innerHTML = M.view.cast.filter((p) => p.gender === 'M').map(chip).join('');
  $('#women').innerHTML = M.view.cast.filter((p) => p.gender === 'F').map(chip).join('');
}

/** 틀. 이미 떠 있는 것은 그대로 둔다 — 옮기거나 다시 만들면 보던 자리를 잃는다. 운영자는 맨 앞에 한 번 */
const screens = new Map();
function frameFor(k) {
  const el = document.createElement('section');
  const p = k === 'host' ? null : who(k);
  el.className = p ? 'screen' : 'screen host';
  const name = p ? esc(label(p)) : '운영자 <small>PIN ' + esc(M.hostPin) + '</small>';
  el.innerHTML = '<header><button type="button" class="nav" data-step="-1" aria-label="이전 화면">‹</button>'
    + '<span class="name">' + name + '</span>'
    + '<button type="button" data-act="reload" title="이 화면 새로고침">↻</button>'
    + (p ? '<button type="button" data-act="drop" title="이 화면 닫기">✕</button>' : '')
    + '<button type="button" class="nav" data-step="1" aria-label="다음 화면">›</button></header>';
  const f = document.createElement('iframe');
  if (p) f.name = 'tp.' + p.ref;
  f.title = p ? label(p) : '운영자';
  f.src = p ? M.qa + '/e/' + M.view.event.code : M.qa + '/host/' + M.view.event.id;
  el.appendChild(f);
  el.querySelector('[data-act="reload"]').onclick = () => (p ? plant([k], []) : Promise.resolve()).then(() => { f.src = f.src; });
  const drop = el.querySelector('[data-act="drop"]');
  if (drop) drop.onclick = () => toggle(k);
  el.querySelectorAll('[data-step]').forEach((b) => { b.onclick = () => step(Number(b.dataset.step)); });
  return el;
}
function renderWall() {
  const wall = $('#wall');
  for (const [k, el] of screens) if (k !== 'host' && !people.includes(k)) { el.remove(); screens.delete(k); }
  if (!screens.has('host')) { const el = frameFor('host'); screens.set('host', el); wall.prepend(el); }
  for (const k of people) if (!screens.has(k)) { const el = frameFor(k); screens.set(k, el); wall.appendChild(el); }
}

// ── 폰: 한 화면씩. 탭은 지금 띄운 화면들이고, 지금 보는 것에 불이 들어온다
const wall = $('#wall');
const current = () => Math.max(0, Math.min(order().length - 1, Math.round(wall.scrollLeft / Math.max(1, wall.clientWidth))));
function go(k) {
  const i = order().indexOf(k);
  if (i >= 0 && narrow.matches) wall.scrollTo({ left: i * wall.clientWidth, behavior: 'smooth' });
}
function step(d) { const keys = order(); go(keys[Math.max(0, Math.min(keys.length - 1, current() + d))]); }
function renderPager() {
  $('#pager').innerHTML = order().map((k) => {
    const p = k === 'host' ? null : who(k);
    return '<button type="button" data-go="' + k + '">' + esc(p ? p.n + ' ' + p.nickname : '운영자') + '</button>';
  }).join('') + '<button type="button" data-open="panel">+ 화면 추가</button>';
  markPager();
}
function markPager() {
  const cur = current();
  document.querySelectorAll('#pager [data-go]').forEach((b, i) => {
    b.classList.toggle('on', i === cur);
    if (i === cur) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
  });
}
let raf = 0;
wall.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; markPager(); }); }, { passive: true });

function setPanel(open) {
  $('#top').classList.toggle('closed', !open);
  $('#panelBtn').setAttribute('aria-expanded', String(open));
  $('#panelBtn').textContent = open ? '메뉴 닫기' : '메뉴';
}

/** 보내는 사람 · 받는 사람 — 지금 보는 참가자 둘로 채운다. A 가 B 를 찌르고 B 의 화면을 보는 게 가장 흔하다 */
function renderSelects() {
  const opts = M.view.cast.map((p) => '<option value="' + p.n + '">' + esc(label(p)) + '</option>').join('');
  $('#from').innerHTML = opts; $('#to').innerHTML = opts;
}
function pickDefaults() {
  const shown = people.map(who).filter(Boolean);
  const a = shown[0] || M.view.cast[0];
  if (!a) return;
  const b = shown.find((p) => p.gender !== a.gender) || shown[1] || M.view.cast.find((p) => p.gender !== a.gender);
  $('#from').value = a.n;
  if (b) $('#to').value = b.n;
}

/** 상태 줄 — 마지막 명령이 남긴 말 한 줄. 로그 전체는 보이지 않는다 */
function status(text, bad) {
  const s = $('#status');
  s.textContent = text || ''; s.title = text || '';
  s.classList.toggle('bad', !!bad);
}
function lastSaid() {
  const line = (M.view.lines[M.view.lines.length - 1] || '').replace(/^\\d\\d:\\d\\d:\\d\\d\\s+/, '').trim();
  return line.startsWith('>') ? '' : line;
}

function apply(data) {
  const castChanged = data.view.cast.length !== M.view.cast.length;
  M.view = data.view; M.left = data.left;
  const men = M.view.cast.filter((p) => p.gender === 'M').length;
  $('#meta').textContent = '· 남 ' + men + ' · 여 ' + (M.view.cast.length - men);
  $('#left').textContent = '남은 QA 호출 ' + M.left.toLocaleString('ko-KR') + ' / ' + M.daily.toLocaleString('ko-KR');
  const said = lastSaid();
  status(said, /^[✗?]/.test(said));
  if (castChanged) { renderChips(); renderSelects(); pickDefaults(); }
}

let busy = false, isClosed = false;
function closed() {
  isClosed = true;
  document.body.classList.add('busy');
  status('스테이지가 닫혔어요. 목록으로 돌아가서 새로 만들어주세요.', true);
}
async function post(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  if (r.status === 404) { closed(); return null; }
  return r.json();
}
async function run(line) {
  if (busy || isClosed) return;
  busy = true; document.body.classList.add('busy'); status('…');
  try {
    let data = await post('cmd', { line });
    if (!data) return;
    apply(data);
    // 자동 콕이 한 요청의 몫을 넘으면 남은 줄을 이어 보낸다 — 줄이 줄지 않으면 멈춘다
    while (M.view.backlog > 0) {
      const before = M.view.backlog;
      data = await post('drain');
      if (!data) return;
      apply(data);
      if (M.view.backlog >= before) break;
    }
  } catch {
    status('✗ 도구 서버에 연결하지 못했어요. 다시 눌러주세요', true);
  } finally {
    busy = false;
    if (!isClosed) document.body.classList.remove('busy');
  }
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.view) return toggle(Number(t.dataset.view));
  if (t.dataset.go) return go(t.dataset.go === 'host' ? 'host' : Number(t.dataset.go));
  if (t.dataset.open) return setPanel(true);
  if (t.dataset.cmd) return run(t.dataset.cmd);
  if (t.dataset.poke) return run(t.dataset.poke + ' ' + $('#from').value + ' ' + $('#to').value);
});
$('#panelBtn').onclick = () => setPanel($('#top').classList.contains('closed'));
$('#crowdBtn').onclick = () => run('crowd ' + $('#to').value + ' 5');
$('#reread').onclick = async () => {
  const r = await fetch('state').catch(() => null);
  if (!r) return;
  if (r.status === 404) return closed();
  apply(await r.json());
};
$('#closeForm').onsubmit = () => confirm('회차 ' + M.view.event.code + '와 가짜 참가자 ' + M.view.cast.length + '명을 지우고 스테이지를 닫을까요? 되돌릴 수 없어요.');

renderChips(); renderSelects(); pickDefaults();
apply({ view: M.view, left: M.left });
// 폰에서는 메뉴를 접어 두고 틀에 자리를 준다
setPanel(!narrow.matches);
// 처음 뜰 때 지금 볼 참가자를 모두 심고 나서 틀을 만든다
plant(people, []).then(() => { renderWall(); renderPager(); });
</script>`;
}
