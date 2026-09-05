# 슬라이스 15 — 공개 표면

시나리오: `15-pin-entry.md` · 결정: `ADR-75`

**여기 적힌 것만 계약이다.** 내부 구조 — DO 안을 어떻게 나눌지, 표를 어느 테이블에 둘지 —
는 구현자가 정한다. 테스트도 이 표면에만 붙는다.

---

## 주소

| 화면 | 지금 | 이 슬라이스 |
|---|---|---|
| 참가 링크 | `/j/:id/:token` | **`/j/:id`** |
| 입장 확인창 (모달 = 라우트, push) | — | **`/j/:id/enter`** |
| 등록 | `/j/:id/:token/register/1..3` | **`/j/:id/register/1..3`** |
| 참가자 화면 | `/e/:code` … | 그대로 |
| 운영자 · 참가자 상세 시트 | `/host/:id/players/:pid` | 그대로 — 줄 하나가 는다 |

`router.tsx` 의 *"토큰 없는 `/j/:id` 를 되살리지 마라"* 주석은 이 슬라이스가 지운다.
그 주석이 막던 것(번호만 아는 사람이 그 사람이 되는 것)은 이제 PIN 번호가 막는다.

### 링크를 열었을 때 — **이 브라우저의 마지막 세션으로 들어간다** (ADR-75)

`/j/:id` 는 누가 열었는지 모른다. 그래서 `/` 와 같은 규칙을 쓴다 — 이 탭의 이름표, 없으면
기본 쿠키. 그 세션이 **이 회차의 참가자**면 배너를 거치지 않고 `/e/:code` 로 간다 (replace).

```
탭에 이름표가 있다      → /me 를 기다렸다가 답에 따라 간다 (돌아온 사람일 확률이 높다)
탭에 이름표가 없다      → 배너를 먼저 그리고, /me 를 뒤에서 묻는다. 200 이면 그때 넘어간다
/me 가 401·404          → 배너 그대로. 들어가기 → 확인창
```

- **`/me?event=:id` 를 쓴다.** 지금 있는 것 그대로다 — 회차가 다르면 401 을 준다
- `index.html` 의 미리 부르기는 **`/events/by-id/:id` 하나만** 둔다. 세션을 읽는 요청은 거기 못 넣는다
  (ADR-44 — 이름표를 실을 수 없다). 그래서 `/me` 는 번들이 올라온 뒤에 나간다
- 이름표 없는 탭에서 돌아온 사람은 **배너가 잠깐 보였다가 넘어간다.** 받아들인 비용이다 —
  반대로 하면(답을 기다린 뒤 그리기) 처음 온 모든 사람의 첫 그림이 늦어진다 (ADR-70)
- **친구 폰으로 열면 친구 화면이 뜬다.** 알고 고른 것이다 (ADR-75). `/` 도 지금 그렇다

---

## 타입

