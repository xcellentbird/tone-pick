# 슬라이스 19 — 공개 표면

시나리오: `19-ideal-type.md`

**여기 적힌 것만 계약이다.** 내부 구조 — DO 안을 어떻게 나눌지, 라운드 화면을 컴포넌트로
어떻게 쪼갤지 — 는 구현자가 정한다. 테스트도 이 표면에만 붙는다.

시나리오의 고정점 넷이 이 문서의 뼈대다 — 버전 있는 자산 · 순수 함수 둘 · `v` 를 새긴 저장 ·
`v` 가 실린 집계(`pulse`). **여기 없는 필드를 응답에 늘리는 것이 이 슬라이스의 사고다** (S-D1).

---

## 타입 — `src/shared/ideal.ts`

운세(`shared/fortune.ts`)와 같은 자리다 — 타입과 순수 함수만, DO·요청·시각에 닿지 않는다.

```ts
import type { Gender } from "./types.ts";

/** 한 사람의 이상형 찾기 한 벌. 회차 DO 에 1인 1행 */
export interface Ideal {
  /** 결과를 만든 한 벌(자산+규칙)의 버전. 규칙만 바뀌어도 올린다 — 반응을 비교하는 열쇠 */
  v: number;
  pool: Gender;
  /** 라운드별 고른 얼굴 id — 셋 묶음, 각 1~5개 (S-C2 가 다시 그릴 재료. v1 행은 1~3개) */
  picks: string[][];
  /** 가까운 순서의 연예인 id 셋 (S-C1) */
  result: string[];
  /** 첫 화면 묶음 번호 (ADR-136) — 찾기를 시작할 때 기기가 집는다. 그 사람이 본 화면을 다시 세우는 열쇠. 없으면 0 (v5 까지) */
  start?: number;
  /** 결과 확정 (S-C4). 한 번 채워지면 그대로 — 없으면 아직 무응답이다 */
  verdict?: IdealVerdict;
  at: number;
}

export type IdealVerdict = { chosen: string[] } | { none: true };   // 1~3명, 결과 순서 (ADR-127). v2 까지의 { chosen: "id" } 는 읽을 때 편다

/** 기기가 보내는 것. verdict 는 따로 온다 — 결과를 본 뒤에야 생기는 값이다 (S-C4) */
export type IdealInput = Omit<Ideal, "verdict" | "at">;
```

상태에 실리는 자리는 한 칸이다.

```ts
ParticipantState.ideal?: Ideal
```

`PublicPlayer` · `HostState` 에는 **아무것도 늘지 않는다.** 타입에 없으면 화면이 실수로도 못 보여준다 —
14 의 표와 같은 방식이다.

크기 상수는 `ideal.ts` 의 한 곳에 둔다 (문구 `copy.ts` 의 `IDEAL` 과 이름이 겹치지 않게).

```ts
export const IDEAL_SHAPE = {
  rounds: 3, faces: 9, pickMin: 1, pickMax: 5, results: 3,
  /** 라운드마다 `다른 얼굴 보기` 횟수 (S-B7) */
  rerolls: 1,
  /** faces × (1 + rerolls) — 1라운드는 두 쪽(아홉 + 아홉). 어느 얼굴인지는 첫 화면 묶음이 정한다 */
  level1: 18,
  /** 2라운드 후보(군집 대표). 아홉 × 두 쪽을 넉넉히 덮는다 */
  level2: 36,
  /** 첫 화면 묶음 수 (ADR-136) — 번호 0 은 자산의 단계 그대로, 1 이상은 자산의 `starts`. 찾기를 시작할 때 하나를 무작위로 집는다 */
  starts: 16,
  /** 3라운드 닮은꼴 문턱(코사인). 임시값 — 실제 풀에서 종이 검증과 함께 조정한다. v4 공간에서는 걸리지 않는다 (ADR-132) */
  dupCos: 0.9,
  /** 두 무리의 평균끼리 코사인이 이보다 작으면 두 갈래 — **공간에 매인 값**이다. v1~v3 −0.2 (ADR-123) · v4 −0.3 (ADR-132) */
  splitCos: -0.3,
  /** 작은 무리가 이만큼은 돼야 두 갈래 — 한 장짜리는 잘못 누른 것일 수 있다 */
  splitMin: 2,
  id: /^[a-z0-9]{4,16}$/,        // copy-ok
} as const;

/** 지금 기기가 새로 찾을 때 쓰는 판 — `/faces/v{n}/` 의 n. 저장된 결과는 이 값이 아니라 자기 `v` 로 그린다 */
export const IDEAL_ASSET_V = 6;

/** 모양 검사 둘 (아래 API). 맞지 않으면 null */
export function readIdealInput(raw: unknown): IdealInput | null;
export function readIdealVerdict(raw: unknown, result: readonly string[]): IdealVerdict | null;
/** 다시 찾기가 가리킨 결과의 `at` (ADR-125). 없으면 undefined(처음 찾기), 모양이 틀리면 null(400) */
export function readIdealReplaces(raw: unknown): number | undefined | null;
```

