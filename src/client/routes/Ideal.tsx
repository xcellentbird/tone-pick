/**
 * 이상형 찾기 (슬라이스 19) — 시작 · 라운드 셋 · 결과. **재미 탭 안의 페이지**다 (시트가 아니다 — `/me/edit` 과 같은 자리).
 *
 *   /ideal        결과가 없으면 풀 고르기, **있으면 결과** — 같은 주소가 상태를 따라간다
 *   /ideal/again  다시 찾기의 풀 고르기 (ADR-125). 결과가 없거나 재미가 닫혔으면 `/ideal` 로 물러난다
 *   /ideal/1..3   라운드. 한 칸씩 push — 뒤로 가기가 곧 이전 라운드다 (S-B4, 등록 스텝과 같다).
 *                 `다른 얼굴 보기` 는 칸을 쌓지 않는다 — 같은 라운드의 다른 쪽일 뿐이다 (v2)
 *
 * **다시 찾기는 다시 뽑기가 아니라 다시 고르기다** (ADR-125) — 결과에는 난수가 없어서 같은 화면에서 같은 얼굴을 고르면 같은 결과다.
 * 난수는 하나, **찾기를 시작할 때 집는 첫 화면 묶음**(`start`, ADR-136)뿐이다 — 1라운드에 어느 대표들이 서는지만 정하고,
 * 결과와 함께 저장된다. 다시 찾으면 새로 집는다.
 * 지난 결과는 **새 결과가 저장될 때만** 바뀐다. 다시 찾다가 나가면 그대로다 — 무엇을 대신하는지는 이 화면의 메모리
 * (`redo.from` — 지난 결과의 `at`)에만 있고, 저장할 때 서버에 그 값을 가리켜 보낸다.
 *
 * **고르던 값은 이 컴포넌트의 메모리에만 있다** (S-B4 · S-E1). 참가자 화면이 이 컴포넌트를 `/ideal` 과 라운드
 * 주소 사이에서 한 자리에 두어 값이 산다. 재미 탭으로 나가면 사라진다 — 1분짜리라 이어 하기를 만들지 않는다.
 *
 * 계산은 전부 기기에서 한다 (S-D3). 서버에는 고른 id 와 결과 id 만 간다.
 * 얼굴 자료는 **여기서만** 받는다 — 시작 화면이 서면, 또는 결과를 그릴 때. 재미 탭 카드만 보는 사람은 받지 않는다.
 *
 * **다음에 보일 사진은 미리 받는다** (`warm`). 한국에서 이 워커는 멀리(LAX) 붙어 왕복 한 번이 150ms 쯤이고,
 * 자료 → 사진이 차례로 기다리면 라운드마다 반 초가 넘게 빈 칸이 섰다. 시작 화면에서는 두 풀의 자료와 1라운드 첫 쪽을,
 * 라운드에서는 고를 때마다 **다음 라운드의 아홉**(이미 계산해 둔 값이다)과 `다른 얼굴 보기` 의 아홉을, 마지막 라운드에서는
 * 결과 셋을. 사진은 1년 캐시라 한 번 받으면 다시 묻지 않는다.
 *
 * 따로 싣는 조각이다 (`React.lazy`) — 탭 카드는 `IdealCard.tsx` 에 있다.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { FAIL, IDEAL } from "../../shared/copy.ts";
import {
  IDEAL_ASSET_V,
  IDEAL_SHAPE,
  decodeVec,
  facesForStart,
  idealTraits,
  nearestCelebs,
  pickRound,
  shownPages,
  tasteCenters,
  type DecodedCeleb,
  type DecodedFace,
  type FacePoolFile,
  type FaceStart,
  type Ideal,
  type IdealInput,
  type IdealTraits,
  type IdealVerdict,
} from "../../shared/ideal.ts";
import type { Gender } from "../../shared/types.ts";
import { messageOf, post } from "../lib/api.ts";
import { useOverlay } from "../ui/Overlays.tsx";

// ─────────────────────────────────────────── 얼굴 자료

interface Pool {
  faces: DecodedFace[];
  celebs: DecodedCeleb[];
  /** 고른 얼굴의 벡터를 찾는 자리. 평균은 고른 **얼굴**로 잰다 */
  vecs: Map<string, Float32Array>;
  /** 이름은 자산에만 있다 — DO 에는 이름이 없다 (S-D3) */
  names: Map<string, string>;
  /** 사람마다의 특징 부호 (ADR-127). 그 판에 없으면(v1 · v2) 비어 있고, 결과 화면은 특징 카드를 그리지 않는다 */
  traits: Map<string, string[]>;
  /** 첫 화면 묶음 (ADR-136). 그 판에 없으면(v5 까지) 어느 번호든 자산 그대로다 */
  starts?: FaceStart[];
}

/**
 * 받은 JSON 이 정말 그 판의 풀인가. **`res.ok` 로는 모자란다** — 없는 파일에 SPA 폴백이 index.html 을
 * 200 으로 준다 (`run_worker_first` 를 넓히지 않았다, ADR-92). 경로의 판과 JSON 의 판이 다르면 받지 않는다 —
 * 옛 결과를 새 벡터로 그리는 일이 조용히 생긴다.
 */
function readPool(raw: unknown, v: number): FacePoolFile | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Partial<FacePoolFile>;
  if (f.version !== v || !Number.isInteger(f.dim) || (f.dim ?? 0) <= 0) return null;
  if (typeof f.scale !== "number" || !(f.scale > 0)) return null;
  if (!Array.isArray(f.faces) || !Array.isArray(f.celebs)) return null;
  const ok = (x: { id?: unknown; v?: unknown } | null) =>
    !!x && typeof x.id === "string" && IDEAL_SHAPE.id.test(x.id) && typeof x.v === "string";
  const okT = (t: unknown) => t === undefined || (Array.isArray(t) && t.every((x) => typeof x === "string"));
  if (!f.faces.every(ok) || !f.celebs.every((c) => ok(c) && typeof c.name === "string" && okT(c.t))) return null;
  // 묶음 하나하나의 모양(모르는 id · 겹침 · 수)은 `facesForStart` 가 본다 — 어긋난 묶음은 자산 그대로 선다
  const okS = (s: Partial<FaceStart> | null) =>
    !!s && [s.l1, s.l2].every((l) => Array.isArray(l) && l.every((x) => typeof x === "string"));
  if (f.starts !== undefined && !(Array.isArray(f.starts) && f.starts.every(okS))) return null;
  return f as FacePoolFile;
}

