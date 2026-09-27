/**
 * 이상형 찾기 (슬라이스 19) — 시작 · 라운드 셋 · 결과. **재미 탭 안의 페이지**다 (시트가 아니다 — `/me/edit` 과 같은 자리).
 *
 *   /ideal       결과가 없으면 풀 고르기, **있으면 결과** — 같은 주소가 상태를 따라간다
 *   /ideal/1..3  라운드. 한 칸씩 push — 뒤로 가기가 곧 이전 라운드다 (S-B4, 등록 스텝과 같다)
 *
 * **고르던 값은 이 컴포넌트의 메모리에만 있다** (S-B4 · S-E1). 참가자 화면이 이 컴포넌트를 `/ideal` 과 라운드
 * 주소 사이에서 한 자리에 두어 값이 산다. 재미 탭으로 나가면 사라진다 — 1분짜리라 이어 하기를 만들지 않는다.
 *
 * 계산은 전부 기기에서 한다 (S-D3). 서버에는 고른 id 와 결과 id 만 간다.
 * 얼굴 자료는 **여기서만** 받는다 — 풀을 고른 뒤에, 또는 결과를 그릴 때. 재미 탭 카드만 보는 사람은 받지 않는다.
 *
 * 따로 싣는 조각이다 (`React.lazy`) — 탭 카드는 `IdealCard.tsx` 에 있다.
 */
