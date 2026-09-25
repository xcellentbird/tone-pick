/**
 * 스테이지의 핵심 — 가짜 참가자 · 명령 · 리모컨 페이지 (슬라이스 35, ADR-97).
 *
 * **CLI(`stage.mjs`)와 스테이지 워커(`worker/`)가 이 파일 하나를 같이 쓴다.** 그래서 여기에는
 * `node:` 모듈도 `process` 도 없다 — 워커 안에서도 돌아야 한다. 밖과 닿는 길은 넷뿐이고 전부
 * 부르는 쪽이 넣어 준다:
 *
 *   fetch       QA 를 부르는 길. CLI 는 전역 `fetch`, 워커는 서비스 바인딩(`env.APP.fetch`)
 *   base        그 요청의 주소 머리. 워커는 바인딩이라 아무 호스트나 된다(`https://app`)
 *   publicBase  **사람에게 보여 줄** 주소 머리 — 참가 링크·운영자 주소. 없으면 `base`
 *   log         `createLog()` 가 만든 것. 터미널과 리모컨이 같은 줄을 본다
 *
 * 그리고 `batch` — 자동 콕을 명령 하나에 몇 번까지 보내나. 워커는 요청 하나의 몫이 있어 `BULK_MAX` 씩
 * 나눠 보내고(`drain`), CLI 는 한 번에 다 보낸다.
 *
 * ⚠️ **표적을 고르는 입력을 여기 두지 마라** (S-A2). `base` 는 부르는 쪽의 설정이 정한다 —
 * 명령(`run`)이 주소나 워커 이름을 받는 순간 공개된 워커에서 프로덕션을 겨눌 수 있다.
 * ⚠️ **경로를 받아 QA 로 넘기는 명령도 두지 마라** — 스테이지 워커가 국가 문 우회로가 된다 (ADR-97 후기).
 * QA 를 부르는 경로는 아래 `run` 의 갈래에 박힌 것뿐이다.
 *
 * **전부 공개 API 다** (ADR-7 후기). 앱에 시연 코드를 넣지 않는다 — 가짜 참가자는 실제 경로
 * (`/enter` → `/register`)로 등록하고, 사람마다 세션 쿠키를 따로 든다. **번호는 전부 가짜다.**
 */

/** 가짜 참가자의 PIN 번호. 모두 같다 — 회차마다, 사람마다 따로라 같아도 된다 */
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
 * 스테이지를 만든 시각의 끝 네 자리로 스테이지끼리 갈라, 동시에 있는 두 스테이지가 같은 번호를 쓰지 않게 한다.
 */
const fakePhone = (stamp, n) => `010${String(stamp).slice(-4)}${String(n).padStart(4, "0")}`;

/**
 * 회차 설정 기본값. 앱 기본에 알림만 켠 것 — 받은 콕이 방송으로 닿는 순간을 보는 게 QA 의 절반이라.
 *
 * ⚠️ **횟수·장 수는 앱 기본값(`DEFAULTS`)과 같아야 한다.** 이 파일은 `.ts` 를 못 불러와서
 * 숫자를 옮겨 적는다 — 어긋나면 `35-stage-core` 의 `횟수와 장 수는 앱 기본값이다` 가 빨개진다.
 * 익명 쪽지(`maxNotes`)가 빠져 있어서 스테이지 회차만 쪽지가 0장이었다 — 서버는 값이 없으면
 * 0 으로 읽고, 참가자 프로필 시트에 `익명 쪽지 쓰기` 가 아예 없었다.
 */
export const STAGE_CONFIG = { maxPre: 1, maxParty: 2, maxNotes: 2, preNotify: true, pokeNotify: true };

// ─────────────────────────────────────────── 난수 — 스테이지마다 같은 것