/**
 * 파티장 와이파이에서 붙잡힌 요청은 끝나지 않을 수 있다 — 시간을 넘기면 실패로 치고 `다시 불러오기` 를 내준다.
 * 풀 JSON 은 수십 KB 라 `api()` 의 기본 대기(10초)보다 조금 넉넉히 둔다. 끊긴 요청의 본문 읽기도 같은 신호에 걸린다
 */
const POOL_TIMEOUT = 12_000;

async function fetchPool(v: number, pool: Gender): Promise<Pool> {
  // `api()` 가 아니다 — 정적 파일이다. `/api` 도 탭 이름표도 붙지 않는다
  const res = await fetch(`/faces/v${v}/${pool.toLowerCase()}.json`, { signal: AbortSignal.timeout?.(POOL_TIMEOUT) });
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) throw new Error("faces");
  const file = readPool(await res.json(), v);
  if (!file) throw new Error("faces");
  const { dim, scale } = file;
  const faces = file.faces.map((f) => ({ id: f.id, level: f.level, vec: decodeVec(f.v, dim, scale) }));
  const celebs = file.celebs.map((c) => ({
    id: c.id,
    name: c.name,
    vec: decodeVec(c.v, dim, scale),
    ...(c.retired ? { retired: true as const } : {}),
    ...(c.t ? { t: c.t } : {}),
  }));
  return {
    faces,
    celebs,
    vecs: new Map(faces.map((f) => [f.id, f.vec])),
    names: new Map(celebs.map((c) => [c.id, c.name])),
    traits: new Map(celebs.filter((c) => c.t).map((c) => [c.id, c.t!])),
    ...(file.starts ? { starts: file.starts } : {}),
  };
}

/**
 * 판·풀마다 한 번만 받는다 — 뒤로 갔다 다시 와도, 결과로 넘어가도 같은 약속이다.
 * **실패한 약속은 빼낸다.** 남겨 두면 `다시 불러오기` 가 같은 실패를 그대로 돌려준다.
 */
const pools = new Map<string, Promise<Pool>>();
function loadPool(v: number, pool: Gender): Promise<Pool> {
  const key = `${v}/${pool}`;
  const hit = pools.get(key);
  if (hit) return hit;
  const p = fetchPool(v, pool);
  pools.set(key, p);
  p.catch(() => {
    if (pools.get(key) === p) pools.delete(key);
  });
  return p;
}

/** 지금 그릴 판의 풀. 판이 바뀌면(다른 기기가 먼저 끝낸 결과 — S-E2) 옛 것을 그리지 않는다 */
function usePool(v: number, pool: Gender | null) {
  const key = pool ? `${v}/${pool}` : null;
  const [got, setGot] = useState<{ key: string; pool?: Pool; failed?: true } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!pool) return;
    let alive = true;
    const k = `${v}/${pool}`;
    loadPool(v, pool).then(
      (p) => alive && setGot({ key: k, pool: p }),
      () => alive && setGot({ key: k, failed: true }),
    );
    return () => {
      alive = false;
    };
  }, [v, pool, attempt]);
  const cur = got && got.key === key ? got : null;
  return {
    data: cur?.pool,
    failed: !!cur?.failed,
    retry: () => {
      setGot(null);
      setAttempt((n) => n + 1);
    },
  };
}

const photo = (v: number, id: string) => `/faces/v${v}/${id}.webp`;

/**
 * 테스트가 모듈 캐시를 비우는 문 — 시작 화면이 자료를 미리 받으므로, 실패를 재는 테스트는 앞 테스트가 받아 둔 풀을 비우고 시작한다
 */
export function forgetPools() {
  pools.clear();
  warmed.clear();
}

/** 이미 미리 받은 사진 주소 — 같은 사진을 두 번 부르지 않는다 */
const warmed = new Set<string>();
/**
 * 사진을 미리 받아 브라우저 캐시에 넣는다. 화면에 붙이지 않는다 — 실패해도 아무 말이 없다
 * (그 사진이 정말 필요해지면 `<img>` 가 다시 부르고, 그때의 실패는 그 칸이 말한다)
 */
function warm(urls: readonly string[]) {
  for (const u of urls) {
    if (warmed.has(u)) continue;
    warmed.add(u);
    const img = new Image();
    img.decoding = "async";
    img.src = u;
  }
}
/** 자산의 픽셀 크기 (4:5). 먼저 자리를 잡아 사진이 들어올 때 화면이 튀지 않는다 */
const W = 240;
const H = 300;

/** 고른 얼굴들의 취향 중심 — 라운드 후보도 결과도 같은 중심을 따른다. 안 고른 얼굴은 쓰지 않는다 */
const centersOf = (pool: Pool, ids: readonly string[]) => tasteCenters(ids.map((id) => pool.vecs.get(id)!));

/**
 * 고른 얼굴들의 특징 (ADR-127). 그 판에 특징이 없으면 null — 옛 결과(v1 · v2)에는 카드가 서지 않는다.
 * **고른 얼굴**로 센다. 결과 연예인으로 세면 결과가 빗나간 만큼 문장도 빗나간다
 */
function traitsOf(pool: Pool, picks: readonly string[][]): IdealTraits | null {
  if (!pool.traits.size) return null;
  return idealTraits(
    picks.flat().map((id) => pool.traits.get(id) ?? []),
    [...pool.traits.values()],
  );
}

