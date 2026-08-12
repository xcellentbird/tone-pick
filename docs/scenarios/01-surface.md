# 슬라이스 01 — 공개 표면

시나리오: `01-event-create-join.md` · 테스트: `test/01-event-create-join.test.ts`

**여기 적힌 것만 계약이다.** 내부 구조 — 클래스를 쓸지, 함수로 갈지, DO 안을 어떻게 나눌지 —
는 구현자가 정한다. 테스트도 이 표면에만 붙어 있다.

---

## 인증

세션은 **HttpOnly 쿠키**. 전화번호나 PIN 을 URL·바디에 남기지 않기 위해서다.

```
POST /api/host/pin        { pin: string, eventId?: string }  → { scope: AuthScope }
POST /api/host/logout                                        → { ok: true }
```

- `eventId` 가 있으면 **그 회차 PIN 을 먼저** 검사하고, 안 맞을 때만 공통 PIN 을 본다 (S-A3)
- `eventId` 가 없으면 공통 PIN 만 본다
- 실패는 `401 { error: "unauthorized", message: HOST.pin.wrong }`
- 응답 어디에도 올바른 PIN 을 실어 보내지 않는다

| scope | 할 수 있는 것 |
|---|---|
| `{ kind: "master" }` | 전부 |
| `{ kind: "host", eventId }` | 그 회차 조회·수정만. 회차 목록·기본 설정·회차 생성은 403 |

---

## 기본 설정 (master 전용)

```
GET  /api/host/defaults         → Defaults
PUT  /api/host/defaults         { ...Defaults, masterPin? }  → Defaults
POST /api/host/defaults/reset                    → Defaults
```

- `PUT` 으로 공통 PIN 을 기존 회차 PIN 과 같게 만들려 하면 `409 pin_collision`
- `reset` 은 **콕 횟수와 일정 오프셋만** 되돌린다. 공통 PIN·기존 회차는 그대로 (S-B9)

---

## 회차 (master 전용, 조회는 해당 host 도 가능)

```
GET  /api/host/events                → EventSummary[]
POST /api/host/events                CreateEventInput → EventMeta
GET  /api/host/events/:id            → EventMeta
PUT  /api/host/events/:id/schedule   { regOpenAt?, voteCloseAt?, revealAt? } → EventMeta
POST /api/host/events/:id/phase      { to: Phase } → EventMeta
```

`phase` 전환은 수동 진행이다. 전환하면 `fired[to]` 에 **실제 전환 시각**이 기록되고,
그 단계의 예약은 다시 울리지 않는다. 예약 값 자체는 지우지 않는다 — 기록으로 남는다.

`EventSummary` 와 `EventMeta` 에 **PIN 은 들어가지 않는다.**

### 생성 규칙

| 상황 | 응답 |
|---|---|
| 회차 PIN == 공통 PIN | `409 { error: "pin_collision", message: HOST.pin.sameAsMaster(masterPin) }` |
| `code` 를 지정했는데 이미 쓰는 코드 | `409 { error: "code_taken", message: HOST.pin.codeTaken }` |
| `code` 생략 | 서버가 생성. 기존 코드와 겹치지 않을 때까지 다시 뽑는다 |
| 자동 생성 PIN | 공통 PIN 을 피해서 뽑는다 |
| `voteCloseAt <= regOpenAt` | `400 { error: "schedule_order" }` |
| `regOpenAt: "now"` | 그 자리에서 `phase: "reg"`, `fired.reg` 기록 |
| 예약 | `phase: "prep"`, `fired` 비어 있음 |
| 같은 `requestId` 로 재요청 | 새로 만들지 않고 **같은 회차**를 200 으로 돌려준다 (S-B7) |

---

## 입장 코드 (인증 없음)

```
GET /api/events/by-code/:code   → PublicEvent | 404
```

- 코드는 **대소문자를 가리지 않는다** (서버에서 대문자로 정규화)
- 없으면 `404 { error: "not_found", message: ENTRY.notFound }`
- `phase: "prep"` → `canRegister: false`, `message: ENTRY.notOpenYet(...)`
- `phase: "done"` → `canRegister: false`, `message: ENTRY.finished`
- **응답에 PIN·참가자 개인정보·콕 기록이 없다** (S-C2). `PublicEvent` 타입 밖의 필드를 넣지 마라

---

## 서버 시각

모든 `/api` 응답에 `x-server-time` 헤더를 싣는다. 단계 판정은 **서버 시각으로만** 한다.

### 테스트 전용 시간 이동

예약 전환(S-B5)과 시계 조작 방지(S-D2)를 검증하려면 시간을 앞으로 돌릴 수단이 필요하다.
**프로덕션에는 존재하지 않는 라우트**로 만든다.

```
POST /api/__test__/now   { at: number }   → { now: number }
```

- `env.ALLOW_TEST_ENDPOINTS === "1"` 일 때만 **라우트를 등록한다**.
  런타임에 분기해서 403 을 주는 게 아니라, 애초에 존재하지 않아야 한다
- 그 외 환경에서는 `404`

---

## 에러 형식

```ts
{ error: ErrorCode, message?: string }
```

`message` 는 **`copy.ts` 에서 가져온다.** 새로 짓지 마라 — `npm run check:copy` 가 잡는다.

| 코드 | HTTP |
|---|---|
| `unauthorized` | 401 |
| `forbidden` | 403 |
| `not_found` | 404 |
| `pin_collision` · `code_taken` | 409 |
| `schedule_order` · `bad_request` | 400 |

---

## 구현자에게

- 상태를 바꾸는 건 `EventDO` 안에서만. Worker 는 인증과 라우팅만 한다
- **인터페이스는 구현이 둘 이상일 때만 만든다.** 지금은 전부 하나뿐이다
- 작업 전 `CLAUDE.md` 와 `docs/DOMAIN.md` 를 읽는다.
  특히 **예약은 한 번만 울리는 알람**이라는 것 — 이걸 일반 스케줄러로 "개선" 하지 마라