/** 문자열 → 32비트 (FNV-1a). 씨앗을 섞는 데만 쓴다 */
function hash32(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * 씨앗 하나로 도는 난수 (mulberry32). **같은 씨앗이면 같은 수열이다** — 스테이지가 만든 시각을 씨앗으로 쓰면
 * 명령을 여러 번 쳐도 같은 사람이 같은 인기 · 같은 성향으로 남는다.
 */
export function seeded(seed) {
  let a = hash32(String(seed));
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(xs, rng = Math.random) {
  const out = xs.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ─────────────────────────────────────────── 나이 — 남녀를 따로 (슬라이스 37)

/** 앱이 받는 나이. `src/shared/constants.ts` 의 `AGE_RANGE` 와 같아야 한다 (테스트가 맞춰 본다) */
export const AGE_LIMIT = { min: 18, max: 48 };

/** 스테이지를 만들 때 고르지 않으면 이 나이로 — 평균과 범위 */
export const STAGE_AGES = { M: { avg: 28, min: 24, max: 34 }, F: { avg: 26, min: 22, max: 31 } };

/**
 * 나이 칸을 앱이 받는 범위 안으로 — 최소 ≤ 평균 ≤ 최대. 최소와 최대가 거꾸로 오면 바꾸고,
 * 평균이 범위 밖이면 가까운 끝으로. 빈 칸은 `fallback` 의 값이다.
 */
export function ageRange(given, fallback) {
  const age = (v, d) => {
    const x = typeof v === "number" || (typeof v === "string" && v.trim()) ? Math.round(Number(v)) : NaN;
    return Number.isFinite(x) ? Math.min(AGE_LIMIT.max, Math.max(AGE_LIMIT.min, x)) : d;
  };
  let min = age(given?.min, fallback.min);
  let max = age(given?.max, fallback.max);
  if (min > max) [min, max] = [max, min];
  return { avg: Math.min(max, Math.max(min, age(given?.avg, fallback.avg))), min, max };
}

/**
 * 나이 분포의 분위수 `u ∈ [0, 1)`. 최소~평균, 평균~최대의 두 삼각형을 평균에서 맞붙였다 —
 * **평균 근처가 가장 많고, 기댓값이 정확히 평균이다.** 왼쪽 몫 `p` 가 그것을 맞춘다
 * (왼쪽 삼각형의 평균은 평균에서 (평균−최소)/3 아래, 오른쪽은 (최대−평균)/3 위).
 */
function ageAt(u, { avg, min, max }) {
  if (max <= min) return min;
  const p = (max - avg) / (max - min);
  if (u < p) return min + (avg - min) * Math.sqrt(u / p);
  return max - (max - avg) * Math.sqrt((1 - u) / (1 - p));
}

/**
 * 한 성별의 나이 `count` 개. 분위수를 고르게 찍어서(무작위로 뽑지 않는다) **적은 인원에서도 평균이 맞는다.**
 * 반올림에 어긋난 합은 가장 많이 깎인 것부터 한 살씩 돌려준다. 순서는 섞는다 — 번호 순서가 나이 순서면 어색하다.
 */
export function spreadAges(count, range, rng = Math.random) {
  const raw = Array.from({ length: count }, (_, i) => ageAt((i + 0.5) / count, range));
  const ages = raw.map((x) => Math.floor(x));
  let off = Math.round(range.avg * count) - ages.reduce((a, b) => a + b, 0);
  const byLoss = raw.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]).map(([, i]) => i);
  // 평균이 범위 안이라 합은 언제나 맞출 수 있다 — 돌 횟수는 그 끝까지
  const rounds = count * (range.max - range.min + 1);
  for (let i = 0; off > 0 && i < rounds; i++) {
    const j = byLoss[i % count];
    if (ages[j] < range.max) ages[j]++, off--;
  }
  for (let i = 0; off < 0 && i < rounds; i++) {
    const j = byLoss[count - 1 - (i % count)];
    if (ages[j] > range.min) ages[j]--, off++;
  }
  return shuffle(ages, rng);
}

// ─────────────────────────────────────────── 자동 콕 — 실제 파티처럼 (슬라이스 37)

/**
 * 자동 콕의 모양. 운영자가 실제 파티에서 본 것이다 (2026-09-25):
 *
 *   남자  거의 모두가 콕을 다 쓰고, **몇몇 여자에게 몰린다**
 *   여자  절반쯤은 안 쓰거나 덜 쓴다. 역시 몇몇에게 모이지만 **남자보다 두 배 넓게** 흩어진다
 *   때    뒤로 갈수록 많이 찌르고, **마지막에 가장 많다**
 *
 * 몰림은 **유효 인원**(1/Σp², 받은 콕의 몫 p)으로 잰다 — 콕이 이성 몇 명에게 고르게 간 것과 같은가.
 * `spread` 는 그것이 이성 수의 몇 몫인가다. 받는 쪽의 인기는 1/순위^s 이고, s 는 그 몫이 맞게 고른다.
 *
 * **때는 누른 횟수로 센다** (ADR-99 후기 6). 한 번 누르면 파티가 한 칸 흐르고, `AUTO_STEPS` 번이면 쓰려던 콕을 다 쓴다.
 * 칸마다 쓰는 몫이 1 : 2 : … : `AUTO_STEPS` 라 뒤로 갈수록 많다. 처음에는 자리 라운드로 셌는데, 한 라운드에서 여러 번
 * 누르면 남은 것의 8% 씩만 나와서 6+6 에서는 누를수록 줄었고 세 번에 한 번꼴로 아무것도 안 나왔다.
 */
/** 자동 콕을 몇 번 누르면 쓰려던 콕을 다 쓰나 — 한 번이 파티의 한 칸이다 */
export const AUTO_STEPS = 5;

const AUTO_POKE = {
  /** 마음먹은 만큼 — 다 쓴다(`full`) · 반만 쓴다(`half`) · 나머지는 안 쓴다 */
  habit: { M: { full: 0.92, half: 0.05 }, F: { full: 0.5, half: 0.25 } },
  /**
   * 인기 가중치의 유효 인원이 이성 수의 몇 몫인가. 남자 쪽이 두 배보다 조금 좁은 것은 **한 사람이 같은 상대를
   * 두 번 안 찌르기 때문이다** — 몰린 쪽일수록 그 때문에 더 퍼져서, 실제로 받은 콕의 유효 인원은
   * 여자가 남자의 두 배가 된다 (이성 12~50명에서 2.0~2.1, 테스트가 잰다).
   */
  spread: { M: 0.27, F: 0.6 },
};

/** 이 사람이 이 라운드에 쓰려는 콕 수 — 스테이지마다, 사람마다, 라운드마다 정해져 있다 (씨앗) */
function intentOf(seed, round, p, max) {
  const { full, half } = AUTO_POKE.habit[p.gender];
  const u = seeded(`${seed}:habit:${round}:${p.n}`)();
  return u < full ? max : u < full + half ? Math.floor(max / 2) : 0;
}

const effective = (w) => {
  const sum = w.reduce((a, b) => a + b, 0);
  return (sum * sum) / w.reduce((a, b) => a + b * b, 0);
};
const zipf = (count, s) => Array.from({ length: count }, (_, r) => 1 / Math.pow(r + 1, s));

/** 인기 순서대로의 가중치 — 유효 인원이 `share × count` 가 되게 (1 과 count 사이) */
function appealWeights(count, share) {
  if (count <= 0) return [];
  const target = Math.max(1, Math.min(count, share * count));
  let lo = 0;
  let hi = 40;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (effective(zipf(count, mid)) > target) lo = mid;
    else hi = mid;
  }
  return zipf(count, (lo + hi) / 2);
}

/**
 * 자동 콕 한 번의 계획 — `[보내는 사람 번호, 받는 사람 번호]` 의 목록. **QA 를 부르지 않는 순수 함수**다.
 *
 * 사람마다 이번 라운드에 쓰려는 수(`intentOf`)가 있다. `step` 번째 칸까지는 모두가 쓰려던 콕의 1 : 2 : … : `AUTO_STEPS`
 * 몫이 나와 있어야 하고, 이미 나온 수(`used` — 손으로 찌른 것까지)에 모자란 만큼을 남은 콕 가운데 무작위로 고른다.
 * 그래서 한 판 안에서도 누를수록 많고, 끝까지 누르면 쓰려던 것을 다 쓴다. 쓰려던 것이 남아 있으면 **적어도 하나는
 * 새로 나온다** — 몫이 이미 찼어도(손으로 많이 찔렀어도). 받는 사람은 이성 중에서 인기 가중치로 뽑되, 한 사람이 같은
 * 상대를 두 번 찌르지 않는다(`history` — 앞선 자동 콕). 매력 투표도 같다.
 *
 * @param {object} a
 * @param {{ n: number, gender: "M" | "F" }[]} a.cast   지금 회차에 있는 가짜 참가자
 * @param {Record<number, number>} [a.used]  번호 → 이 라운드에 이미 쓴 콕
 * @param {number} a.max       한 사람의 상한 (이 라운드)
 * @param {"pre" | "party"} a.round
 * @param {number} [a.step]    몇 번째 누름인가 (1부터, `AUTO_STEPS` 에서 멈춘다)
 * @param {boolean} [a.last]   남은 것을 한 번에 — 마지막 칸으로 간다
 * @param {unknown} a.seed     스테이지의 씨앗 — 인기와 성향이 여기서 정해진다
 * @param {() => number} [a.rng]  이번 판의 난수
 * @param {Record<number, number[]>} [a.history]  번호 → 앞서 자동으로 찌른 상대
 * @returns {[number, number][]}
 */