/**
 * 라운드마다 보여줄 아홉과, 지금까지 **본 얼굴 전부**(넘긴 쪽까지 — 다시 안 나오고 결과에도 안 나온다).
 * **고르던 값에서 매번 다시 센다** — 앞 라운드를 고쳐 고르면 뒤 라운드의 후보도 달라져야 한다
 * (앞의 선택이 뒤의 후보를 정한다). `다른 얼굴 보기` 도 값(`flips` — 라운드마다 넘긴 횟수)으로만 들고
 * 같은 규칙으로 다시 센다 — 같은 입력이면 같은 아홉이라, 뒤로 갔다 와도 넘긴 쪽이 그대로 선다.
 * 앞 라운드를 아직 안 골랐으면 거기서 멈춘다. 얼굴의 단계는 첫 화면 묶음(`start`)으로 붙인다 (ADR-136).
 */
function roundsOf(pool: Pool, start: number, picks: readonly string[][], flips: readonly number[]) {
  const all = facesForStart(pool.faces, pool.starts, start);
  const shown = new Set<string>();
  const rounds: DecodedFace[][] = [];
  for (let r = 1; r <= IDEAL_SHAPE.rounds; r++) {
    if (r > 1 && !picks[r - 2]?.length) break;
    // 중심은 지금까지 고른 얼굴 전부로 — 라운드 가중치가 없다. 1라운드는 중심을 보지 않는다
    const centers = r === 1 ? null : centersOf(pool, picks.slice(0, r - 1).flat());
    let faces: DecodedFace[] = [];
    for (let k = 0; k <= (flips[r - 1] ?? 0); k++) {
      faces = pickRound(all, r as 1 | 2 | 3, centers, shown);
      for (const f of faces) shown.add(f.id);
    }
    rounds.push(faces);
  }
  return { rounds, shown };
}

/**
 * 첫 화면 묶음을 집는다 (ADR-136) — **찾기를 시작할 때 한 번.** 이 기능의 하나뿐인 난수다. 풀을 고르기 전에 집는다 —
 * 시작 화면이 두 풀의 1라운드 첫 쪽을 미리 받으려면 번호가 먼저 있어야 한다 (두 풀의 묶음 수는 같다 — check:faces)
 */
const drawStart = () => Math.floor(Math.random() * IDEAL_SHAPE.starts);

// ─────────────────────────────────────────── 화면

interface Props {
  /** 0 = `/ideal`(또는 `/ideal/again`), 1~3 = 라운드. 그 밖의 값은 없는 주소다 — 시작으로 갈아끼운다 */
  round: number;
  /** `/ideal/again` — 다시 찾기의 시작 화면 (ADR-125) */
  again: boolean;
  /** 재미가 열렸나 (`canOpenFun`, ADR-125). 닫혔으면 새로 고르지 못한다 — 찾은 결과는 그대로 본다 */
  open: boolean;
  /** 저장된 결과. 있으면 라운드 주소는 다시 찾는 중에만 열린다 (S-C3 · ADR-125) */
  ideal?: Ideal;
  /**
   * 0 = 시작, 1~3 = 라운드. 라운드는 push, `replace` 는 가드가 쓴다 — **열리면 안 되는 라운드 주소에서 물러나라**는 뜻이고,
   * 되감을지 갈아끼울지는 기록을 아는 쪽(참가자 화면)이 **그 순간의 칸**을 보고 정한다
   */
  onGo: (to: number, opts?: { replace?: boolean }) => void;
  /** 결과 화면의 `다시 찾기` — 결과 칸을 `/ideal/again` 으로 갈아끼운다 (쌓으면 뒤로 가기가 지난 결과를 한 번 더 보여준다) */
  onAgain: () => void;
  /** 서버가 돌려준 행 하나만 갈아끼운다 (`setFortune` 과 같은 좁은 통로) */
  onSaved: (ideal: Ideal) => void;
  /** 설명글(ADR-134)이 켜진 곳인가 — QA 에서만 (`ParticipantState.idealStory`) */
  story?: boolean;
}