import { useEffect, useId, useMemo, useState } from "react";
import { FAIL, IDEAL } from "../../shared/copy.ts";
import {
  IDEAL_ASSET_V,
  IDEAL_SHAPE,
  decodeVec,
  meanOf,
  nearestCelebs,
  pickRound,
  type DecodedCeleb,
  type DecodedFace,
  type FacePoolFile,
  type Ideal,
  type IdealInput,
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
  if (!f.faces.every(ok) || !f.celebs.every((c) => ok(c) && typeof c.name === "string")) return null;
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
  }));
  return {
    faces,
    celebs,
    vecs: new Map(faces.map((f) => [f.id, f.vec])),
    names: new Map(celebs.map((c) => [c.id, c.name])),
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
/** 자산의 픽셀 크기 (4:5). 먼저 자리를 잡아 사진이 들어올 때 화면이 튀지 않는다 */
const W = 240;
const H = 300;

/**
 * 라운드마다 보여줄 여섯. **고르던 값에서 매번 다시 센다** — 앞 라운드를 고쳐 고르면 뒤 라운드의 후보도
 * 달라져야 한다 (앞의 선택이 뒤의 후보를 정한다). 같은 입력이면 같은 여섯이라, 뒤로 갔다 와도 그대로다.
 * 앞 라운드를 아직 안 골랐으면 거기서 멈춘다.
 */
function roundsOf(pool: Pool, picks: readonly string[][]): DecodedFace[][] {
  const shown = new Set<string>();
  const out: DecodedFace[][] = [];
  for (let r = 1; r <= IDEAL_SHAPE.rounds; r++) {
    if (r > 1 && !picks[r - 2]?.length) break;
    const before = picks.slice(0, r - 1).flat();
    // 평균은 지금까지 고른 얼굴 전부 — 라운드 가중치가 없다. 안 고른 얼굴은 쓰지 않는다
    const mean = r === 1 ? null : meanOf(before.map((id) => pool.vecs.get(id)!));
    const faces = pickRound(pool.faces, r as 1 | 2 | 3, mean, shown);
    for (const f of faces) shown.add(f.id);
    out.push(faces);
  }
  return out;
}

// ─────────────────────────────────────────── 화면

interface Props {
  /** 0 = `/ideal`, 1~3 = 라운드. 그 밖의 값은 없는 주소다 — 시작으로 갈아끼운다 */
  round: number;
  /** 저장된 결과. 있으면 라운드 주소는 열리지 않는다 (S-C3) */
  ideal?: Ideal;
  /**
   * 0 = 시작, 1~3 = 라운드. 라운드는 push, `replace` 는 가드가 쓴다 — **열리면 안 되는 라운드 주소에서 물러나라**는 뜻이고,
   * 되감을지 갈아끼울지는 기록을 아는 쪽(참가자 화면)이 **그 순간의 칸**을 보고 정한다
   */
  onGo: (to: number, opts?: { replace?: boolean }) => void;
  /** 서버가 돌려준 행 하나만 갈아끼운다 (`setFortune` 과 같은 좁은 통로) */
  onSaved: (ideal: Ideal) => void;
}

export default function IdealFlow({ round, ideal, onGo, onSaved }: Props) {
  const [pool, setPool] = useState<Gender | null>(null);
  const [picks, setPicks] = useState<string[][]>([]);
  const [saving, setSaving] = useState(false);
  const { toast } = useOverlay();

  const src = ideal ? { v: ideal.v, pool: ideal.pool } : { v: IDEAL_ASSET_V, pool };
  const { data, failed, retry } = usePool(src.v, src.pool);
  const rounds = useMemo(() => (data && !ideal ? roundsOf(data, picks) : []), [data, ideal, picks]);

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
  const open = round === 0 || (!ideal && draftOk);
  useEffect(() => {
    if (!open) onGo(0, { replace: true });
  }, [round, open, onGo]);

  if (ideal) {
    return (
      <Result
        ideal={ideal}
        pool={data}
        failed={failed}
        onRetry={retry}
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
  if (!open) return null;

  if (round === 0) {
    return (
      <div className="card stack idealFlow">
        <div className="kicker">{IDEAL.title}</div>
        <h2 className="cardTitle">{IDEAL.poolAsk}</h2>
        {/*
          한 번 찾으면 그대로라는 것을 **누르기 전에** 읽히게 말한다 (S-C3) — 확인창을 띄우지 않는 대신이다.
          버튼 아래에 작게 두면 하나뿐인 행동을 먼저 누르고 지나간다.
        */}
        <p className="small dim">{IDEAL.once}</p>
        {/*
          **같은 크기, 어느 쪽도 눌려 있지 않다** (S-B1). 누구에게 마음이 가는지는 앱이 정할 일이 아니다 (ADR-17) —
          내 성별의 반대를 미리 골라두지 않는다. 그래서 `.choice`(하나가 늘 켜진 묶음)가 아니다.
        */}
        <div className="idealPools">
          {(["F", "M"] as const).map((g) => (
            <button
              key={g}
              className="btn"
              onClick={() => {
                // 다른 쪽을 고르면 고르던 것은 버린다 — 같은 쪽이면 뒤로 왔다 다시 가는 것이라 그대로 둔다
                if (g !== pool) {
                  setPool(g);
                  setPicks([]);
                }
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

  const faces = rounds[round - 1] ?? [];
  const mine = picks[round - 1] ?? [];
  const full = mine.length >= IDEAL_SHAPE.pickMax;
  const last = round === IDEAL_SHAPE.rounds;

  /** 고르고 풀기. **앞 라운드를 고치면 그 뒤 라운드에서 고른 것은 버린다** — 후보가 달라진다 */
  const toggle = (id: string) => {
    if (!mine.includes(id) && full) return; // 네 번째는 골라지지 않는다 (S-B2)
    const next = mine.includes(id) ? mine.filter((x) => x !== id) : [...mine, id];
    setPicks([...picks.slice(0, round - 1), next]);
  };

  async function finish() {
    if (saving || !data || !pool) return;
    const shown = new Set(rounds.flat().map((f) => f.id));
    const mean = meanOf(picks.flat().map((id) => data.vecs.get(id)!));
    // 답은 **안 본 사람 중에서** — 방금 본 얼굴을 돌려주는 건 답이 아니다 (S-C2)
    const result = nearestCelebs(data.celebs, mean, shown).map((c) => c.id);
    const input: IdealInput = { v: IDEAL_ASSET_V, pool, picks, result };
    setSaving(true);
    try {
      /*
       * **서버가 준 행을 그린다** (S-E2). 다른 기기가 먼저 끝냈으면 그쪽이 온다 — 방금 고른 셋이 아닐 수 있다.
       * 방금 받은 답을 버리고 `/me` 를 다시 읽지 않는다 (14 의 `/vote` 와 같은 이유).
       * 그린 **뒤에** 옮긴다 — 먼저 옮기면 `/ideal` 이 한 순간 풀 고르기로 그려진다.
       * 옮기는 건 라운드 주소의 문(위 가드)이 한다 — 결과가 그려진 그 순간의 칸에서 물러난다.
       * 저장하는 동안 뒤로 갔거나 ?·✉️ 를 열었어도 결과는 그려지고, 문이 **그때 선 칸**에서 물러난다.
       */
      onSaved(await post<Ideal>("/ideal", input));
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
      <div className="kicker">{IDEAL.roundCount(round)}</div>
      <p className="idealHint">{IDEAL.roundHint}</p>
      {failed ? (
        <LoadFail onRetry={retry} />
      ) : !data ? (
        /*
         * 받는 동안에도 **자리는 그대로다** — 여섯 칸이 4:5 로 먼저 선다. 비워 두면 파티장 와이파이에서
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
                // 셋을 골랐으면 나머지는 꺼진다. 눌러도 아무 일이 없다 — 푸는 건 고른 쪽에서 한다
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
          {/* 되돌릴 수 없는 버튼은 이것 하나다 — 시작 화면에서 한 말을 **누르는 자리에서** 한 번 더 한다 (S-C3) */}
          <p className="small dim">{IDEAL.once}</p>
          <button className="btn primary block" disabled={!mine.length || !data || saving} onClick={finish}>
            {saving ? IDEAL.saving : IDEAL.finish}
          </button>
        </>
      ) : (
        <button className="btn primary block" disabled={!mine.length} onClick={() => onGo(round + 1)}>
          {IDEAL.next}
        </button>
      )}
    </div>
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
 * **물음이 결과 바로 아래다** (S-C4 "결과 셋 … 그 아래"). 고른 얼굴(최대 아홉)을 사이에 두면 물음이 두 화면 아래로
 * 밀려 이 페이지에서 가장 놓치기 쉬운 것이 된다 — 실전에서 결과를 재는 유일한 신호인데. 고른 얼굴은 결과 아래
 * 따로 있으면 된다 (S-C2) — 맨 끝이어도 그 약속은 그대로다.
 */
function Result({
  ideal,
  pool,
  failed,
  onRetry,
  onAnswer,
}: {
  ideal: Ideal;
  pool?: Pool;
  failed: boolean;
  onRetry: () => void;
  onAnswer: (v: IdealVerdict) => Promise<void>;
}) {
  const [answering, setAnswering] = useState(false);
  const pickedId = useId();
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
    try {
      await onAnswer(v);
    } finally {
      setAnswering(false);
    }
  };
  const verdict = ideal.verdict;

  return (
    <div className="stack idealFlow">
      <section className="card stack">
        {/* '연예인' 이라는 말이 처음 나오는 자리다 (S-B5) */}
        <div className="kicker">{IDEAL.resultKicker}</div>
        <h2 className="cardTitle">{IDEAL.resultTitle}</h2>
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
        정답은 **한 번** 묻는다 (S-C4). 답하면 물음이 답으로 바뀌고 다시 묻지 않는다 — '없었어요' 도 다시 찾기를 열지 않는다.
        답하지 않아도 아무 일 없다 — 다음에 열면 물음이 그대로 있다.
      */}
      {pool && (
        <section className="card stack">
          {verdict ? (
            <p className="idealAnswer">
              {"chosen" in verdict ? IDEAL.verdictChosen(name(verdict.chosen) ?? "") : IDEAL.verdictNoneDone}
            </p>
          ) : (
            <>
              <p className="idealAnswer">{IDEAL.verdictAsk}</p>
              <div className="idealVerdicts">
                {ideal.result.map((id) => (
                  <button key={id} className="btn" disabled={answering} onClick={() => answer({ chosen: id })}>
                    {name(id)}
                  </button>
                ))}
                <button className="btn ghost" disabled={answering} onClick={() => answer({ none: true })}>
                  {IDEAL.verdictNone}
                </button>
              </div>
            </>
          )}
        </section>
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