export function planPokes({ cast, used = {}, max, round, step = 1, last = false, seed, rng = Math.random, history = {} }) {
  const appeal = new Map(cast.map((p) => [p.n, seeded(`${seed}:appeal:${p.n}`)()]));
  const pool = (g) => {
    const targets = cast.filter((q) => q.gender !== g).sort((a, b) => appeal.get(b.n) - appeal.get(a.n));
    return { targets, weights: appealWeights(targets.length, AUTO_POKE.spread[g]) };
  };
  const pools = { M: pool("M"), F: pool("F") };
  const at = last ? AUTO_STEPS : Math.min(AUTO_STEPS, Math.max(1, step));
  // 남은 콕 하나하나 — 사람마다 쓰려던 수에서 이미 쓴 수를 뺀 만큼 그 사람이 들어간다
  const slots = [];
  let total = 0;
  let spent = 0;
  for (const p of cast) {
    const intent = intentOf(seed, round, p, max);
    const done = Math.min(intent, used[p.n] ?? 0);
    total += intent;
    spent += done;
    for (let i = done; i < intent; i++) slots.push(p);
  }
  // 이번 칸까지 나와 있어야 할 수 — 마지막 칸이면 전부다
  const target = Math.round((total * at * (at + 1)) / (AUTO_STEPS * (AUTO_STEPS + 1)));
  /** 사람 → 이번에 보낼 수 */
  const due = new Map();
  for (const p of shuffle(slots, rng).slice(0, Math.max(1, target - spent))) due.set(p, (due.get(p) ?? 0) + 1);
  const plan = [];
  for (const [p, count] of due) {
    const { targets, weights } = pools[p.gender];
    const taken = new Set(history[p.n] ?? []);
    for (let i = 0; i < count; i++) {
      // 아직 안 찌른 사람 중에서 — 다 찔렀으면 누구든 (앱은 같은 상대를 또 찌를 수 있다)
      let idx = targets.map((t, j) => (taken.has(t.n) ? -1 : j)).filter((j) => j >= 0);
      if (!idx.length) idx = targets.map((_, j) => j);
      if (!idx.length) break;
      let r = rng() * idx.reduce((s, c) => s + weights[c], 0);
      const j = idx.find((c) => (r -= weights[c]) < 0) ?? idx[idx.length - 1];
      taken.add(targets[j].n);
      plan.push([p.n, targets[j].n]);
    }
  }
  // 한 사람이 몰아 보내지 않게 섞는다 — 틀 속 화면에 콕이 여기저기서 도착한다
  return shuffle(plan, rng);
}

/** 이 스테이지가 끝났을 때 남는 줄 수. 리모컨은 그중 뒤 60줄을 본다 (S-D3) */
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

/** 스테이지를 만들지 못했다. `code` 로 부르는 쪽이 자기 말로 바꿔 말한다 (CLI 는 터미널 안내를 붙인다) */
export class StageError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * 쿠키를 손으로 들고 다니는 HTTP 클라이언트. **사람마다 하나** — 세션이 달라야 하니 한 통을 못 쓴다.
 * `onSkew` 로 서버 시각과의 차이를 스테이지에 알린다 (`schedule +30s` 가 서버 시계로 잰다).
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

/** 어느 스테이지에나 있는 명령. 스테이지마다 더하는 것(창 벽 등)은 부르는 쪽이 `help` 에 덧붙인다 */
export const HELP = `
  cast                    가짜 참가자 명단 (번호, 닉네임, 성별, 전화번호, PIN)
  state                   회차 단계 · 콕 수 · 자리 라운드
  poke A B  /  unpoke A B  A가 B를 콕 (프로필 투표 중이면 표, 파티 중이면 콕) · 되돌리기
  mutual A B              A→B, B→A 를 한 번에
  phase reg|prevote|party|done      단계 넘기기 (done = 매칭 확인)
  seating T [-x A,B]      자리 초안 (T 테이블, -x 뺄 사람) · publish · shuffle · swap A B · seat A · unseat A · discard
  announce 문구 [| 보기A | 보기B]   운영자 공지 (보기 둘을 주면 설문)
  auto [last]             자동 콕 — 실제 파티처럼. 남자는 대부분 다 쓰고 콕이 여자 몇 명에게 몰린다. 여자는 절반 정도가
                          안 쓰거나 일부만 쓰고 두 배 넓게 나눠 찌른다. 누를 때마다 새 콕이 나오고 뒤로 갈수록 많다.
                          ${AUTO_STEPS}번이면 쓰려던 것을 다 쓴다. last 는 남은 것을 한 번에
  spray [N]               콕 뿌리기 — 남은 콕을 아무 이성에게 N번 (기본 20, 많아야 40)
  crowd A [N]             콕 모으기 — A 에게 이성 N명이 한 번씩 (기본 5)
  pairs [N]               서로 콕 N쌍 — 남녀를 무작위로 짝지어 (기본 3, 많아야 10)
  late [m|f]              참가자 한 명 추가 (m 은 남자, f 는 여자, 안 주면 적은 쪽)
  kick A · pinreset A     참가자 삭제 · PIN 번호 초기화
  lock A                  A 의 번호로 PIN 을 다섯 번 틀린다 (잠금 재현)
  schedule prevote|party|reveal +30s|+5m   예약 시각을 지금부터 N 뒤로
  url A|host              참가 링크 · 번호 · PIN
  delete                  회차 삭제
`;