> **고쳤다 (2026-09-28, ADR-123)** — v1 은 `faces: 6 · pickMax: 3` 이고 `rerolls`·`level1`·`level2`·`splitCos`·`splitMin` 이 없었으며
> `IDEAL_ASSET_V = 1` 이었다. v1 결과는 자기 `v` 로 `/faces/v1/` 에서 그대로 그린다 — 그 경로는 지우지 않는다.
>
> **다시 고쳤다 (2026-10-03, ADR-132)** — 판은 v3(ADR-127)을 거쳐 **v4** 다. 벡터가 얼굴 모델의 것으로 바뀌어 공간에 매인 `splitCos` 를
> −0.2 에서 −0.3 으로 다시 쟀다. 모양(칸 · 수)은 그대로다.
>
> **또 고쳤다 (2026-10-10, ADR-135)** — **v5** 는 v4 에 사람만 더한 판이다(여 536 · 남 580). 모양 · 규칙은 그대로다.
>
> **또 고쳤다 (2026-10-10, ADR-136)** — **v6** 은 v5 에 **첫 화면 묶음**(`starts`)을 더한 판이다. 사람 · 사진 · 벡터 · 0번 묶음의 화면은 v5 그대로다.
> 1라운드가 더는 모두에게 같지 않다 — 기기가 찾을 때마다 16벌 중 하나를 집고, 그 번호(`start`)를 결과와 함께 저장한다.

**모양 검사는 요청 본문을 펼치지 않는다 — 고른 칸으로 새 객체를 짓는다.** 펼쳐 담으면 기기가 보낸
모르는 키가 저장돼 `ParticipantState.ideal` 로 매번 되돌아 나간다 (S-D1). `verdict`·`at` 을 저장 요청에
실어 미리 박는 길도 같은 구멍이다. `v` 는 1 이상 **9999 이하**의 정수다 — 지표 blob 으로 흘러간다.
`start` 는 없거나 0 ~ `starts − 1` 의 정수다 — 없으면 없는 채로 저장한다(v5 까지 · 배포 전에 열어 둔 탭).
`replaces`(다시 찾기, ADR-125)는 따로 읽고 **저장하지 않는다** — `IdealInput` 에 없는 칸이다.

---

## 자산 — 앱이 읽는 것만 적는다 (파이프라인은 ADR-122)

사진은 **실사**다 — 고르는 것도 결과도 (S-C5). 출처 확보가 파이프라인의 첫 일이고,
그 전에는 **화면을 열지 않는다** — 문은 빌드가 연다. 지금 판(`IDEAL_ASSET_V`)의 풀 JSON 둘이 빌드에 없으면
카드도 `/ideal` 주소도 없다 (`src/client/lib/faces.ts`, `vite.config.ts`, 아래 `출시의 문`). 출처 순서와 벡터를 만드는 법은
ADR-122 · ADR-132 에 있다 — v1~v3 은 정해진 낱말 열다섯 가지를 속성마다 중심을 뺀 68차원, **v4 부터는 얼굴 인식(SFace) 128 + 얼굴 메시 16 = 144차원**이다.
앱은 `dim` 을 파일에서 읽을 뿐 그 값을 들고 있지 않다.

```
/faces/v{n}/f.json · m.json     풀 하나에 파일 하나 (Gender 소문자)
/faces/v{n}/{id}.webp           faces[].id 마다, 그리고 retired 아닌 celebs[].id 마다 하나 (결과가 연예인 id 로 사진을 부른다)
```

```ts
/** 자산 JSON 의 모양. base64 int8×dim — decodeVec() 으로 복원하면 단위 길이다 */
export interface FacePoolFile {
  version: number;               // 경로의 v{n} 과 같아야 한다
  dim: number;
  scale: number;
  celebs: { id: string; name: string; v: string; retired?: true }[];
  faces:  { id: string; v: string; level: 1 | 2 | 3 }[];
  /** 첫 화면 묶음의 1번부터 (v6 부터, ADR-136). 0번은 faces 의 level 그대로라 싣지 않는다 */
  starts?: { l1: string[]; l2: string[] }[];
}
```

