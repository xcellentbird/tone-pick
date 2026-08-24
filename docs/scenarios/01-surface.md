# 슬라이스 01 — 공개 표면

시나리오: `01-event-create-join.md` · 테스트: `test/01-event-create-join.test.ts`

**여기 적힌 것만 계약이다.** 내부 구조 — 클래스를 쓸지, 함수로 갈지, DO 안을 어떻게 나눌지 —
는 구현자가 정한다. 테스트도 이 표면에만 붙어 있다.

---

## 인증

세션은 **HttpOnly 쿠키**. 전화번호나 PIN 을 URL·바디에 남기지 않기 위해서다.

```
POST /api/host/pin        { pin: string }   → { scope: AuthScope }
```

- 운영자 PIN 은 **하나뿐**이다. 회차별 PIN 은 없다 (ADR-12)
- `eventId` 를 함께 보내도 **무시한다**. 회차 단위의 뒷문은 없다 (S-A3)
- 실패는 `401 { error: "unauthorized", message: HOST.pin.wrong }`
- 응답 어디에도 올바른 PIN 을 실어 보내지 않는다

| scope | 할 수 있는 것 |
|---|---|
| `{ kind: "master" }` | 전부 |
| `{ kind: "player", eventId, playerId }` | 자기 화면만 |

---

## 기본 설정 (master 전용)

```
GET  /api/host/defaults         → Defaults
PUT  /api/host/defaults         Defaults → Defaults
POST /api/host/defaults/reset                    → Defaults
```

- `Defaults` 는 `{ maxPre, maxParty, place, prevoteBeforeH, voteEndBeforeH, inviteTemplate }` — 일정은 **파티 일시에서 거꾸로** 잰다.
  `regOpenBeforeD` 는 없어졌다 (ADR-38) — 등록은 회차를 만드는 순간 열린다
- **운영자 PIN 은 여기서 바꾸지 않는다.** 배포 시크릿 `MASTER_PIN` 하나가 유일한 출처다
- 저장된 옛 모양은 읽을 때 지금 모양으로 맞춘다 (`withDefaults`). 없는 항목은 기본값으로 채운다
- `reset` 은 **콕 횟수와 일정 오프셋만** 되돌린다. 운영자 PIN·기존 회차는 그대로 (S-B9)

---

## 회차 (운영자 전용)

```
GET  /api/host/events                → EventSummary[]
POST /api/host/events                CreateEventInput → EventMeta
GET  /api/host/events/:id            → EventMeta
PUT  /api/host/events/:id/schedule   { partyAt?, regOpenAt?, prevoteAt? } → EventMeta
POST /api/host/events/:id/phase      { to: Phase } → EventMeta
```

`phase` 전환은 수동 진행이다. 전환하면 `fired[to]` 에 **실제 전환 시각**이 기록되고,
그 단계의 예약은 다시 울리지 않는다. 예약 값 자체는 지우지 않는다 — 기록으로 남는다.

예약이 걸리는 전환은 `reg` 와 `prevote` **둘뿐**이다. 사전 투표 마감(`party`)·발표(`done`)는
운영자가 누를 때만 일어난다 (ADR-14). `partyAt` 은 전환을 울리지 않는 기준점이다.

### 생성 규칙

| 상황 | 응답 |
|---|---|
| `code` 를 지정했는데 이미 쓰는 코드 | `409 { error: "code_taken", message: HOST.pin.codeTaken }` |
| `code` 생략 | 서버가 생성. 기존 코드와 겹치지 않을 때까지 다시 뽑는다 |
| `prevoteAt <= regOpenAt` | `400 { error: "schedule_order" }` |
| `regOpenAt: "now"` | 그 자리에서 `phase: "reg"`, `fired.reg` 기록 |
| 예약 | `phase: "prep"`, `fired` 비어 있음 |
| 같은 `requestId` 로 재요청 | 새로 만들지 않고 **같은 회차**를 200 으로 돌려준다 (S-B7) |

---

## 회차 미리보기 (인증 없음)

```
GET /api/events/by-id/:id       → PublicEvent | 404     참가 링크가 여는 화면
GET /api/events/by-code/:code   → PublicEvent | 404     코드만 아는 사람의 입장
```

**두 응답 모두 입장 코드를 담지 않는다** (S-C2b). 참가 링크는 `/j/<회차id>` 이고,
문을 여는 건 **초대 명단의 전화번호**다 (ADR-15).

```
POST /api/events/:id/enter   { phone }  → { registered, code? }   인증 없음
POST /api/register           RegisterInput → RegisterResult        초대 쿠키 필요
POST   /api/host/events/:id/invites       { phones: string[] } → Invite[]   더하기만
DELETE /api/host/events/:id/invites/:phone                     → Invite[]
```

- 명단에 없으면 `403 not_invited`, 너무 여러 번이면 `429 too_many`. **문구는 하나뿐이다**
- 통과하면 서명한 초대 쿠키가 나간다. 이미 등록한 사람에게는 참가자 세션이 곧바로 나간다
- `RegisterInput` 에 **전화번호가 없다.** 폼에서 받으면 명단에 없는 번호로 바꿔 낼 수 있다
- `invites` 는 `HostState` 에만 실린다. 참가자 응답에는 절대 없다

- 코드는 **대소문자를 가리지 않는다** (서버에서 대문자로 정규화)
- 없으면 `404 { error: "not_found", message: ENTRY.notFound }`
- `phase: "prep"` → `canRegister: false`, `message: ENTRY.notOpenYet(...)`
- `phase: "done"` → `canRegister: false`, `message: ENTRY.finished`
- **응답에 입장 코드·PIN·참가자 개인정보·콕 기록이 없다** (S-C2). `PublicEvent` 타입 밖의 필드를 넣지 마라

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
| `code_taken` | 409 |
| `schedule_order` · `bad_request` | 400 |

---

## 구현자에게

- 상태를 바꾸는 건 `EventDO` 안에서만. Worker 는 인증과 라우팅만 한다
- **인터페이스는 구현이 둘 이상일 때만 만든다.** 지금은 전부 하나뿐이다
- 작업 전 `CLAUDE.md` 와 `docs/DOMAIN.md` 를 읽는다.
  특히 **예약은 한 번만 울리는 알람**이라는 것 — 이걸 일반 스케줄러로 "개선" 하지 마라