/**
 * 어떤 스테이지에는 없는 명령 (S-C4). **조용히 무시하지 않는다** — 그러면 명령을 잘못 친 줄 안다.
 * 스테이지가 `platform` 으로 직접 맡으면 그쪽이 먼저다.
 */
const ELSEWHERE = new Set(["open", "close", "snap", "now", "keep", "quit", "exit"]);

/** 명령 하나가 QA 를 부를 수 있는 횟수의 끝. 한 요청의 서브요청 상한(무료 50) 아래에 둔다 — 묶음 명령이 이걸 넘지 않는다 */
export const BULK_MAX = 40;

/**
 * 등록과 자동 콕은 QA 를 이만큼까지 겹쳐 부른다 (ADR-99 후기 7). 차례로 부르면 콕마다 QA 가 콕 로그 파일을
 * R2 에 다시 쓰는 것(ADR-84)을 기다려서 그 기다림이 콕 수만큼 쌓였다. 겹치면 기다림이 겹치고, QA 는 쓰는 동안
 * 들어온 줄을 모아 한 번에 쓴다. **부르는 횟수는 그대로다** — 하루 상한도 `BULK_MAX` 도 바뀌지 않는다.
 */
export const PARALLEL = 6;

/**
 * `items` 를 `PARALLEL` 개까지 겹쳐 `fn` 에 넘긴다. `fn` 이 `false` 를 돌려주거나 던지면 **새로 시작하지 않고**,
 * 이미 떠난 것은 끝까지 기다린다 — 늦게 돌아온 호출이 저장한 뒤의 스테이지를 고치지 않게. 던진 것은 모두 돌아온 뒤에
 * 처음 것 하나를 다시 던진다 (하루 상한은 `stage-do.ts` 가 부르기 전에 던진다).
 */
async function inParallel(items, fn) {
  let next = 0;
  let halted = false;
  let thrown = null;
  const lane = async () => {
    while (!halted && next < items.length) {
      try {
        if ((await fn(items[next++])) === false) halted = true;
      } catch (e) {
        halted = true;
        thrown ??= { e };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, items.length) }, lane));
  if (thrown) throw thrown.e;
}

/** 남녀 인원. `people` 만 오면 반씩 — 홀수면 남이 하나 많다 (번호가 남부터 시작해서) */
function headcount(want) {
  if (want.men !== undefined || want.women !== undefined) {
    return { men: Number(want.men ?? 0), women: Number(want.women ?? 0) };
  }
  const people = Number(want.people ?? 6);
  return { men: Math.ceil(people / 2), women: Math.floor(people / 2) };
}

/** 번호 순서의 성별 — 남 · 여 · 남 · 여 … 한쪽이 먼저 떨어지면 남은 쪽이 잇는다 */
function genders(men, women) {
  const out = [];
  let m = men;
  let w = women;
  while (m > 0 || w > 0) {
    if (m > 0) out.push("M"), m--;
    if (w > 0) out.push("F"), w--;
  }
  return out;
}

/** 파티로 갈 때 테이블 수 — 여섯 명쯤씩, 앱이 받는 범위(1~12, 한 테이블에 둘 이상) 안에서 */
export const autoTables = (people) => Math.max(1, Math.min(12, Math.round(people / 6), Math.floor(people / 2)));

/**
 * 스테이지를 새로 만든다 (S-C1) — **세 걸음**이다.
 *
 *   beginStage        환경 확인 → 운영자 로그인 → 회차 만들기 → 명단에 가짜 번호 전원
 *   stage.enrollSome  명단에서 몇 명씩 **실제 경로로** 등록한다 (입장 → 등록)
 *   stage.gotoPhase   원하는 단계까지
 *
 * 나눈 까닭은 온라인 스테이지다. 요청 하나가 QA 를 부를 수 있는 횟수에 끝이 있는데(서브요청 상한) 100명이면
 * 등록만 200번이다 — 워커는 걸음을 여러 요청에 나눠 부른다 (슬라이스 37). CLI 와 테스트는 `buildStage` 로 한 번에.
 *
 * 인원은 **남녀를 따로** 받는다(`men` · `women`). `people` 만 주면 반씩 나눈다.
 * 회차를 만든 뒤에 실패하면 **그 회차를 지우고** 던진다 — 안 그러면 아무도 못 닫는 회차가 QA 에 남는다.
 *
 * @param {object} env  fetch · base · publicBase · log · platform · timeTravel · onChange
 * @param {object} want men · women (또는 people) · phase · tables · config · pin · practiceOnly
 */