```ts
/** 공개 회차 정보. `registered` 가 빠진다 — 토큰이 없으니 "이 링크의 주인" 이 없다 */
export interface PublicEvent {
  id: string;
  name: string;
  phase: Phase;
  partyAt?: number;
  canRegister: boolean;
  message?: string;
  nickHint?: string;
  // registered?: boolean  ← 지운다
}

/**
 * 입장 확인의 답. **번호 하나로 묻는 첫 요청**의 답이다.
 * 초대 안 된 번호는 여기까지 오지 않는다 (403).
 */
export interface EnterProbe {
  /** 등록을 마친 사람인가 */
  registered: boolean;
  /**
   * 등록한 사람에게만.
   *   "required" — PIN 번호가 있다. 칸 하나를 편다
   *   "set"      — PIN 번호가 없다 (운영자가 초기화했다). 칸 둘(정하기 · 재입력)을 편다
   */
  pin?: "required" | "set";
  // locked 는 없다 — 잠긴 번호는 이 응답 대신 423 이 온다 (아래 판정 순서 4). 화면은 그 오류로 PIN 칸을 잠근 채 편다
  /** 미등록일 때만. 초대 쿠키가 함께 심긴다 (ADR-44 의 이름표) */
  ref?: string;
}

/** 번호 + PIN 번호로 들어온 답. 지금의 EnterResult 와 같다 */
export interface EnterResult {
  registered: true;
  code: string;
  ref: string;
}

export interface RegisterInput {
  nickname: string;
  realName: string;
  age: number;
  gender: Gender;
  instagram: string;
  mbti: string;
  charms: [string, string, string];
  /** 숫자 4자리. **재입력 대조는 화면이 한다** — 서버는 하나만 받는다 */
  pin: string;
  // phone 은 여전히 없다 (ADR-31). 초대 쿠키에서 꺼낸다
}

/** 초대 명단 한 줄. `token` 이 응답에서 빠진다 — 참가자에게 보낼 링크가 없어졌다 */
export interface Invite {
  phone: string;
  addedAt: number;
  nickname?: string;
  // token: string  ← 응답에서 지운다. 표에는 내부 식별자로 남는다 (아래)
}

/** 운영자가 보는 참가자. 값도 해시도 없다 — 상태 하나뿐이다 */
export interface Player {
  // … 지금 그대로
  /** "set" 정함 · "none" 안 정함(초기화됨) · "locked" 잠김 */
  pin: "set" | "none" | "locked";
}

/** 초대 쿠키의 페이로드. 모양은 그대로다 — `token` 이 주소가 아니라 내부 식별자가 될 뿐이다 */
type AuthScope =
  | { kind: "player"; eventId: string; playerId: string }
  | { kind: "invited"; eventId: string; token: string }   // token = 명단 행의 내부 식별자
  | { kind: "master" };
```

**전화번호는 어느 쿠키에도 담지 않는다.** 세션은 서명만 하고 암호화하지 않아서 개발자 도구에
페이로드가 그대로 읽힌다 (`auth.ts`). 초대 쿠키는 지금처럼 명단 행의 식별자를 들고,
번호는 회차 DO 안에서만 푼다 — 그래서 **등록 핸들러와 `RegisterInput` 의 phone 부재는
한 글자도 안 바뀐다.**

---

## API

### 참가자

| | 지금 | 이 슬라이스 |
|---|---|---|
| `GET /events/by-id/:id` | `?t=<token>` 필수 · `registered` 포함 | **토큰 없음.** 회차만 답한다. `index.html` 이 미리 부른다 |
| `POST /events/:id/enter` | `{ token }` | **`{ phone }`** → `EnterProbe` · **`{ phone, pin }`** → `EnterResult` |
| `POST /register` | `RegisterInput` (초대 쿠키) | `RegisterInput` + `pin` (초대 쿠키) |
| `GET /me?event=:id` | 있음 | 그대로. `/j/:id` 가 자동 입장을 판정하는 데 쓴다 |

**`POST /events/:id/enter` 의 판정 순서** — 이 순서가 계약이다 (S-A6).

```
1. 회차 없음                          → 404  ENTRY.notFound
2. 접속지 시도 초과 (ENTRY_TRIES)      → 429  ENTRY.tooMany
3. 번호가 명단에 없음                  → 403  ENTRY.notInvited (`초대된 번호가 아니에요…`)
4. 잠김 (pin_fails ≥ 5)               → 423  ENTRY.pinLocked   — PIN 대조보다 먼저다
5. { phone } 만 왔다
     미등록                            → 초대 쿠키 심고  { registered: false, ref }
     등록 · PIN 있음                   → { registered: true, pin: "required" }   (쿠키 없음)
     등록 · PIN 없음                   → { registered: true, pin: "set" }        (쿠키 없음)
6. { phone, pin } 이 왔다
     미등록                            → 5 와 같다 — PIN 은 등록에서만 정한다 (S-B2)
     등록 · PIN 없음                   → 그 값으로 정하고 참가자 쿠키 심고 EnterResult
     등록 · PIN 있음 · 일치            → pin_fails = 0, 참가자 쿠키 심고 EnterResult
     등록 · PIN 있음 · 불일치          → pin_fails += 1, 접속지 시도 +1,
                                        403 ENTRY.pinWrong(left)   left = 5 - pin_fails
                                        (5 가 되면 그 응답부터 423)
```