export default function IdealFlow({ round, again, open: funOpen, ideal, onGo, onAgain, onSaved, story }: Props) {
  const [pool, setPool] = useState<Gender | null>(null);
  /**
   * 다시 찾는 중이면 **무엇을 대신하는지** — 지난 결과의 `at` (ADR-125). 다시 찾기의 풀을 고를 때 적는다.
   * 저장된 결과의 `at` 이 이 값과 다르면 새 결과가 선 것이다 (다른 기기가 먼저 바꾼 것도 같다 — S-E2).
   */
  const [redo, setRedo] = useState<{ from: number } | null>(null);
  const [picks, setPicks] = useState<string[][]>([]);
  /** 라운드마다 `다른 얼굴 보기` 를 누른 횟수. 고르던 값과 같이 메모리에만 있다 — 저장하지 않는다 */
  const [flips, setFlips] = useState<number[]>([]);
  /**
   * 첫 화면 묶음 (ADR-136). 이 화면이 서면 집고, **다시 찾기를 누르면 새로 집는다** — 한 번 찾는 동안은 그대로다
   * (뒤로 갔다 같은 쪽을 다시 골라도 고르던 얼굴이 그 화면 그대로 선다). 결과와 함께 저장한다
   */
  const [start, setStart] = useState(drawStart);
  const [saving, setSaving] = useState(false);
  /**
   * 화면마다 포커스가 설 머리 — 시작 화면의 물음, 라운드의 머리(몇 번째 · 안내). 결과는 `Result` 가 스스로 옮긴다.
   * `다른 얼굴 보기` 가 스스로를 지운 뒤에도 여기로 온다 — 라운드 머리는 넘겨도 그대로 남는다
   */
  const startHead = useRef<HTMLHeadingElement>(null);
  const roundHead = useRef<HTMLDivElement>(null);
  const { toast } = useOverlay();

  /**
   * 다시 찾는 중 — 지난 결과가 아직 서 있다. **다시 찾기의 흐름(시작 주소 · 라운드) 안에서만이다** — 결과 주소로 물러났으면
   * (문이 닫혀 라운드가 되감겼다) 결과를 그린다. 그 자리에서 다시 찾기를 잊는다 (아래 효과).
   */
  const redoing = (again || round > 0) && !!ideal && !!redo && ideal.at === redo.from;
  /** 방금 새 결과가 섰다 (또는 그 사이 다른 기기가 바꿨다) — 다시 찾기의 시작 주소에서 결과로 물러난다 */
  const redone = !!ideal && !!redo && ideal.at !== redo.from;
  /** 고르는 흐름인가 — 판과 풀이 지금 것이다. 결과를 그릴 때는 **저장된 행의 판·풀**이다 */
  const drafting = !ideal || redoing || (again && round === 0 && !redone);

  const src = drafting ? { v: IDEAL_ASSET_V, pool } : { v: ideal!.v, pool: ideal!.pool };
  const { data, failed, retry } = usePool(src.v, src.pool);
  const { rounds, shown } = useMemo(
    () => (data && drafting ? roundsOf(data, start, picks, flips) : { rounds: [], shown: new Set<string>() }),
    [data, drafting, start, picks, flips],
  );

  // 시작 화면 — 어느 쪽을 고를지 모르니 두 풀의 자료와 1라운드 첫 쪽을. 첫 쪽은 이번에 집은 묶음의 것이다
  const atStart = drafting && round === 0 && funOpen;
  useEffect(() => {
    if (!atStart) return;
    for (const g of ["F", "M"] as const) {
      loadPool(IDEAL_ASSET_V, g).then(
        (p) =>
          warm(pickRound(facesForStart(p.faces, p.starts, start), 1, null, new Set()).map((f) => photo(IDEAL_ASSET_V, f.id))),
        () => {}, // 실패는 풀을 고른 뒤 그 화면이 말한다 — 실패한 약속은 캐시에 남지 않는다
      );
    }
  }, [atStart, start]);

  // 라운드 — 다음 라운드의 아홉(고르는 대로 다시 센 값), 이 라운드의 `다른 얼굴 보기`, 마지막이면 결과 셋
  useEffect(() => {
    if (!data || !drafting || round < 1) return;
    const urls: string[] = [];
    const next = rounds[round];
    if (next) urls.push(...next.map((f) => photo(IDEAL_ASSET_V, f.id)));
    if (!picks[round - 1]?.length && (flips[round - 1] ?? 0) < IDEAL_SHAPE.rerolls) {
      const f = flips.slice(0, round);
      f[round - 1] = (f[round - 1] ?? 0) + 1;
      const alt = roundsOf(data, start, picks, f).rounds[round - 1] ?? [];
      urls.push(...alt.map((x) => photo(IDEAL_ASSET_V, x.id)));
    }
    if (round === IDEAL_SHAPE.rounds && picks[round - 1]?.length) {
      urls.push(...nearestCelebs(data.celebs, centersOf(data, picks.flat()), shown).map((c) => photo(IDEAL_ASSET_V, c.id)));
    }
    warm(urls);
  }, [data, drafting, round, rounds, start, picks, flips, shown]);

  /*
   * 라운드 주소의 문. **결과가 있으면 열리지 않고**(S-C3), 고르던 값이 없으면(주소를 바로 열었거나 새로고침,
   * 탭 바로 나갔다 뒤로 왔다) 시작으로 물러난다. 이 화면이 쌓은 칸이면 되감고, 바로 연 주소면 갈아끼운다 —
   * 그 판단은 `onGo` 너머(기록을 아는 쪽)에 있다.
   *
   * **결과를 저장한 뒤의 되감기도 이 문이 한다** — 저장된 행이 그려지면(`onSaved`) 라운드 주소가 곧 "결과가 있는데
   * 라운드 주소" 가 된다. 누른 순간이 아니라 **그려진 그 순간의 칸**에서 물러나므로, 저장을 기다리는 동안
   * 뒤로 가거나 ?·✉️ 를 연 사람도 엉뚱한 칸에 닿지 않는다.
   */
  const draftOk =
    round >= 1 &&
    round <= IDEAL_SHAPE.rounds &&
    !!pool &&
    picks.slice(0, round - 1).filter((p) => p.length > 0).length === round - 1;
  /*
   * 다시 찾기의 시작 주소(`/ideal/again`)는 **열려 있고 결과가 있을 때만** 선다 (ADR-125). 새 결과가 섰으면(`redone`)
   * 할 일을 마쳤다 — 결과 주소로 물러나고 다시 찾기를 잊는다. 라운드가 저장 뒤 여기로 되감긴 그 자리다.
   */
  const againOk = funOpen && !!ideal && !redone;
  const allowed = round === 0 ? !again || againOk : draftOk && funOpen && (!ideal || redoing);
  useEffect(() => {
    if (!allowed) onGo(0, { replace: true });
  }, [round, allowed, onGo]);
  // 결과 주소에 섰으면 다시 찾기를 잊는다 — 새 결과가 섰거나, 다시 찾다가 문이 닫혀 물러났다
  useEffect(() => {
    if (round === 0 && !again && redo) setRedo(null);
  }, [round, again, redo]);

  /*
   * **화면이 바뀌면 그 화면의 머리로 포커스를 옮긴다** (ADR-129). 누른 단추(풀 고르기 · `다음`)가 사라지면 포커스가 `body` 로
   * 떨어져, 키보드와 화면 읽기 사용자는 자리를 잃고 새 라운드가 시작된 줄도 모른다. `다른 얼굴 보기` 가 이미 그렇게 하던 것을
   * 단계마다 한다. 옮기는 곳은 입력칸이 아니라 문단이라 폰 키보드가 올라오지 않는다 (ADR-63 이 막은 것과 다르다) —
   * 손가락으로 누른 뒤의 스크립트 포커스에는 테두리도 서지 않는다
   */
  const view = ideal && !redoing && !(round === 0 && again && againOk) ? "result" : round === 0 ? "start" : `round${round}`;
  useEffect(() => {
    if (view === "result") return;
    (view === "start" ? startHead : roundHead).current?.focus();
  }, [view]);

  // 다시 찾기의 풀 고르기 — 결과 대신 시작 화면이다
  if (ideal && round === 0 && again && againOk) return startScreen(true);

  if (ideal && !redoing) {
    return (
      <Result
        ideal={ideal}
        pool={data}
        failed={failed}
        onRetry={retry}
        /*
         * 다시 찾기는 열려 있는 동안만이다 — 단계가 되돌아가도 결과는 본다 (ADR-125).
         * 첫 화면 묶음을 **누른 그 자리에서** 새로 집는다 (ADR-136) — 다시 찾기의 시작 화면이 서자마자 그 묶음의 첫 쪽을 미리 받는다.
         * 재미 탭 카드의 다시 찾기는 이 화면을 새로 세우니 서면서 집는다
         */
        onAgain={
          funOpen
            ? () => {
                setStart(drawStart());
                onAgain();
              }
            : undefined
        }
        storyOn={story}
        onStory={onSaved}
        onAnswer={async (v) => {
          try {
            // 서버가 준 행을 그대로 그린다 — 이미 답했으면 그 답이 온다 (한 번만)
            onSaved(await post<Ideal>("/ideal/verdict", v));
          } catch (e) {
            toast(messageOf(e, FAIL.action));
          }
        }}
      />
    );
  }
  if (!allowed) return null;

  /**
   * 풀 고르기. 처음 찾을 때와 다시 찾을 때가 **한 줄만** 다르다 — 처음에는 부담을 덜어 주고, 다시 찾을 때는 무엇을
   * 대신하는지 **누르기 전에** 말한다 (확인창 대신이다, S-C3). 버튼 아래에 작게 두면 하나뿐인 행동을 먼저 누르고 지나간다.
   */
  function startScreen(redoStart: boolean) {
    return (
      <div className="card stack idealFlow">
        <div className="kicker">{IDEAL.title}</div>
        <h2 className="cardTitle" tabIndex={-1} ref={startHead}>
          {IDEAL.poolAsk}
        </h2>
        <p className="small dim">{redoStart ? IDEAL.againNote : IDEAL.firstNote}</p>
        {/*
          **같은 크기, 어느 쪽도 눌려 있지 않다** (S-B1). 누구에게 마음이 가는지는 앱이 정할 일이 아니다 (ADR-17) —
          내 성별의 반대를 미리 골라두지 않는다. 다시 찾을 때도 지난번 쪽을 미리 눌러 두지 않는다.
          그래서 `.choice`(하나가 늘 켜진 묶음)가 아니다.
        */}
        <div className="idealPools">
          {(["F", "M"] as const).map((g) => (
            <button
              key={g}
              className="btn"
              onClick={() => {
                /*
                 * 다른 쪽을 고르면 고르던 것은 버린다 — 같은 쪽이면 뒤로 왔다 다시 가는 것이라 그대로 둔다.
                 * **다시 찾기를 새로 시작하면 늘 비운다** — 이 화면은 결과를 본 뒤에도 같은 자리에 남아 지난번 고른 값을 들고 있다.
                 */
                if (g !== pool || (redoStart && !redo)) {
                  setPool(g);
                  setPicks([]);
                  setFlips([]);
                }
                if (redoStart && ideal) setRedo({ from: ideal.at });
                onGo(1);
              }}
            >
              {IDEAL.pool[g]}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // 재미가 닫혔으면 처음 찾기도 없다 — 참가자 화면이 재미 탭으로 물러난다. 누를 수 없는 풀 고르기를 비추지 않는다 (ADR-125)
  if (round === 0) return funOpen ? startScreen(false) : null;

  const faces = rounds[round - 1] ?? [];
  const mine = picks[round - 1] ?? [];
  const full = mine.length >= IDEAL_SHAPE.pickMax;
  const last = round === IDEAL_SHAPE.rounds;

  /**
   * `다른 얼굴 보기` — **아무것도 안 골랐고 아직 안 썼을 때만** (v2). 억지로 고른 '덜 싫은 얼굴' 이 중심을 흐리지
   * 않게 하는 길이라, 하나라도 골랐으면 필요 없다. 넘긴 아홉이 어느 쪽이었는지는 **이 라운드의 횟수**로 남는다.
   */
  const canFlip = !!data && !mine.length && (flips[round - 1] ?? 0) < IDEAL_SHAPE.rerolls;

  /**
   * 고르고 풀기·넘기기. **앞 라운드를 고치면 그 뒤 라운드는 버린다** — 고른 것도, 넘긴 쪽도.
   * 후보가 달라지니 넘긴 아홉도 이제 다른 얼굴들이다.
   */
  const edit = (next: string[], flip = flips[round - 1] ?? 0) => {
    setPicks([...picks.slice(0, round - 1), next]);
    // 앞 라운드를 한 번도 안 넘겼으면 `flips` 가 짧다 — 펼쳐 붙이면 이 라운드의 횟수가 앞 칸에 앉는다
    const f = flips.slice(0, round - 1);
    f[round - 1] = flip;
    setFlips(f);
  };
  const toggle = (id: string) => {
    if (!mine.includes(id) && full) return; // 여섯째는 골라지지 않는다 (S-B2)
    edit(mine.includes(id) ? mine.filter((x) => x !== id) : [...mine, id]);
  };

  async function finish() {
    if (saving || !data || !pool) return;
    // 답은 **안 본 사람 중에서** — 방금 본 얼굴(넘긴 쪽까지)을 돌려주는 건 답이 아니다 (S-C2).
    // 두 갈래 취향이면 두 중심을 번갈아 따른다 — 첫 사람은 큰 무리의 것이다
    const result = nearestCelebs(data.celebs, centersOf(data, picks.flat()), shown).map((c) => c.id);
    const input: IdealInput = { v: IDEAL_ASSET_V, pool, picks, result, start };
    // 다시 찾기면 지금 결과를 가리킨다 — 그 사이 다른 기기가 바꿨으면 서버가 먼저 온 것을 남긴다 (ADR-125 · S-E2)
    const body = redoing && redo ? { ...input, replaces: redo.from } : input;
    setSaving(true);
    try {
      /*
       * **서버가 준 행을 그린다** (S-E2). 다른 기기가 먼저 끝냈으면 그쪽이 온다 — 방금 고른 셋이 아닐 수 있다.
       * 방금 받은 답을 버리고 `/me` 를 다시 읽지 않는다 (14 의 `/vote` 와 같은 이유).
       * 그린 **뒤에** 옮긴다 — 먼저 옮기면 `/ideal` 이 한 순간 풀 고르기로 그려진다.
       * 옮기는 건 라운드 주소의 문(위 가드)이 한다 — 결과가 그려진 그 순간의 칸에서 물러난다.
       * 저장하는 동안 뒤로 갔거나 ?·✉️ 를 열었어도 결과는 그려지고, 문이 **그때 선 칸**에서 물러난다.
       */
      onSaved(await post<Ideal>("/ideal", body));
    } catch (e) {
      toast(messageOf(e, FAIL.action));
    } finally {
      setSaving(false);
    }
  }

  /*
   * 라운드 화면은 **카드에 담지 않는다.** 카드의 안쪽 여백·테두리만큼 격자가 좁아져 360px 폭에서 한 칸이
   * 93px 이 됐다 (S-B2 는 100px 이상). 본문 여백만 남기면 104px 이다 — 아래 `.faceGrid` 의 계산.
   */
  return (
    <div className="stack idealFlow">
      {/* 라운드 화면에는 이름도, '연예인' 이라는 말도 없다 (S-B5) — 이름을 알고 고르면 팬심으로 고른다 */}
      {/*
        라운드의 머리 — 포커스가 서는 자리다 (ADR-129). 몇 번째인지와 안내를 한 덩어리로 묶어, 화면 읽기가 새 라운드에서
        `2 / 3` 부터 읽는다. 2 · 3라운드는 앞에서 고른 얼굴과 닮은 얼굴이라는 것을 먼저 말한다 — 얼굴이 왜 비슷해지는지
      */}
      <div className="stack idealHead" tabIndex={-1} ref={roundHead}>
        <div className="kicker">{IDEAL.roundCount(round)}</div>
        {round > 1 && <p className="small dim">{IDEAL.roundNarrow}</p>}
        <p className="idealHint">{IDEAL.roundHint}</p>
      </div>
      {failed ? (
        <LoadFail onRetry={retry} />
      ) : !data ? (
        /*
         * 받는 동안에도 **자리는 그대로다** — 아홉 칸이 4:5 로 먼저 선다. 비워 두면 파티장 와이파이에서
         * 힌트와 버튼만 있는 화면이 고장으로 읽히고, 얼굴이 들어오는 순간 버튼이 아래로 튄다.
         */
        <div className="faceGrid" aria-busy="true">
          {Array.from({ length: IDEAL_SHAPE.faces }, (_, i) => (
            <span key={i} className="faceTile" aria-hidden />
          ))}
        </div>
      ) : (
        <div className="faceGrid">
          {faces.map((f, i) => {
            const on = mine.includes(f.id);
            return (
              <button
                key={f.id}
                className="faceTile"
                aria-pressed={on}
                // 이름 대신 번호만 — 대체 글에도 이름이 없다 (S-B5)
                aria-label={IDEAL.face(i + 1)}
                // 다섯을 골랐으면 나머지는 꺼진다. 눌러도 아무 일이 없다 — 푸는 건 고른 쪽에서 한다
                aria-disabled={(!on && full) || undefined}
                onClick={() => toggle(f.id)}
              >
                <img src={photo(IDEAL_ASSET_V, f.id)} width={W} height={H} alt="" />
                {/* 골랐음은 색으로만 말하지 않는다 — 테두리와 ✓ (S-B6) */}
                {on && (
                  <span className="faceCheck" aria-hidden>
                    ✓
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {last ? (
        <>
          {/*
            다시 찾는 중이면 이 버튼이 지난 결과를 대신한다 — 시작 화면에서 한 말을 **누르는 자리에서** 한 번 더 한다 (S-C3).
            처음 찾을 때는 대신할 것이 없다 (ADR-125)
          */}
          {redoing && <p className="small dim">{IDEAL.againNote}</p>}
          <button className="btn primary block" disabled={!mine.length || !data || saving} onClick={finish}>
            {saving ? IDEAL.saving : IDEAL.finish}
          </button>
        </>
      ) : (
        <button className="btn primary block" disabled={!mine.length} onClick={() => onGo(round + 1)}>
          {IDEAL.next}
        </button>
      )}
      {/*
        주된 행동(`다음`) 아래의 옅은 버튼 — 주소는 그대로다. push 하면 뒤로 가기가 넘긴 쪽을 되살리는 칸이 된다.
        누르면 이 버튼이 사라진다(라운드마다 한 번) — 포커스를 라운드 머리로 옮기지 않으면 `body` 로 떨어져 키보드·
        화면 읽기 사용자가 자리를 잃는다. 아홉 칸은 이름표(1~9번)가 같아 바뀐 줄도 모른다 — 머리에서 다시 읽게 한다.
      */}
      {canFlip && (
        <button
          className="btn ghost block"
          onClick={() => {
            edit([], (flips[round - 1] ?? 0) + 1);
            roundHead.current?.focus();
          }}
        >
          {IDEAL.reroll}
        </button>
      )}
    </div>
  );
}

/**
 * 끌린 얼굴의 특징 한 장 (ADR-127 · ADR-128). 점수 · % · 순위는 없다 — 글뿐이다.
 * 무게는 크기가 아니라 차이로 준다 — 제목, 그 얼굴에서 읽히는 사람(본문), 고른 얼굴의 특징(흐리게), 연구 한 줄(가장 작게).
 * 두드러진 것이 없었다는 것도 답이다 — 카드를 감추지 않고 그렇다고 말한다 (`IDEAL.traits` 가 정한다)
 *
 * **설명글(ADR-134)이 있으면 제목 아래가 그 글이다** — 같은 화면에서 고르지 않은 얼굴과 견줘 쓴 두 문장과, 무엇과 견줬는지 한 줄.
 * 기다리는 동안에는 그 자리에 한 줄을 세운다. 제목은 그대로다 — 고른 얼굴의 짧은 이름표다.
 * 한 카드가 세 모양을 다 그린다 — 글이 와도 제목(포커스가 선 자리)이 그대로 남는다
 */
function TraitsCard({ traits, story, waiting }: { traits: IdealTraits; story?: string; waiting?: boolean }) {
  const text = IDEAL.traits(traits);
  return (
    <section className="card stack" aria-busy={waiting || undefined}>
      <div className="kicker">{IDEAL.traitsKicker}</div>
      {/* 결과가 그려질 때 포커스가 서는 첫 제목이다 (ADR-129, `Result`) */}
      <h2 className="cardTitle" tabIndex={-1}>
        {text.title}
      </h2>
      {story ? (
        <>
          <p className="idealPerson">{story}</p>
          <p className="idealNote">{IDEAL.storyNote}</p>
        </>
      ) : waiting ? (
        <p className="idealDetail">{IDEAL.storyWaiting}</p>
      ) : (
        <>
          {text.person && <p className="idealPerson">{text.person}</p>}
          {text.detail && <p className="idealDetail">{text.detail}</p>}
          <p className="idealNote">{text.note}</p>
        </>
      )}
    </section>
  );
}

/** 얼굴 자료를 못 받았다. **화면 안에서** 말한다 — 토스트는 곧 사라지고 화면은 빈 채로 남는다 (ADR-65) */
function LoadFail({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="stack center">
      <p className="dim small">{IDEAL.loadFail}</p>
      <button className="btn" onClick={onRetry}>
        {IDEAL.retry}
      </button>
    </div>
  );
}

/**
 * 결과 — 연예인 셋, 정답 물음, 고른 얼굴 (S-C1 · S-C4 · S-C2).
 *
 * **저장된 행의 `v`·`pool` 로 그린다** — 판이 올라가도 옛 결과는 옛 경로에서 그대로다.
 * 순서만 있다. `%`·점수·순위 숫자를 붙이지 마라 — 운세에 점수가 없는 이유 그대로다 (ADR-20).
 *
 * **물음이 결과 바로 아래다** (S-C4 "결과 셋 … 그 아래"). 고른 얼굴(최대 열다섯)을 사이에 두면 물음이 두 화면 아래로
 * 밀려 이 페이지에서 가장 놓치기 쉬운 것이 된다 — 실전에서 결과를 재는 유일한 신호인데. 고른 얼굴은 결과 아래
 * 따로 있으면 된다 (S-C2) — 맨 끝이어도 그 약속은 그대로다.
 */
function Result({
  ideal,
  pool,
  failed,
  onRetry,
  onAnswer,
  onAgain,
  storyOn,
  onStory,
}: {
  ideal: Ideal;
  pool?: Pool;
  failed: boolean;
  onRetry: () => void;
  onAnswer: (v: IdealVerdict) => Promise<void>;
  /** 다시 찾기 (ADR-125). 재미가 닫혔으면 없다 */
  onAgain?: () => void;
  /** 설명글(ADR-134)이 켜진 곳인가 */
  storyOn?: boolean;
  /** 설명글이 붙은 행을 받았다 — 서버가 준 행을 그대로 갈아끼운다 */
  onStory: (ideal: Ideal) => void;
}) {
  const [answering, setAnswering] = useState(false);
  /**
   * 설명글 (ADR-134) — 켜진 곳에서, **지금 판의 결과에 글이 아직 없으면** 한 번 청한다. 화면은 고른 얼굴과 그 결과의
   * 첫 화면 묶음으로 다시 세운다 (`shownPages` — 서버는 벡터를 모른다, ADR-136). 결과마다 한 번만 묻는다(`asked`) —
   * StrictMode 가 효과를 두 번 돌려도 같다.
   * 실패하면 그 결과에는 낱말로 쓴 글(ADR-128)을 그린다 — 다음에 결과를 열면 다시 청한다
   */
  const wantStory = !!storyOn && ideal.v === IDEAL_ASSET_V && !ideal.story;
  const [storyFailed, setStoryFailed] = useState<number | null>(null);
  const asked = useRef<number | null>(null);
  useEffect(() => {
    if (!wantStory || !pool || asked.current === ideal.at) return;
    asked.current = ideal.at;
    const at = ideal.at;
    const pages = shownPages(facesForStart(pool.faces, pool.starts, ideal.start), pool.vecs, ideal.picks).slice(1);
    post<Ideal>("/ideal/story", { pages }).then(
      (row) => (row.story ? onStory(row) : setStoryFailed(at)),
      () => setStoryFailed(at),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantStory, pool, ideal.at]);
  const storyWaiting = wantStory && storyFailed !== ideal.at;
  /** 정답으로 누른 이름들 (ADR-127). 보내기 전까지 이 화면에만 있다 — 눌러 켜고 다시 눌러 끈다 */
  const [sel, setSel] = useState<string[]>([]);
  const pickedId = useId();
  const verdict = ideal.verdict;
  /*
   * 포커스 (ADR-129) — 결과가 그려지면 **첫 제목**으로(끌린 얼굴, 아직 자료가 없으면 결과 셋의 제목), 답을 보내면 **그 답**으로.
   * 누른 단추(`결과 보기` · `답 보내기` · `없음`)가 사라지는 자리라 그대로 두면 포커스가 `body` 로 떨어진다.
   * 처음부터 답이 있던 결과를 열 때는 답으로 옮기지 않는다 — 방금 보낸 답만이다
   */
  const top = useRef<HTMLDivElement>(null);
  const answerLine = useRef<HTMLParagraphElement>(null);
  const answered = useRef(false);
  useEffect(() => {
    if (!failed) top.current?.querySelector<HTMLElement>("h2")?.focus();
  }, [failed]);
  useEffect(() => {
    if (!verdict || !answered.current) return;
    answered.current = false;
    answerLine.current?.focus();
  }, [verdict]);
  if (failed) {
    return (
      <div className="card stack idealFlow">
        <LoadFail onRetry={onRetry} />
      </div>
    );
  }
  /*
   * 이름은 자산에만 있다 (S-D3). **받는 동안에도 틀은 그린다** — 사진은 저장된 행의 id 로 바로 부를 수 있고,
   * 비어 있는 탭 본문은 파티장 와이파이에서 고장으로 읽힌다. 이름 자리는 한 줄을 지켜 들어올 때 튀지 않게 하고,
   * 이름이 있어야 답할 수 있는 물음은 이름이 온 뒤에 선다.
   */
  const name = (id: string) => pool?.names.get(id);

  const answer = async (v: IdealVerdict) => {
    if (answering) return;
    setAnswering(true);
    // 답이 그려지는 렌더보다 먼저 적는다 — 저장된 행이 그려지는 것이 이 함수가 돌아오기 전일 수 있다
    answered.current = true;
    try {
      await onAnswer(v);
    } finally {
      setAnswering(false);
    }
  };
  const traits = pool ? traitsOf(pool, ideal.picks) : null;

  return (
    <div className="stack idealFlow" ref={top}>
      {/*
        끌린 얼굴의 특징 (ADR-127) — 결과 얼굴보다 **위**다. 문장이 먼저 `이런 얼굴` 을 말하고, 연예인 셋이 그 예가 된다.
        결과 화면에만 선다. 재미 탭 입구 카드에는 싣지 않는다 — 결과 얼굴과 같은 어깨너머다 (ADR-125)
      */}
      {traits && <TraitsCard traits={traits} story={ideal.story} waiting={storyWaiting} />}
      <section className="card stack">
        {/* '연예인' 이라는 말이 처음 나오는 자리다 (S-B5) */}
        <div className="kicker">{IDEAL.resultKicker}</div>
        <h2 className="cardTitle" tabIndex={-1}>
          {IDEAL.resultTitle}
        </h2>
        {/* 첫 사람이 답이라 크게. 낯설면 둘째가 구해준다 */}
        <ol className="idealResult" aria-busy={!pool || undefined}>
          {ideal.result.map((id, i) => (
            <li key={id} className={i === 0 ? "top" : undefined}>
              <img src={photo(ideal.v, id)} width={W} height={H} alt="" />
              <span className="name">{name(id) ?? "\u00a0"}</span>
            </li>
          ))}
        </ol>
      </section>

      {/*
        정답은 **결과마다 한 번** 묻는다 (S-C4). 답하면 물음이 답으로 바뀌고 다시 묻지 않는다 — 답이 결과를 바꾸지 않는다.
        답하지 않아도 아무 일 없다 — 다음에 열면 물음이 그대로 있다. 다시 찾은 결과에는 다시 묻는다 (ADR-125).
      */}
      {pool && (
        <section className="card stack">
          {verdict ? (
            <p className="idealAnswer" tabIndex={-1} ref={answerLine}>
              {"chosen" in verdict ? IDEAL.verdictChosen(verdict.chosen.map((id) => name(id) ?? "")) : IDEAL.verdictNoneDone}
            </p>
          ) : (
            <>
              <p className="idealAnswer">{IDEAL.verdictAsk}</p>
              {/*
                **여럿을 고를 수 있다** (ADR-127) — 이름은 켜고 끄는 단추이고, 보내기는 따로다. `없음` 은 그 자체로 답이라
                바로 보낸다. 켠 것은 색만이 아니라 ✓ 로도 말한다 (S-B6 과 같은 이유).
                **이름 셋은 같은 폭의 세 칸이다** — 이름 길이로 폭이 갈리면 단추가 들쭉날쭉하고, 켤 때 ✓ 가 글자 앞에 붙으면
                눌린 단추가 커져 옆 단추를 민다. ✓ 는 모서리에 얹는다.
                **단추마다 그 사람의 얼굴이 함께 선다** (ADR-129). 이 물음을 읽을 때쯤 첫 사진은 이미 화면 위로 지나가 있어서,
                이름만으로는 덜 알려진 사람의 얼굴을 떠올려 답해야 했다 — 결과를 재는 유일한 신호가 기억력을 재고 있었다.
                사진은 결과에 이미 받아 둔 그 주소라 새로 받지 않는다. 이름표는 그대로 이름이다(`alt=""`)
              */}
              <div className="idealVerdicts">
                {ideal.result.map((id) => {
                  const on = sel.includes(id);
                  return (
                    <button
                      key={id}
                      className={on ? "btn primary" : "btn"}
                      aria-pressed={on}
                      disabled={answering}
                      onClick={() => setSel(on ? sel.filter((x) => x !== id) : [...sel, id])}
                    >
                      {/* ✓ 는 이름표에서 뺀다 — 켜졌는지는 aria-pressed 가 말하고, 이름은 그대로 이름이다 */}
                      {on && (
                        <span className="verdictCheck" aria-hidden>
                          ✓
                        </span>
                      )}
                      <img src={photo(ideal.v, id)} width={W} height={H} alt="" />
                      <span>{name(id)}</span>
                    </button>
                  );
                })}
              </div>
              {/* 답하는 두 길 — 같은 폭으로 나란히. `없음` 은 바로 보내고, 보내기는 이름을 켜야 눌린다 */}
              <div className="idealVerdictActions">
                <button className="btn ghost" disabled={answering} onClick={() => answer({ none: true })}>
                  {IDEAL.verdictNone}
                </button>
                <button className="btn primary" disabled={answering || !sel.length} onClick={() => answer({ chosen: sel })}>
                  {IDEAL.verdictSubmit}
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {/*
        **다시 찾기는 정답 물음 바로 아래다** (ADR-125) — 답을 먼저 하고 다시 찾게 되는 순서다. 위에 두면 답 없이
        다시 찾게 되고, 실전에서 결과를 재는 유일한 신호(S-C4)가 비어 간다. 고른 얼굴(최대 열다섯) 아래에 두면 두 화면 아래다.
      */}
      {onAgain && (
        <button className="btn ghost block" onClick={onAgain}>
          {IDEAL.again}
        </button>
      )}

      {/*
        골랐던 얼굴도 이상형에 가까운 얼굴들이다 — 버리지 않고 되돌아보게 한다 (S-C2). 결과 화면이라 이름을 작게 붙인다.
        제목이 이 묶음의 이름이다(`aria-labelledby`) — 읽어주는 기기도, 화면을 재는 테스트도 제목으로 이 묶음을 찾는다.
      */}
      <section className="card stack" aria-labelledby={pickedId}>
        <div className="kicker" id={pickedId}>
          {IDEAL.pickedTitle}
        </div>
        <ul className="faceGrid idealPicked">
          {ideal.picks.flat().map((id) => (
            <li key={id}>
              <img src={photo(ideal.v, id)} width={W} height={H} alt="" />
              {name(id) && <span className="tiny dim faceName">{name(id)}</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