| 규칙 | 왜 |
|---|---|
| **id 는 불투명하고 영원하다.** 빼려면 `retired` | 저장된 결과가 id 를 들고 있다. 파일명에 이름을 넣지 않는다 (S-B5) |
| **옛 버전 경로는 지우지 않는다** | 옛 결과가 언제나 그려진다 (고정점) |
| `level 1` 은 정확히 18(`IDEAL_SHAPE.level1`) · `level 2` 는 36(`level2`) | 1라운드는 두 쪽이다. 0번 묶음의 화면이다 |
| **level 1 의 자산 순서가 곧 쪽이다** — 앞 아홉이 첫 쪽(큰 군집부터), 뒤 아홉이 둘째 쪽(같은 순서) | `다른 얼굴 보기` 가 둘째 쪽을 연다 (S-B7). 순서를 섞으면 첫 화면이 바뀐다 |
| **`starts` 는 지금 판에 `starts − 1` 벌** — 묶음마다 `l1`(순서가 곧 쪽) · `l2` 가 faces 의 id 이고, 겹치지 않고, 수가 level 1 · 2 와 같다 | 기기가 찾을 때마다 번호 하나를 집는다 (ADR-136). 어긋난 묶음은 앱이 말없이 자산 그대로 그린다(빈 칸을 만들지 않는다) — 그래서 `check:faces` 가 막는다 |
| `celebs` 와 `faces` 는 **다른 목록**이다 | 계약을 출처 결정에서 떼어두는 자리다. 출처는 실사로 닫혀(S-C5) 두 목록의 id 가 온전히 겹친다 — 같은 사람이 고르는 얼굴이자 답이고, 그래서 S-C2 가 본 얼굴을 결과에서 뺀다 |

**`npm run check:faces`** — `check:copy` 옆자리, `npm run check` 에 들어간다.
`public/faces/` 가 없으면 조용히 통과한다 (자산이 오기 전에도 CI 가 돌아야 한다). 있으면 **판마다 보는 것이 다르다** —
옛 판은 저장된 결과를 그리는 데만 쓰이고 고칠 수도 지울 수도 없어서, 모양이 바뀐 날 얼어붙은 옛 판이 영영 빨갛지 않게 나눴다.

모든 판(`v{n}/`)에서 — **그리는 데 필요한 것**:

- faces 전부와 retired 아닌 celebs 의 id 마다 사진이 있고, 사진마다 항목이 있다 · id 전부 유일 · 파일명에 celebs.name 없음
- 벡터 길이 = dim, 복원하면 길이 ≈ 1 · JSON 의 version = 경로의 v{n}
- 벡터는 **표준 base64**(`+/`)다 — 기기의 `atob` 가 받는 만큼만 통과시킨다. 끝 `=` 는 있어도 없어도 되고,
  base64url(`-_`)은 `atob` 가 던지므로 빨갛다
- 같은 사진 둘 없음 (바이트 해시) · `f.json`·`m.json`·`<id>.webp` 말고 다른 파일이 없다

지금 판(`IDEAL_ASSET_V`)에서만 — **새로 찾는 데 필요한 것**:

- level 개수(18·36) — 숫자를 들고 있지 않고 `IDEAL_SHAPE.level1` · `level2` 를 글로 읽는다
- 첫 화면 묶음(ADR-136) — `IDEAL_SHAPE.starts − 1` 벌, 묶음마다 faces 의 id · 겹침 없음 · level 1 · 2 와 같은 수.
  옛 판은 묶음이 있을 때만 모양을 본다
- retired 아닌 celebs 가 `라운드 × 얼굴 × (1 + rerolls) + 결과`(3×9×2+3 = 57)를 채울 만큼 있다 — 넘긴 얼굴까지 본 얼굴을 빼고도 결과가 남아야 한다
- celebs 와 faces 의 id 겹침
- 풀 JSON 하나가 **gzip 120 KiB** 이하 (`POOL_BUDGET`) — 여는 사람이 한 덩어리로 받는 것 중 가장 크다.
  지금 값은 어림이고 자산이 오면 실측으로 다시 적는다