- **1 과 3 을 가른다.** 토큰이 없어졌으니 회차의 존재는 링크만으로 이미 드러난다 (S-A1)
- **PIN 불일치도 접속지 시도를 센다** (S-A7). 번호 단계에만 걸면 통과한 뒤 만 번을 두드린다
- `pin` 은 `/^\d{4}$/` 이 아니면 `bad_request`. 문구는 화면이 먼저 막는다

### 운영자

| | |
|---|---|
| `POST /host/events/:id/players/:pid/pin/reset` | PIN 번호와 실패 횟수를 **함께** 지운다. 콕·자리·운세는 그대로 (S-C1·C2). `HostState` 를 돌려준다 |
| `POST /host/events/:id/invites` · `DELETE …/:phone` | 그대로. 응답의 `Invite` 에서 `token` 만 빠진다 |

운영자 응답 어디에도 PIN 값·해시가 없다 (S-C3). `Player.pin` 세 상태뿐이다.

---

## 저장

구현자가 정하되, **이것은 지킨다.**

- **해시만.** 키 있는 해시 — `HMAC-SHA256(SESSION_SECRET, salt ‖ pin)`, `salt` 는 참가자마다 무작위.
  bcrypt·scrypt 가 아닌 이유는 **요청당 CPU 10ms** 다. 4자리는 어차피 만 가지라 느린 해시로
  얻는 게 없고, 지키는 힘은 **후추(SESSION_SECRET)가 DO 밖에 있다**는 데서 온다 —
  표만 빠져나가도 후추 없이는 만 번을 돌려볼 수 없다
- **회차 DO 안에.** 파기가 DO 하나 지우는 일로 끝난다
- 칸은 `players` 에 둘 — 해시·솔트 하나, 실패 횟수 하나. **옛 회차에도 붙여야 한다** —
  `ALTER TABLE ADD COLUMN` 마이그레이션으로. `SCHEMA` 에 새 칸을 가리키는 인덱스를 두지 마라
  (CLAUDE.md — 옛 표에서 DO 가 통째로 죽는다). `npm run guard` 의 옛 스키마 테스트가 본다
- `invites.token` · `players.token` 은 **이름을 바꾸지 않고** 내부 식별자로 남긴다.
  초대 쿠키가 그 값을 들고, 등록이 그걸로 번호를 찾는다 — 지금과 같다

---

## 화면

| 화면 | 바뀌는 것 |
|---|---|
| `Join` | 버튼 하나(`들어가기`) → `/j/:id/enter` push. 자동 입장 규칙은 위 |
| 입장 확인창 (새로) | `.dialog.narrow` · 열릴 때 번호 칸에 커서 (ADR-63 예외 — `Sheet` 에 `autoFocus` 를 더한다) · 11자리 → 300ms → `{ phone }` · `pin: "required"` 면 칸 하나, `"set"` 이면 칸 둘 · 4자리(둘이면 일치할 때) → `{ phone, pin }` · 실패 시 PIN 칸만 비움 · `left ≤ 2` 부터 남은 횟수 · 잠기면 PIN 칸 비활성, 번호 칸은 산다 |
| `Register` | 3걸음. 1걸음에 인스타(라벨 괄호 약속) · 3걸음 `다시 들어올 때` = PIN 칸 둘, 대조는 화면. 라우트에서 `:token` 이 빠진다 |
| 운영자 · 참가자 상세 | `참가자 PIN 번호 초기화` 줄 + 상태 칩(`정함`·`안 정함`·**`잠김`** 은 눈에 띄게). 확인창: `설정한 PIN 번호가 지워져요 · 다음 입장에서 새로 정해요 · 콕과 자리는 그대로예요` |
| 초대 명단 시트 | 행의 `링크` 버튼 삭제. 안내문에 `{링크}` 자리 복귀 — 회차 공용 링크 하나. 명단 머리에 `초대 링크 복사` 하나 (주소만, 다른 글자 없이 — 안내문은 보냈고 링크만 다시 보낼 때. 운영자 화면이라 `초대`, 참가자 화면의 `참가 링크` 와 같은 링크다) |
| 안내문 고치기 | 장소에 지도 링크를 넣으면 한 메시지에 링크가 둘이 된다는 한 줄. **`{링크}` 가 없으면 맨 끝 줄에 붙는다** (`renderInvite`) — 링크 없는 안내문은 나가지 않는다. ADR-32 시절의 기본 문구가 저장돼 있으면 새 기본 문구로 읽는다 (`withDefaults`, `LEGACY_INVITE_TEMPLATE`) |