export async function beginStage(env, want) {
  const { log } = env;
  const health = await env
    .fetch(`${env.base}/api/health`)
    .then((r) => r.json())
    .catch(() => null);
  if (!health?.ok) throw new StageError("unreachable", `${env.publicBase ?? env.base}에 연결하지 못했어요.`);
  // 연습용 환경에만 선다 — QA 에만 있는 `ENV_LABEL` 이 그 증거다 (리허설과 같은 가드)
  if (want.practiceOnly && !health.label) {
    throw new StageError("not_practice", "연습용 서버가 아니에요 (ENV_LABEL 이 없어요). 프로덕션에는 스테이지를 만들지 않아요.");
  }
  log.say(`환경 ${health.label ?? "로컬"} · ${env.publicBase ?? env.base}`);

  if (!want.pin) throw new StageError("no_pin", "운영자 PIN 이 없어요.");
  const { men, women } = headcount(want);
  const stage = makeStage(env, { tables: want.tables ?? autoTables(men + women) });
  stage.ages = { M: ageRange(want.ages?.M, STAGE_AGES.M), F: ageRange(want.ages?.F, STAGE_AGES.F) };
  const h = stage.newClient();
  const login = await h.call("/host/pin", { method: "POST", body: { pin: want.pin } });
  if (login.status !== 200) throw new StageError("login", failText("운영자 PIN", login));

  const config = { ...STAGE_CONFIG, ...want.config };
  const stamp = Date.now();
  const partyAt = stamp + 86400_000;
  const made = await h.call("/host/events", {
    method: "POST",
    body: {
      // 한국 시간으로 — 워커의 시계는 UTC 라 그대로 쓰면 운영자 콘솔에 아홉 시간 전 시각이 뜬다
      name: `스테이지 ${new Date(stamp + 9 * 3600_000).toISOString().slice(11, 16)}`,
      partyAt,
      prevoteAt: stamp + 3600_000,
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

  try {
    // 나이는 명단을 짤 때 정한다 — 등록을 묶음으로 나눠도 성별마다 평균이 맞게
    const rng = seeded(`${stamp}:ages`);
    const ages = { M: spreadAges(men, stage.ages.M, rng), F: spreadAges(women, stage.ages.F, rng) };
    stage.pending = genders(men, women).map((gender, i) => ({ n: i + 1, gender, age: ages[gender].pop(), phone: fakePhone(stamp, i + 1) }));
    const phones = stage.pending.map((p) => p.phone);
    const inv = await h.call(`/host/events/${stage.event.id}/invites`, { method: "POST", body: { phones } });
    if (inv.status !== 200) throw new StageError("invites", failText("초대 명단", inv));
    const ageText = ({ avg, min, max }) => `${avg}세 (${min}~${max})`;
    log.say(`명단 ${men + women}명 (남 ${men}, 여 ${women}), 평균 나이 남 ${ageText(stage.ages.M)}, 여 ${ageText(stage.ages.F)}`);
    await env.onChange?.(stage);
  } catch (e) {
    await stage.close().catch(() => {});
    throw e;
  }
  return stage;
}

/** 한 번에 만든다 — CLI 와 테스트의 길. 걸음마다 실패하면 회차를 지우고 던진다 */
export async function buildStage(env, want) {
  const stage = await beginStage(env, want);
  try {
    await stage.enrollSome();
    await stage.gotoPhase(want.phase ?? "reg");
  } catch (e) {
    await stage.close().catch(() => {});
    throw e;
  }
  return stage;
}

/** 저장해 둔 스테이지에 다시 붙는다. 세션 쿠키째 되살리므로 가짜 참가자를 새로 만들지 않는다 */
export function restoreStage(env, saved) {
  const stage = makeStage(env, { tables: saved.tables });
  stage.event = saved.event;
  stage.stamp = saved.stamp;
  stage.host = stage.newClient(saved.host);
  stage.cast = saved.cast.map((p) => ({ ...p, session: stage.newClient(p.session) }));
  stage.pending = saved.pending ?? [];
  stage.phase = saved.phase ?? "reg";
  stage.deleted = !!saved.deleted;
  stage.ages = saved.ages ?? STAGE_AGES;
  stage.backlog = saved.backlog ?? [];
  stage.autoSent = saved.autoSent ?? {};
  stage.autoStep = saved.autoStep ?? {};
  stage.autoRun = saved.autoRun ?? null;
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
    /** 명단에는 넣었지만 아직 등록하지 않은 사람 — `enrollSome` 이 앞에서부터 뺀다 */
    pending: [],
    /** 마지막으로 넘긴 단계. 스테이지가 기억하는 값일 뿐이고 참은 운영자 콘솔이다 */
    phase: "reg",
    tables,
    stamp: 0,
    /** 회차를 지웠는가. 지운 뒤에는 닫을 때 다시 지우지 않는다 */
    deleted: false,
    /** 성별마다 평균 · 최소 · 최대 나이. 늦게 온 사람도 여기서 뽑는다 */
    ages: STAGE_AGES,
    /** 아직 안 보낸 자동 콕 — `drain` 이 앞에서부터 보낸다. 요청 하나가 QA 를 부를 수 있는 횟수에 끝이 있어서다 */
    backlog: [],
    /** 라운드 → 번호 → 자동으로 찌른 상대. 같은 사람을 두 번 찌르지 않게 */
    autoSent: {},
    /** 라운드 → 자동 콕을 몇 번 눌렀나 (`AUTO_STEPS` 에서 멈춘다). 누를 때마다 파티가 한 칸 흐른다 */
    autoStep: {},
    /** 지금 보내는 자동 콕 한 판의 셈 — 다 보내면 한 줄로 말한다 */
    autoRun: null,
    skew: 0,
    log,
    serverNow: () => Date.now() + stage.skew,
    newClient: (saved) => client(env, saved, (d) => (stage.skew = d)),

    persona(who) {
      const s = String(who).trim();
      return stage.cast.find((p) => String(p.n) === s || p.nickname === s || p.id === s) ?? null;
    },

    /** 저장할 모양. 세션 쿠키가 들어 있다 — **가짜 참가자의 것뿐**이고, 스테이지를 닫으면 지운다 */
    toJSON() {
      return {
        event: stage.event,
        stamp: stage.stamp,
        tables: stage.tables,
        phase: stage.phase,
        pending: stage.pending,
        deleted: stage.deleted,
        ages: stage.ages,
        backlog: stage.backlog,
        autoSent: stage.autoSent,
        autoStep: stage.autoStep,
        autoRun: stage.autoRun,
        host: stage.host.toJSON(),
        cast: stage.cast.map((p) => ({
          n: p.n, id: p.id, nickname: p.nickname, gender: p.gender, age: p.age, phone: p.phone, pin: p.pin,
          session: p.session.toJSON(),
        })),
      };
    },

    /**
     * 명단에서 `max` 명을 등록하고 남은 수를 돌려준다. 한 사람이 실패해도 멈추지 않는다 — 로그에 남기고 넘어간다.
     */
    async enrollSome(max = Infinity) {
      // 사람끼리는 겹쳐 등록한다 (`PARALLEL`) — 한 사람의 입장과 등록은 `enroll` 안에서 차례다
      try {
        await inParallel(stage.pending.splice(0, max), async (item) => {
          const p = await stage.enroll(item);
          if (p) stage.cast.push(p);
        });
      } finally {
        // 끝난 순서대로 붙어서 섞였다 — 스테이지 화면의 단추도, 번호로 부르는 명령도 번호 순서를 믿는다
        stage.cast.sort((a, b) => a.n - b.n);
      }
      if (!stage.pending.length) {
        const m = stage.cast.filter((p) => p.gender === "M").length;
        say(`가짜 참가자 ${stage.cast.length}명 등록 (남 ${m}, 여 ${stage.cast.length - m}, PIN 번호는 모두 ${STAGE_PIN})`);
      }
      await env.onChange?.(stage);
      return stage.pending.length;
    },

    /** 가짜 참가자 한 명을 실제 경로로 등록한다 — 명단 확인(초대 쿠키) → 등록(참가자 쿠키). 나이가 없으면 그 성별의 분포에서 뽑는다 */
    async enroll({ n, gender, phone, age = Math.round(ageAt(Math.random(), stage.ages[gender])) }) {
      const i = n - 1;
      const session = stage.newClient();
      const probe = await session.call(`/events/${stage.event.id}/enter`, { method: "POST", body: { phone } });
      if (probe.status !== 200) return fail(`${n}번 입장`, probe), null;
      session.ref = probe.body.ref;
      const nickname = i < NICKS.length ? NICKS[i] : `손님${hangulSeq(n)}`;
      const input = {
        nickname,
        realName: `가상${hangulSeq(n)}`,
        age,
        gender,
        instagram: `stage_${n}`,
        mbti: MBTI[i % MBTI.length],
        charms: CHARMS[i % CHARMS.length],
        pin: STAGE_PIN,
      };
      const reg = await session.call("/register", { method: "POST", body: input });
      if (reg.status !== 200) return fail(`${n}번 등록`, reg), null;
      return { n, id: reg.body.state.me.id, nickname, gender: input.gender, age: input.age, phone, pin: STAGE_PIN, session };
    },

    /**
     * 자동 콕 줄(`backlog`)에서 QA 를 많아야 `max` 번 불러 보낸다. 남은 수를 돌려준다.
     * `PARALLEL` 개까지 겹쳐 보낸다. 그사이 손으로 찔러 상한에 닿은 사람은 건너뛰고, 단계가 닫혔으면 줄을 비운다 —
     * 그때 이미 떠난 콕은 돌아올 때까지 기다린다.
     */
    async drain(max = BULK_MAX) {
      const run = stage.autoRun;
      // 이번 몫을 줄에서 꺼낸다 — 사람을 못 찾는 줄은 부르지 않으므로 몫에 세지 않는다
      const batch = [];
      while (stage.backlog.length && batch.length < max) {
        const { from: a, to: b, round } = stage.backlog.shift();
        const from = stage.persona(a);
        const to = stage.persona(b);
        if (from && to) batch.push({ a, b, round, from, to });
      }
      let stopped = null;
      await inParallel(batch, async ({ a, b, round, from, to }) => {
        const res = await from.session.call("/poke", { method: "POST", body: { toId: to.id } });
        if (res.status === 200) {
          ((stage.autoSent[round] ??= {})[a] ??= []).push(b);
          if (run) {
            run.pokes[from.gender]++;
            if (!run.senders[from.gender].includes(a)) run.senders[from.gender].push(a);
          }
          return true;
        }
        // 그사이 손으로 찔러 상한에 닿았다 — 그 사람만 건너뛴다
        if (res.body?.error === "no_budget") return true;
        stopped ??= res;
        return false;
      });
      if (stopped) {
        stage.backlog = [];
        stage.autoRun = null;
        if (stopped.body?.error === "closed") say("  ✗ 자동 콕 — 지금은 콕을 찌를 수 없어요. 프로필 투표가 마감됐거나 매칭 결과가 나왔어요");
        else fail("자동 콕", stopped);
        return 0;
      }
      if (run && stage.backlog.length) {
        say(`  … 자동 콕 보내는 중 (${run.pokes.M + run.pokes.F}/${run.total})`);
      } else if (run) {
        // 매력 투표에서는 콕이 곧 표다 — `남자 10명 중 9명이 9표를 냈어요`
        const vote = run.round === "pre";
        const who = { M: "남자", F: "여자" };
        const did = ["M", "F"]
          .filter((g) => run.senders[g].length)
          .map((g) => `${who[g]} ${run.of[g]}명 중 ${run.senders[g].length}명이 ${run.pokes[g]}${vote ? "표" : "번"}`);
        const idle = ["M", "F"].filter((g) => !run.senders[g].length).map((g) => who[g]);
        const verb = vote ? ["를 냈어요", "투표하지 않았어요"] : [" 찔렀어요", "찌르지 않았어요"];
        const text = !did.length
          ? `아무도 ${verb[1]}`
          : `${did.join(", ")}${verb[0]}${idle.length ? `. ${idle[0]}는 아무도 ${verb[1]}` : ""}`;
        say(`  ✓ 자동 콕 (${run.what}) — ${text}`);
        stage.autoRun = null;
      }
      return stage.backlog.length;
    },

    /** 단계를 만든다. party 는 자리를 발행해야 파티가 열려 있는 모양이 된다 — 매력 투표는 파티 시작이 닫는다 (ADR-100) */
    async gotoPhase(to) {
      if (to === "reg") return;
      const order = ["prevote", "party", "done"];
      if (!order.includes(to)) return say(`  ? 모르는 단계 ${to} (prevote · party · done)`);
      await stage.run("phase prevote");
      if (to === "prevote") return;
      await stage.run(`seating ${stage.tables}`);
      await stage.run("publish");
      await stage.run("phase party");
      if (to === "done") await stage.run("phase done");
    },

    /**
     * 스테이지를 닫는다 (S-C3). `keep` 이 아니면 회차를 지운다 — 가짜 참가자라도 QA 에 쌓아 두지 않는다.
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

    /** 명령 한 줄. 스테이지마다 더한 명령(`env.platform`)이 먼저다 */
    async run(line) {
      return runLine(env, stage, line, { say, fail });
    },

    /**
     * CLI 의 폰 리모컨 (S-D1) — 같은 Wi-Fi 에서 여는 페이지다. **주소를 상대 경로로 부른다**(`cmd`·`log`).
     * 로그는 1.5초마다 다시 읽는다 — 터미널로 친 명령도 로그에 쓰므로 그래야 보이고, 로컬이라 한도와 상관없다.
     * 온라인 스테이지의 화면은 이것이 아니다 — 스테이지 워커의 `worker/view.ts` 가 틀 여럿을 한 탭에 띄운다 (슬라이스 37).
     */
    remotePage({ chips = [] } = {}) {
      const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
      const rows = stage.cast
        .map(
          (p) =>
            `<tr><td>${p.n}</td><td>${esc(p.nickname)}</td><td>${p.gender === "M" ? "남" : "여"} ${p.age}</td><td>${p.phone}</td><td>${p.pin}</td></tr>`,
        )
        .join("");
      const all = ["cast", "state", "phase prevote", `seating ${stage.tables}`, "publish", "shuffle", "phase party", "phase done", "auto", "auto last", "pairs", "late", ...chips];
      const chipHtml = all.map((c) => `<button data-cmd="${esc(c)}">${esc(c)}</button>`).join("");
      return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>스테이지 · ${esc(stage.event.code)}</title>
<style>
body{margin:0;padding:12px;font:16px/1.5 system-ui;background:#111;color:#eee}
h1{font-size:18px;margin:0 0 8px}small{color:#9a9}
form{display:flex;gap:8px;margin:10px 0}input{flex:1;font-size:18px;padding:12px;border-radius:10px;border:1px solid #444;background:#222;color:#fff}
button{font-size:16px;padding:12px 14px;border-radius:10px;border:0;background:#6c5ce7;color:#fff}
.chips{display:flex;flex-wrap:wrap;gap:8px}.chips button{background:#333}
table{width:100%;border-collapse:collapse;font-size:14px;margin-top:10px}td{padding:6px 4px;border-bottom:1px solid #333}
pre{background:#000;padding:10px;border-radius:10px;font-size:13px;white-space:pre-wrap;max-height:40vh;overflow:auto}
</style>
<h1>스테이지 ${esc(stage.event.code)} <small>${esc(env.publicBase ?? env.base)}</small></h1>
<form id="f"><input id="c" placeholder="poke 3 5" autocomplete="off" autocapitalize="off"><button>실행</button></form>
<div class="chips">${chipHtml}</div>
<table>${rows}</table>
<pre id="log"></pre>
<script>
const f=document.getElementById('f'),c=document.getElementById('c'),logEl=document.getElementById('log');
async function send(line){await fetch('cmd',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({line})});refresh();}
f.onsubmit=e=>{e.preventDefault();if(c.value.trim())send(c.value);c.value='';};
document.querySelectorAll('[data-cmd]').forEach(b=>b.onclick=()=>send(b.dataset.cmd));
async function refresh(){const r=await fetch('log');logEl.textContent=await r.text();logEl.scrollTop=logEl.scrollHeight;}
refresh();setInterval(refresh,1500);
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
    if (!a || !b) say("  ? 두 사람을 적어주세요 (번호나 닉네임)");
    return a && b ? [a, b] : null;
  };
  const ok = (what, res) => (res.status === 200 ? say(`  ✓ ${what}`) : fail(what, res));
  /** 숫자 인자. 없거나 이상하면 기본값, 범위 밖이면 가까운 끝 */
  const count = (v, min, max, dflt) => {
    const x = Math.round(Number(v));
    return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : dflt;
  };
  const shuffled = (xs) =>
    xs.map((x) => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map(([, x]) => x);
  /** 콕을 보낼 상대 — 이성. 동성 콕을 허용한 회차라도 스테이지는 이성에게만 뿌린다 (앱의 기본 모양) */
  const others = (p) => stage.cast.filter((q) => q.gender !== p.gender);
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
      say(`  단계 ${m.phase} · 참가자 ${st.body.players.length} · 투표 ${st.body.pokeCount?.pre ?? 0} · 콕 ${st.body.pokeCount?.party ?? 0} · 서로 찌른 ${st.body.mutual?.length ?? 0}쌍 · 자리 ${rounds}`);
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
    case "phase": {
      const res = await H("/phase", { method: "POST", body: { to: rest[0] } });
      if (res.status === 200) stage.phase = rest[0];
      // 단추 이름과 같은 말로 — 영어 단계 이름(prevote)은 명령에만 쓴다
      const done = { reg: "등록 단계로", prevote: "프로필 투표 시작", party: "파티 시작", done: "매칭 확인 시작" }[rest[0]];
      return ok(done ?? `단계 → ${rest[0]}`, res);
    }
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
      return ok(a && b ? `설문 "${text}" (${a} / ${b})` : `공지 "${text}"`, await H("/announcements", { method: "POST", body: { text, ...(a && b ? { poll: { a, b } } : {}) } }));
    }
    case "late": {
      // 번호는 가장 큰 번호 다음 — 등록에 실패해 빠진 번호가 있어도 겹치지 않는다
      const n = Math.max(0, ...stage.cast.map((p) => p.n)) + 1;
      const men = stage.cast.filter((p) => p.gender === "M").length;
      const gender = /^[mM남]/.test(rest[0] ?? "") ? "M" : /^[fF여]/.test(rest[0] ?? "") ? "F" : men <= stage.cast.length - men ? "M" : "F";
      const phone = fakePhone(Date.now(), n);
      const inv = await H("/invites", { method: "POST", body: { phones: [phone] } });
      if (inv.status !== 200) return fail("초대", inv);
      const p = await stage.enroll({ n, gender, phone });
      if (!p) return;
      stage.cast.push(p);
      await env.onChange?.(stage);
      return say(`  ✓ ${name(p)} 추가 (${p.gender === "M" ? "남자" : "여자"}, ${p.age}세)`);
    }
    case "spray": {
      // 콕 뿌리기 — 남은 콕을 아무 이성에게. 상한에 닿은 사람은 빼고 이어 간다
      const want = count(rest[0], 1, BULK_MAX, 20);
      const spent = new Set();
      let made = 0;
      for (let tries = 0; made < want && tries < BULK_MAX; tries++) {
        const from = shuffled(stage.cast.filter((p) => !spent.has(p.id) && others(p).length))[0];
        if (!from) break;
        const to = shuffled(others(from))[0];
        const res = await from.session.call("/poke", { method: "POST", body: { toId: to.id } });
        if (res.status === 200) made++;
        else if (res.body.error === "no_budget") spent.add(from.id);
        else return fail("콕 뿌리기", res);
      }
      if (!made) return say("  ? 콕을 보낼 수 있는 사람이 없어요. 모두 콕을 다 썼거나 이성이 없어요");
      return say(`  ✓ 콕 ${made}번 뿌림${spent.size ? ` · 다 쓴 사람 ${spent.size}명` : ""}`);
    }
    case "auto": {
      // 자동 콕 — 실제 파티처럼 (`AUTO_POKE`). 누를 때마다 한 칸(`AUTO_STEPS`). 계획을 줄에 세우고 요청 하나의 몫만큼 보낸다 — 남은 것은 `drain`
      const last = /^(last|마지막)$/.test(rest[0] ?? "");
      const st = await H("/state");
      if (st.status !== 200) return fail("자동 콕", st);
      const { meta, players, sent } = st.body;
      // 운영자 틀에서 단계를 넘겼을 수 있다 — 스테이지가 기억하는 단계를 콘솔에 맞춘다
      stage.phase = meta.phase;
      if (meta.phase !== "prevote" && meta.phase !== "party") return say("  ? 자동 콕은 프로필 투표나 파티 중에만 쓸 수 있어요");
      const round = meta.phase === "prevote" ? "pre" : "party";
      const step = last ? AUTO_STEPS : Math.min(AUTO_STEPS, (stage.autoStep[round] ?? 0) + 1);
      stage.autoStep[round] = step;
      const here = new Set(players.map((p) => p.id));
      const cast = stage.cast.filter((p) => here.has(p.id));
      const plan = planPokes({
        cast,
        used: Object.fromEntries(cast.map((p) => [p.n, sent?.[round]?.[p.id] ?? 0])),
        max: round === "pre" ? meta.config.maxPre : meta.config.maxParty,
        round,
        step,
        seed: stage.stamp,
        history: stage.autoSent[round] ?? {},
      });
      const name = round === "pre" ? "프로필 투표" : "파티";
      const what = `${name} ${step}/${AUTO_STEPS}`;
      stage.backlog = plan.map(([from, to]) => ({ from, to, round }));
      if (!plan.length) {
        stage.autoRun = null;
        // 쓰려던 것이 남아 있으면 계획이 비지 않는다 — 비었으면 모두 끝났다
        if (round === "pre") return say(`  ? 자동 콕 (${name}) — 더 투표할 사람이 없어요. 모두 투표했거나 투표하지 않기로 한 사람이에요`);
        return say(`  ? 자동 콕 (${name}) — 더 찌를 사람이 없어요. 모두 콕을 다 썼거나 쓰지 않기로 한 사람이에요`);
      }
      const of = (g) => cast.filter((p) => p.gender === g).length;
      stage.autoRun = { what, round, total: plan.length, of: { M: of("M"), F: of("F") }, pokes: { M: 0, F: 0 }, senders: { M: [], F: [] } };
      // 상태를 읽은 한 번까지 쳐서 명령 한 줄이 `batch` 를 넘지 않게
      await stage.drain((env.batch ?? BULK_MAX) - 1);
      return;
    }
    case "crowd": {
      // 콕 모으기 — 한 사람에게 이성 N명이 한 번씩. 받은 콕 알림이 쌓이는 모양을 보는 명령이다
      const to = stage.persona(rest[0]);
      if (!to) return say("  ? 누구에게? (번호 또는 닉네임)");
      const want = count(rest[1], 1, BULK_MAX, 5);
      let made = 0;
      for (const from of shuffled(others(to)).slice(0, BULK_MAX)) {
        if (made >= want) break;
        const res = await from.session.call("/poke", { method: "POST", body: { toId: to.id } });
        if (res.status === 200) made++;
        else if (res.body.error !== "no_budget") return fail(`${name(to)}에게 콕 모으기`, res);
      }
      if (!made) return say(`  ? ${name(to)}에게 콕을 보낼 수 있는 사람이 없어요. 모두 콕을 다 썼거나 이성이 없어요`);
      return say(`  ✓ ${name(to)}에게 콕 ${made}번${made < want ? ` (보낼 수 있는 사람이 ${made}명뿐이에요)` : ""}`);
    }
    case "pairs": {
      // 서로 콕 N쌍 — 남녀를 무작위로 짝지어 서로 한 번씩. 한쪽만 찌르고 막히면 되돌린다 — 한쪽 콕을 남기지 않는다
      const want = count(rest[0], 1, 10, 3);
      const men = shuffled(stage.cast.filter((p) => p.gender === "M"));
      const women = shuffled(stage.cast.filter((p) => p.gender === "F"));
      const made = [];
      // 쌍 하나가 많아야 세 번 부른다 — 묶음 상한 안에 든다
      for (let i = 0; made.length < want && i < Math.min(men.length, women.length, Math.floor(BULK_MAX / 3)); i++) {
        const [a, b] = [men[i], women[i]];
        const ab = await a.session.call("/poke", { method: "POST", body: { toId: b.id } });
        if (ab.status !== 200) {
          if (ab.body.error === "no_budget") continue;
          return fail("서로 콕", ab);
        }
        const ba = await b.session.call("/poke", { method: "POST", body: { toId: a.id } });
        if (ba.status !== 200) {
          await a.session.call("/unpoke", { method: "POST", body: { toId: b.id } });
          if (ba.body.error === "no_budget") continue;
          return fail("서로 콕", ba);
        }
        made.push(`${name(a)} ↔ ${name(b)}`);
      }
      if (!made.length) return say("  ? 서로 콕을 만들 수 있는 쌍이 없어요. 콕을 다 썼거나 남녀 중 한쪽이 없어요");
      return say(`  ✓ 서로 콕 ${made.length}쌍 — ${made.join(" · ")}`);
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
      // 입장 시도 제한은 접속지 해시로 센다 — 여기서 틀린 만큼 이 스테이지가 도는 곳(접속지)의 시도가 소모된다
      for (let i = 0; i < 5; i++) {
        const wrong = String((Number(p.pin) + 1111 * (i + 1)) % 10000).padStart(4, "0");
        const res = await stage.newClient().call(`/events/${stage.event.id}/enter`, { method: "POST", body: { phone: p.phone, pin: wrong } });
        say(`  ${i + 1}번째 틀림 → ${res.status} ${res.body.error ?? ""}`);
        if (res.body.error === "pin_locked") break;
      }
      return;
    }
    case "schedule": {
      const key = { prevote: "prevoteAt", party: "partyAt", reveal: "revealAt" }[rest[0]];
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
  if (ELSEWHERE.has(cmd)) return say(`  ${cmd} — 이 스테이지에서는 쓸 수 없어요`);
  return say(`  ? ${cmd} — help 를 쳐보세요`);
}