### 서빙 — 정적 파일이고, 받는 쪽이 모양을 본다 (ADR-122)

- **Worker 를 거치지 않는다.** `run_worker_first` 를 넓히지 않는다 (ADR-92)
- ⚠️ **없는 파일에도 200 이 온다.** SPA 폴백이 `index.html` 을 준다. 그래서 기기가 `res.ok` · content-type 에 json ·
  모양(`version === v`, `dim`, 배열들)을 보고, 하나라도 어긋나면 **실패**다 — 화면 안의 한 줄과 `다시 불러오기`
  (토스트가 아니다, ADR-65). `api()` 를 거치지 않는 `fetch` 다
- `public/_headers` 의 **1년 `immutable` 은 `/faces/*.webp` — 사진에만** 붙는다. 경로에 판이 있고 옛 판을 지우지 않는다 (ADR-72 의 글자체와 같다).
  없는 주소에 온 `index.html` 도 1년 캐시되므로 **없는 주소를 만들지 않는 것**이 조건이다 — `check:faces` 가 지킨다
- **JSON(`f.json`·`m.json`)은 기본값이다** — 매번 확인한다. `check:faces` 는 폴더가 없으면 통과하므로,
  자산이 오기 전에 이상형 찾기를 연 기기가 JSON 주소에서 받은 `index.html` 을 1년 붙잡지 않게 뺐다 (ADR-122 `대가`).
  **`_headers` 를 `/faces/*` 로 넓히지 마라**
- `check-bundle` 은 `faces/` 를 **세지 않는다.** 첫 화면에도, 안 여는 사람에게도 안 간다
- **받는 때는 시작 화면에서 풀을 고른 뒤**다 (결과가 있으면 결과를 그릴 때). 탭 카드만 보는 사람은 받지 않는다
- 사진은 **4:5** (240×300). `<img width height alt="">` — 이름이 없다 (S-B5)

**구현·테스트는 픽스처 풀로 돈다** — `test/fixtures/faces/` 에 손으로 만든 작은 풀
(지어낸 벡터, `pool.ts`). 사진은 두지 않았다 — 화면 테스트(happy-dom)는 이미지를 받지 않고,
`check:faces` 는 `public/faces/` 만 본다. 실제 자산과 종이 검증은 **출시**를 여는 것이지 구현을 막지 않는다.

**출시의 문은 자산이다 — 빌드가 연다** (`FACES_READY`). `vite.config.ts` 가 빌드하는 순간 지금 판의 `f.json`·`m.json` 이
있는지 보고 값을 박는다. 없으면 카드도, 미리 부르기도, `/ideal` 주소도 없다 — 그 주소는 홈 탭으로 읽힌다.
**따로 켜는 스위치를 두지 마라** — 스위치는 자산 없이 켤 수 있고, 그게 막으려던 일이다. 그래서 코드는 자산보다 먼저
qa 로 가도 되고, 그동안 qa 의 다른 수정이 main 으로 가는 길을 막지 않는다. 자산이 들어온 커밋이 곧 여는 커밋이다.

---

## 순수 함수 — 테스트를 먼저 쓴다 (`buildSeating` 과 같은 예외)

```ts
export function decodeVec(v: string, dim: number, scale: number): Float32Array;
export function meanOf(vecs: readonly Float32Array[]): Float32Array;   // 평균 → 정규화까지

/** 고른 얼굴의 중심. weight = 그 무리의 고른 수 */
export interface TasteCenter { vec: Float32Array; weight: number }
/** 1 개 또는 2 개, 큰 무리가 먼저 (ADR-123 ③). 고른 게 없으면 [] */
export function tasteCenters(picked: readonly Float32Array[]): TasteCenter[];

export function pickRound(
  faces: readonly DecodedFace[], round: 1 | 2 | 3,
  centers: readonly TasteCenter[] | null, shown: ReadonlySet<string>, n?: number,   // n 기본 IDEAL_SHAPE.faces
): DecodedFace[];
export function nearestCelebs(
  celebs: readonly DecodedCeleb[], centers: readonly TasteCenter[],
  exclude: ReadonlySet<string>, j?: number,                                        // j 기본 IDEAL_SHAPE.results
): DecodedCeleb[];

/** 첫 화면 묶음으로 level 을 다시 붙인 얼굴 (ADR-136). 0 · 묶음 없음 · 범위 밖 · 어긋난 묶음은 faces 그대로 */
export function facesForStart(
  faces: readonly DecodedFace[], starts: readonly FaceStart[] | undefined, start: number | undefined,
): readonly DecodedFace[];
```