---

## 문구 (`copy.ts`)

| 키 | 값 |
|---|---|
| `ENTRY.start` | `들어가기` (`reenter` 는 지운다 — 가를 수 없다) |
| `ENTRY.enterTitle` | `전화번호로 들어가기` |
| `ENTRY.phone` | `전화번호` |
| `ENTRY.notInvited` | `초대된 번호가 아니에요. 운영자에게 확인해주세요.` |
| `ENTRY.pin` | `PIN 번호 4자리` |
| `ENTRY.pinHint` | `등록할 때 정한 PIN 번호예요` |
| `ENTRY.pinNew` · `pinAgain` | `새 PIN 번호 4자리` · `PIN 번호 재입력` (초기화된 사람) |
| `ENTRY.pinWrong(left)` | `맞지 않아요` / `맞지 않아요 — ${left}번 더 틀리면 잠겨요` (left ≤ 2) |
| `ENTRY.pinLocked` | `여러 번 틀려서 잠겼어요. 운영자에게 말씀해주세요.` |
| `REGISTER.steps` | `["기본 정보", "나를 소개", "다시 들어올 때"]` |
| `REGISTER.pinIntro` | `다음에 이 파티에 다시 들어올 때 쓸 PIN 번호예요.\n전화번호와 함께 넣으면 바로 내 화면으로 와요.` |
| `REGISTER.pin` · `pinAgain` · `pinMismatch` | `PIN 번호 4자리` · `PIN 번호 재입력` · `두 번 입력한 PIN 번호가 달라요` |
| `REGISTER.instagramLabel` | `인스타 (운영자 확인용 · 공개되지 않아요)` — 등록 폼과 수정 폼의 라벨. `ME.labels.*` 는 읽기 화면·운영자 시트의 짧은 라벨로 남는다 |
| `REGISTER.realNameLabel` | `이름 (서로 콕 찌른 상대에게만 보여요)` |
| `REGISTER.contactNote` · `instaWhy` | **지운다** — 라벨로 옮겼다 |
| `HOST_UI.players.pinReset` · `pinState` | `참가자 PIN 번호 초기화` · `정함` / `안 정함` / `잠김` |
| `INVITE_TEMPLATE` | `{링크}` 가 돌아온다 |

---

## 테스트

- **`test/15-pin-entry.test.ts` (새로)** — S-A1~A9 · B1~B5 · C1~C3. 워커 프로젝트
- **`test/13-personal-link.test.ts`** — **뒤집힌다.** S-A1(*토큰 없으면 못 연다*)이 정반대가 됐다.
  이 파일은 걷어내고 15 로 옮긴다. 남길 것은 *등록 폼이 번호를 받지 않는다*(S-A3 → 15 의 S-B4) 뿐이다
- **`test/44-tab-sessions.test.ts`** — 링크 대신 번호+PIN 으로 들어오게 고친다. 규칙은 그대로다
- **`test/client/`** — 확인창: 11자리 자동 검증 · 칸 펼침 · 자동 제출 · 남은 횟수 · 잠김에서 번호 칸이 산다.
  Join: 이름표가 있으면 배너를 안 그리고 기다린다 / 없으면 먼저 그린다
- **`test/release/old-schema.test.ts`** — 옛 표에 새 칸이 붙고 DO 가 살아나는가

---

## 함께 고치는 문서 — **같은 PR 에서**

`CLAUDE.md` 절대 규칙 2 (통째로) · `docs/ROUTES.md` URL 표 · `docs/UI.md` 참가 화면·등록 표 ·
`docs/FLOWS.md` 입장 줄 · `index.html` 부트 주석 · `router.tsx` 주석.
