# 슬라이스 14 — 공개 표면

시나리오: `14-host-announce.md`

**여기 적힌 것만 계약이다.** 내부 구조 — DO 안을 어떻게 나눌지, 표를 어느 테이블에 둘지 —
는 구현자가 정한다. 테스트도 이 표면에만 붙는다.

---

## 이름 — `Announcement` 가 `Notice` 를 **만들어낸다**

| | |
|---|---|
| `Announcement` | **운영자가 보낸 것.** 저장된다 |
| `Notice` | **참가자 소식 줄.** `noticesOf()` 가 상태에서 파생시킨다 (ADR-4) |

겹치게 짓지 마라. 둘을 구분 못 하게 되는 순간 "알림을 저장한다" 로 읽히고,
그러면 읽음 플래그·알림 테이블이 뒤따라온다.

---

## 타입

```ts
export type PollChoice = "a" | "b";

/** 운영자가 보낸 것. 회차 DO 안에만 있다 — 파기가 DO 하나 지우는 일로 끝나야 한다 */
export interface Announcement {
  id: string;
  at: number;
  /** 텍스트 알림이면 이게 전부. 투표면 질문이다 */
  text: string;
  /** 있으면 A/B 투표다 */
  poll?: { a: string; b: string; closedAt?: number };
}

/**
 * 참가자에게 내려가는 모양.
 * **누가 무엇을 골랐는지는 여기 없다** — 숫자 둘과 *내* 선택뿐이다.
 */
export interface PublicAnnouncement {
  id: string;
  at: number;
  text: string;
  poll?: {
    a: string;
    b: string;
    count: { a: number; b: number };
    /** 아직 안 골랐으면 없다 */
    mine?: PollChoice;
    closed: boolean;
  };
}
```

### 표는 저장하되 **사람과 함께 나가지 않는다**

한 사람이 한 표라는 규칙을 지키려면 `playerId → choice` 를 저장할 수밖에 없다.
그런데 **어떤 응답에도 그 짝을 싣지 않는다 — 운영자 응답에도.**

운영자는 전체를 보지만(원칙 2) *누가 9시를 골랐나* 를 알 이유가 없다.
그리고 응답에 없으면 **화면이 실수로라도 보여줄 수 없다.**
`toPublic()` 이 참가자 응답에 하는 일을 여기서는 계약이 한다.

---

## 상태에 실리는 자리

```ts
ParticipantState.announcements: PublicAnnouncement[]   // 최신순
HostState.announcements:        HostAnnouncement[]     // Announcement + count: { a, b }
```

**`noticesOf(state)` 는 여전히 순수 함수다.** 상태 안에 파생되지 않은 값이 하나 생길 뿐이고,
소식 줄은 지금처럼 상태에서 만들어진다. `Notice` 에 칸 하나가 는다 —

```ts
/** 있으면 이 소식 줄에 투표 버튼이 붙는다. 없으면 지금까지와 같다 */
poll?: { id: string } & PublicAnnouncement["poll"];
```

`id` 가 함께 가는 이유는 버튼이 어디로 보낼지 알아야 해서다.

---

## 참가자

```
POST /api/vote      { id: string, choice: PollChoice }   → PublicAnnouncement
```

- 돌려주는 건 **갱신된 그 알림 하나**다. 화면은 이 값을 그대로 쓰고 다시 읽지 않는다 —
  슬라이스 17 과 같은 이유다. **서버가 방금 준 답을 버리고 다시 묻지 않는다**
- 한 사람은 **한 표**다. 다시 부르면 옮겨간다 (`409` 가 아니다 — 마음을 바꾸는 건 실패가 아니다)
- 닫힌 투표에 보내면 `409 { error: "closed" }`
- 없는 `id` 는 `404`. **지워진 알림에 보내는 경우가 실제로 생긴다** — 운영자가 방금 지웠는데
  참가자 화면이 아직 옛 목록일 때다

---

## 운영자 (master 전용)

```
POST   /api/host/events/:id/announcements        AnnounceInput → HostAnnouncement
PUT    /api/host/events/:id/announcements/:aid   { open: boolean } → HostAnnouncement
DELETE /api/host/events/:id/announcements/:aid   → 204
```

```ts
export interface AnnounceInput {
  text: string;
  /** 없으면 텍스트 알림이다 */
  poll?: { a: string; b: string };
}
```

- **목록을 읽는 길을 따로 만들지 않는다.** `HostState` 에 이미 실려 온다
- `POST` 는 **열린 투표가 있으면 그것을 닫고** 새것을 만든다 (S-B4).
  열린 투표는 한 번에 하나다
- `PUT { open }` 은 **되돌릴 수 있으므로 확인창이 없다.** 닫았다 다시 열 수 있다
- `DELETE` 는 표를 함께 지운다 — 되돌릴 수 없으므로 확인창이 붙고,
  **사라지는 표 개수를 숫자로 보여준다** (S-C2)
- `text` 가 비면 `400`. 투표면 `a`·`b` 둘 다 있어야 한다
- **참가자를 선택지로 고르는 입력을 만들지 마라.** 손으로 쳐야만 이름이 들어간다 (시나리오 첫 규칙)

---

## 실시간

기존 방송 하나를 그대로 쓴다 — **"다시 읽어라"** 만 보내고 참가자가 다시 읽는다 (ADR-26).
새 신호를 만들지 않는다.

> ⚠️ **표 하나가 전원의 다시 읽기를 부른다.** 28명이면 28 × 28 ≈ 784 번이 1분에 흩어져
> 나가므로 문제가 아니다. **100명이면 10,000 번**이라 그때는 방송을 묶어야 한다.
> 지금 묶지 마라 — 필요해지기 전에 만든 장치는 대개 틀린 모양이다.
> 이 줄은 **언제 다시 봐야 하는지**를 적어둔 것이다.

---

## 화면

| 어디 | 무엇 |
|---|---|
| 참가자 홈 · 소식 목록 | 📢 알림 · 📊 투표(선택 버튼 + 집계) |
| 참가자 배너 | 3분 안이면 뜬다. **투표 버튼은 없다** — 사라지는 것 위에 손가락을 올리지 않는다 |
| 운영자 현황 탭 | 보내기 · 집계 · 닫기/열기 · 지우기 |

배너를 누르면 홈으로 간다. `Notice.tab` 이 이미 하는 일이다.

---

## 안 만드는 것 (계약에서 뺀다)

- `GET /api/host/.../announcements` — `HostState` 에 있다
- 읽음 표시·읽은 사람 수를 담는 칸
- 개인 대상 필드 (`toPlayerId` 같은 것). **하나만 만들어도 익명 채팅의 입구가 된다**
- 선택지 3개 이상 (`c`, `options: string[]`)
- 예약 발송. 파티 당일의 전환은 사람이 누른다 (ADR-14)