`DecodedFace = { id, vec, level }` · `DecodedCeleb = { id, name, vec, retired? }` — 복원된 런타임 모양.
`FaceStart = { l1: string[]; l2: string[] }` — 자산의 `starts` 한 벌.

화면은 이렇게 부른다 — 라운드 후보도 결과도 **같은 중심**이다. 얼굴은 **그 찾기의 묶음으로** 단계를 붙인 것이다 —
설명글(ADR-134)과 평가(`eval-real.mjs`)도 저장된 `start` 로 같은 얼굴을 세워 `shownPages` 에 넘긴다.

```ts
const faces = facesForStart(pool.faces, pool.starts, start);    // start: 찾기를 시작할 때 집은 번호
const centers = tasteCenters(지금까지 고른 벡터 전부);
pickRound(faces, round, round === 1 ? null : centers, shown);   // shown 에는 넘긴 아홉도 든다
nearestCelebs(celebs, centers, shown);
```

**불변식 (테스트가 고정한다)**

- 한 번의 반환에 같은 id 가 없고, `shown`·`exclude` 가 절대 안 나온다 (S-B3 · S-C2)
- 1라운드는 level 1 을 **순서 그대로** 앞에서 n (`centers` 를 무시한다).
  두 번째 쪽은 `shown` 이 첫 쪽을 품을 때 나온다 (S-B7)
- `facesForStart` — 번호 k(1 이상)는 `starts[k − 1]` 의 `l1` 이 **그 순서대로** level 1, `l2` 가 level 2, 나머지는 모두 level 3.
  사람도 벡터도 그대로다. 0 · 묶음이 없는 판 · 범위 밖 · 어긋난 묶음(모르는 id · 겹침 · 수가 그 자산의 level 1 · 2 와 다름)은
  faces 그대로 — 빈 칸을 만들지 않는다
- 2라운드는 level 2 후보를 코사인 내림차순으로 n 개 — 대표라서 n 개가 서로 다른 군집이다
- 3라운드는 풀 전체에서 코사인 내림차순으로 채우되, **이미 담은 것과 `dupCos` 이상 닮은
  후보는 뒤로 민다.** 문턱 때문에 n 개를 못 채울 때만 문턱을 풀고 채운다 — 빈 칸은 없다
- **중심이 하나면 2·3라운드와 결과가 v1 과 똑같다.** 기존 불변식 테스트는 `[{ vec: meanOf(…), weight }]` 로 부르고
  기대 순서를 고치지 않는다
- `tasteCenters` — 고른 것이 `splitMin × 2` 개 미만이면 평균 하나. 아니면 결정적 2-평균(시작점은 서로 가장 덜 닮은 두 얼굴,
  같은 값이면 앞의 것 · 열 번)으로 갈라 `cos(A, B) < splitCos` 이고 작은 무리 ≥ `splitMin` 일 때만 `[A, B]` (큰 무리 먼저,
  같으면 첫 시작점 쪽), 아니면 전체 평균 하나. 작은 무리가 한 장이면 갈리지 않는다
- 고른 게 없으면 `tasteCenters([])` 는 `[]` 다. `pickRound` 는 `[]` 를 `null` 처럼 다뤄 **자산 순서**로 채우고
  (3라운드의 닮은꼴 밀기는 그대로), `nearestCelebs(…, [], …)` 도 자산 순서로 앞에서 j 개다.
  화면은 이 길에 닿지 않는다 — 고르지 않으면 라운드가 안 넘어가고 결과는 고른 것이 있어야 난다. 결정적이라는 약속만 지킨다
- 중심이 둘이면 라운드의 자리를 무게로 나눈다 — `nB = clamp(round(n × wB/(wA+wB)), 1, floor(n/2))`, `nA = n − nB`.
  두 목록을 같은 규칙으로 서로 겹치지 않게 채워 **A, B 를 번갈아** 놓는다. 한쪽이 모자라면 다른 쪽이 채운다 — 빈 칸은 없다
- 중심이 둘이면 결과는 `[A 의 1위, B 의 1위, A 의 2위]` — 겹치지 않게, `retired`·`exclude` 를 빼고 (S-C1)
- `meanOf` 는 고른 벡터의 단순 평균이다 — 라운드 가중치가 없다
- `nearestCelebs` 는 `retired` 를 새 결과에 넣지 않는다
- 같은 입력이면 같은 출력 — 시각·난수·DO 에 닿지 않는다

