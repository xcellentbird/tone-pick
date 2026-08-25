# 슬라이스 01 — 공개 표면

시나리오: `01-event-create-join.md` · 테스트: `test/01-event-create-join.test.ts`

> **⚠️ 이 표면은 그 뒤로 두 번 바뀌었다.** 등록 시작 예약이 없어졌고(ADR-38),
> 참가자가 코드를 치던 길이 사람마다 다른 링크로 바뀌었다(ADR-32 · 슬라이스 13).
> 아래 표면은 **그 두 가지를 반영해 고쳐 적은 것**이다. 지금 계약의 원본은 타입(`src/shared/types.ts`)과
> 규칙 테스트다 — 어긋나면 그쪽이 맞다.

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
PUT  /api/host/events/:id/schedule   { partyAt?, prevoteAt?, voteEndAt?, revealAt? } → EventMeta
POST /api/host/events/:id/phase      { to: Phase } → EventMeta
```

`phase` 전환은 수동 진행이다. 전환하면 `fired[to]` 에 **실제 전환 시각**이 기록되고,
그 단계의 예약은 다시 울리지 않는다. 예약 값 자체는 지우지 않는다 — 기록으로 남는다.

예약이 걸리는 전환은 `prevote` 와 `done` **둘뿐**이다 (ADR-38·43). 등록은 회차를 만드는 순간
열리고, **파티 시작은 운영자가 누른다** (ADR-14). `partyAt` 은 전환을 울리지 않는 기준점이다.
`revealAt` 은 **파티가 시작된 뒤에만** 울린다 (ADR-43) — 아무도 안 온 자리에서 발표가 뜨면
콕이 열린 적도 없어 매칭 0 으로 끝난 것이 된다.

`voteEndAt` 은 **전환이 아니라 판정이다** (ADR-39). 단계는 `prevote` 그대로고 알람도 울리지 않는다 —
매력 투표만 닫히고, 그 시각과 파티 일시 사이가 첫 자리를 짜는 시간이다.

### 생성 규칙

| 상황 | 응답 |
|---|---|
| `code` 를 지정했는데 이미 쓰는 코드 | `409 { error: "code_taken", message: HOST.pin.codeTaken }` |
| `code` 생략 | 서버가 생성. 기존 코드와 겹치지 않을 때까지 다시 뽑는다 |
| 일정이 시간 순이 아님 | `400 { error: "schedule_order" }` |
| 언제나 | 만드는 순간 `phase: "reg"`, `fired.reg` 기록 (ADR-38). `regOpenAt` 은 그 시각의 **기록**이다 |
| 같은 `requestId` 로 재요청 | 새로 만들지 않고 **같은 회차**를 200 으로 돌려준다 (S-B7) |

---

## 회차 미리보기 (인증 없음)

```
GET /api/events/by-id/:id?t=<토큰>   → PublicEvent | 404     참가 링크가 여는 화면
```

**코드로 회차를 찾던 길(`by-code`)은 닫혔다** (ADR-32). 참가 링크는 `/j/<회차id>/<토큰>` 이고,
**링크가 곧 신원이다** — 회차 아이디만으로는 이름도 일정도 열리지 않는다.
응답에 입장 코드를 담지 않는 것은 그대로다 (S-C2b).

```
POST /api/events/:id/enter   { token }  → { registered, ref, code? }   인증 없음
POST /api/register           RegisterInput → RegisterResult        초대 쿠키 필요
POST   /api/host/events/:id/invites       { phones: string[] } → Invite[]   더하기만
DELETE /api/host/events/:id/invites/:phone                     → Invite[]
```

- 토큰이 명단에 없으면 `403 not_invited`, 너무 여러 번이면 `429 too_many`. **문구는 하나뿐이다** —
  "초대되지 않았어요" 와 "그런 회차가 없어요" 를 갈라주면 그 구분이 곧 "이 사람이 이 파티에 있나" 의 답이 된다
- 통과하면 서명한 초대 쿠키가 나간다. **번호는 서버가 토큰에서 꺼낸다** (ADR-31).
  쿠키는 탭마다 갈린다 — 응답의 `ref` 가 어느 쿠키를 읽을지 고르는 이름표다 (ADR-44)
- 이미 등록한 사람에게는 참가자 세션이 곧바로 나간다
- `RegisterInput` 에 **전화번호가 없다.** 폼에서 받으면 명단에 없는 번호로 바꿔 낼 수 있다
- `invites` 는 `HostState` 에만 실린다. 참가자 응답에는 절대 없다

- 토큰이 없거나 틀리면 `404 { error: "not_found", message: ENTRY.notFound }`
- `phase: "prep"` → `canRegister: false`, `message: ENTRY.notOpenYet(...)` (되돌린 회차에서만 본다)
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