**알고리즘 교체 = 이 함수 몸통 교체다.** 불변식 테스트는 교체 후에도 그대로 통과해야 한다.
함수 이름을 DOM 빌트인과 겹치게 짓지 않는다 (`createEvent` 사고).

---

## API — 참가자 세션, 재미의 문 (S-A2 · ADR-125)

```
POST /api/ideal            IdealInput   → Ideal
POST /api/ideal/verdict    IdealVerdict → Ideal
```

- **돌려주는 건 언제나 저장된 행이다.** 이미 있으면 그것을 돌려준다 — 409 가 아니다.
  화면은 응답을 그대로 그린다 (S-E2: 다른 기기가 먼저 끝냈으면 그쪽이 남는다).
  서버가 방금 준 답을 버리고 다시 읽지 않는다 (14 의 `/vote` 와 같은 이유)
- 검사는 **모양만** (`IDEAL_SHAPE`) — `pool` 이 Gender · `picks` 가 정확히 3묶음, 각 1~5개,
  라운드 안 중복 없음 · `result` 가 서로 다른 id 셋 · `v` 가 1~9999 의 정수 · `start` 가 없거나 0~15 의 정수. 어긋나면 `400`.
  내용(정말 가까운가)은 안 본다 — 벡터를 서버에 들이지 않는다 (S-D3)
- **다시 찾기** (ADR-125) — 본문에 `replaces: number`(다시 찾기를 시작한 결과의 `at`)를 더한다. 저장된 결과의 `at` 과 같을 때만
  새 결과로 **갈아끼우고**(정답은 비운다), 다르거나 없으면 저장된 행을 그대로 돌려준다 — 먼저 닿은 쪽이 남는다 (S-E2).
  새 `at` 은 `max(now, 지난 at + 1)` 이다. 가리킬 결과가 없으면 처음 저장이다. 정수가 아니면 `400`
- `verdict` 는 행이 있어야 받는다 — 없으면 `404`. `chosen` 은 그 행의 `result` 중 **1~3명, 겹치지 않게** — 아니면 `400` (ADR-127).
  한 명을 문자열로 보내도 받는다(배포 전에 열어 둔 탭). 결과 순서대로 저장한다
  이미 있으면 그대로 돌려준다 (**결과마다** 한 번 — 다시 찾은 결과에는 답이 비어 있다)
- **저장은 재미가 열린 동안만이다** (`canOpenFun` — 매력 투표 · 파티 · 발표 뒤, ADR-125). 닫혀 있으면 `409` 와 `FUN.closed` —
  파티 운세 보기(`/fortune`)와 같은 문, 같은 문장이다. **`verdict` 는 문을 보지 않는다** — 이미 찾은 결과를 보는 일의 한 칸이라
  운영자가 단계를 되돌린 회차에서도 답할 수 있다.
  세션이 없으면 `401`, **지워진 참가자면 `404`** (`/fortune` 과 같은 길 — 화면은 404 를 `빠졌다` 로 읽는다).
  행 없는 `verdict` 도 `404` 라 상태 번호로는 갈리지 않는다 — 화면은 결과를 그린 뒤에만 답을 보내므로 받아들인다
- **방송하지 않는다.** 내 행은 나만 본다 — 남의 화면이 다시 읽을 이유가 없다

**지표 — `pulse()` 의 닫힌 키** (ADR-56 · ADR-122). 첫 저장·첫 확정에서만 센다. 다시 찾아 바꾼 것은 `again` 으로 따로 센다 (ADR-125) —
`save` 가 처음 찾은 수로 남고, `chosen`·`none` 은 결과 한 벌마다다.

```ts
{ kind: "ideal"; key: "save" | "again" | "chosen" | "none"; v: number }   // IDEAL_KEYS
```

blob 은 `[kind, key, String(v)]` 뿐이다. **인덱스도 회차 id 도 연예인 id 도 없다** — 어느 연예인인지는 결과 통계다 (S-D4).

> **고쳤다 (2026-09-27)** — 두 자리를 틀리게 적었다.
> 지워진 참가자는 `401 (ENTRY.removed 의 길)` 이 아니라 **`404`** 다. 401 은 세션이 없을 때뿐이고,
> `ENTRY.removed` 는 `/me` 가 명단을 확인한 뒤에만 싣는다.
> 지표는 `metrics.ts` 의 `{ v }` · `{ v, kind }` 가 아니다 — `count()` 의 모양(`{kind, outcome}`)에는 `v` 의 자리가 없고,
> `count()` 는 **회차 id 를 인덱스로 단다.** `kind` 도 그 합집합의 구분자라 겹친다.

---

## 라우트 (화면)

| URL | 화면 |
|---|---|
| `/e/:code/fun` | **재미 탭** (개명은 끝났다 — ADR-20 후기 2). 이 슬라이스는 label·이모지·경로를 건드리지 않고 **꺼진 탭 상태(`funOpen`)를 걷어낸다** — 탭은 등록부터 켜져 있다. **입구 카드 둘** — 이상형 찾기 위, 파티 운세 보기 아래 (ADR-124 · ADR-125). 프로필 투표 전에는 맨 위 한 줄이 언제 볼 수 있는지 말하고 카드에 단추가 없다 (S-A2) |
| `/e/:code/ideal` | 시작(풀 고르기). **결과가 있으면 결과** — 같은 주소가 상태를 따라간다 |
| `/e/:code/ideal/again` | **다시 찾기의 시작** (ADR-125) — 풀 고르기와 같은 화면에 `새로 찾으면 지금 결과 대신 새 결과가 남아요`. 결과가 없거나 문이 닫혀 있으면 `/ideal` 로 갈아끼운다 |
| `/e/:code/ideal/1..3` | 라운드 |
| `/e/:code/fortune` | **파티 운세 보기** (ADR-125) — 이상형 찾기와 같은 자리의 페이지. 문이 닫혀 있고 연 운세도 없으면 재미 탭으로 물러난다 |

시트가 아니라 **재미 탭 본문 안의 화면**이다 (`/me/edit` 과 같은 자리). 탭 판정이 `/ideal` 이하를 `재미` 로 읽는다 (ADR-114).

| 전환 | 방식 | 이유 |
|---|---|---|
| 탭 카드 → `/ideal` | push (`idealStep: 0`) | 뒤로 가기 = 탭 |
| `/ideal` → `/1` → `/2` → `/3` | push | 뒤로 가기 = 이전 라운드, 1에서는 풀 고르기 (등록 스텝과 같다) |
| `/3` 결과 보기 → `/ideal` | **되감기** `navigate(-n)` — 아니면 replace | 뒤로 가기로 라운드에 다시 들어가지 않는다. 결과에서 뒤로 가면 재미 탭이다 |
| 재미 탭 카드 `다시 찾기` → `/ideal/again` | push (`idealStep: 0`) | 뒤로 가기 = 탭. 라운드는 이 칸 위에 쌓인다 (ADR-125) |
| 결과 화면 `다시 찾기` → `/ideal/again` | **replace** — 칸 표시(`idealStep: 0`)를 옮긴다 | 쌓으면 새 결과에서 뒤로 가기가 지난 결과를 한 번 더 보여준다 |
| 다시 찾은 `/3` 결과 보기 → `/ideal` | 되감기로 `/ideal/again` 칸까지, 거기서 `/ideal` 로 replace | 새 결과에서 뒤로 가면 재미 탭이다 |
| 라운드 안 `다른 얼굴 보기` | **이동 없음** — 주소도 칸도 그대로 | 되감기가 칸의 `idealStep` 을 믿는다. 칸을 끼우면 그 수가 틀어진다 (ADR-123 ②) |
| 이상형 화면에서 탭 | **되감기** `navigate(-(n+1))` → 재미 탭 칸에서 여느 탭 이동 | 라운드 칸을 기록에 남기지 않는다 |

칸마다 `state.idealStep`(카드가 연 `/ideal` 은 0, 라운드는 1·2·3)을 싣는다. 라운드 주소가 열리면 안 될 때(결과가 있다 ·
고르던 값이 없다 · 없는 라운드) **지금 선 칸**의 수가 주소와 맞으면 그만큼 되감고, 아니면 `/ideal` 로 replace 한다 —
?·✉️ 아래라면 시트 칸을 지키고 `under` 만 바꾼다. 결과 보기도 이 길로 물러난다: 저장된 행이 그려지는 **그 순간의 칸**에서
센다 (저장을 기다리는 동안 뒤로 갔거나 시트를 연 사람). **칸 수를 믿을 수 있는 자리다** — `/n` 은 `/n-1` 에서만
push 되고 수는 그 칸에 적혀 있다 (ROUTES.md). 결과는 `POST /api/ideal` 의 응답 행을 그대로 그린다 (다시 읽지 않는다, S-E2).

> **고쳤다 (2026-09-27)** — 처음에는 replace 로 적었다. replace 는 마지막 한 칸만 바꿔서 결과에서 뒤로 가기가
> `/2` · `/1` 을 밟으며 매번 결과로 되돌려진다 — 세 번 헛돈다 (`ROUTES.md` 의 ⚠️ 와 같은 한계). ADR-122 ④.

- **결과가 있으면 라운드 주소는 열리지 않는다** — `/ideal` 로 갈아끼운다
  (`/me/edit` 이 잠긴 뒤와 같다). 새로고침·뒤로 가기·딥링크가 전부 이 문으로 걸러진다
- 고르던 값은 메모리에만 있다 — 라운드 주소를 **직접** 열었는데 그 라운드에 필요한 값(풀·앞 라운드 고른 것)이
  없으면 `/ideal` 로 갈아끼운다 (S-B4: 닫고 나가면 버려진다). `:round` 가 1·2·3 이 아니어도 갈아끼운다
- 뒤로 가서 앞 라운드를 고쳐 고르면 **그 뒤 라운드의 후보·고른 것은 버리고 다시 계산**한다 — 앞의 선택이 뒤의 후보를 정한다.
  넘긴 쪽(`다른 얼굴 보기`)도 함께 버린다
- 라운드마다 **어느 쪽을 보여줬는지**(넘겼는지)를 고르던 값과 같은 메모리에 둔다 — 뒤로 갔다 오면 같은 아홉이 선다 (S-B7)
- **첫 화면 묶음 번호도 같은 메모리에 둔다** (ADR-136). 이 화면이 서면 집고, `다시 찾기` 를 누르면 새로 집는다 — 한 번 찾는
  동안은 그대로다(뒤로 가서 같은 쪽을 다시 골라도 같은 화면). 시작 화면이 두 풀의 1라운드 첫 쪽을 미리 받으므로 풀을 고르기 전에 집는다

---

## 안 만드는 것 (계약에서 뺀다)

- `GET /api/ideal` — `ParticipantState.ideal` 에 실려 온다
- `DELETE`·`PUT /api/ideal` — 다시 찾기는 `POST /api/ideal` 의 `replaces` 로 한다 (ADR-125). 결과를 지우는 길은 없다.
  '없음'(S-C4)이 저절로 다시 찾기를 열지도 않는다
- 운영자 라우트·`HostState` 필드 — 운영자 화면이 없다 (S-D1)
- 자산을 주는 API — 정적 파일이다. Worker 를 거치면 캐시만 잃는다
- `picks` 를 서버가 재계산해 검증하는 것 — S-D3 의 "그래서 뭐"
- 방송 · 읽음 표시 (단계 검사는 ADR-125 에서 들어왔다 — 저장만, `canOpenFun`)

---

## 문구는 시나리오의 표대로 `copy.ts` 에 `IDEAL` 로

탭 이름·이모지·경로는 건드리지 않는다. 탭 쪽 일은 `funOpen`(꺼진 탭)을 걷어내는 것과
**운세 카드에 닫힌 모양을 주는 것**이다 — 운세·미션 카드의 문(`canOpenFortune`·`canOpenMission`)은 그대로 남는다.

> **고쳤다 (2026-09-27)** — `funOpen` 을 걷어내는 것 **하나**라고 적었다. 운세 카드에는 닫힌 모양이 없었다 —
> 탭의 문이 가려 주고 있었다. 탭이 등록부터 켜지면 생년월일 칸이 산 채로 보인다. 그래서 `!canOpenFortune && !card` 이면
> 뒷면에 칸 없이 `FORTUNE.closed` 한 줄(`aria-disabled`)이다 — 미션 뒷면의 `missionClosed` 와 같은 모양.
> 운세 뒷면이 탭을 다 채우던 `.fortuneFill` 은 걷는다 — 카드가 둘이다 (ADR-122 ②).
>
> **다시 고쳤다 (2026-09-28, ADR-125)** — 운세 카드의 닫힌 모양(`FORTUNE.closed`)도 걷혔다. 재미는 프로필 투표에 한 번에 열리고
> 탭 맨 위 한 줄(`FUN.closed`)이 그 전을 말한다. 두 카드는 같은 입구 틀이고, 운세는 탭 안의 페이지(`/fortune`)에서 뒤집는다.
