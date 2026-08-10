# tone-pick

솔로 파티에서 관심 있는 이성을 **익명으로 '콕' 찔러두고**, 운영자가 그 신호를 **자리 배정에 반영**하며,
정해진 시각에 **서로 찌른 쌍만** 공개하는 파티 진행 웹앱.

프로토타입(`poke-party.html`)에서 기획·문구·엣지 케이스를 확정한 뒤 서버 구조로 옮기는 저장소입니다.
현재는 **골격만** 있습니다 — 설정·타입·라우팅·DO 스켈레톤까지.

---

## 왜 이 스택인가

| 선택 | 이유 |
|---|---|
| **Cloudflare Workers** | 무료 플랜에 **상업적 사용 제한이 없다.** Vercel Hobby 는 비상업 전용이라 유료 파티에 못 쓴다 |
| **Durable Objects (SQLite)** | **회차 1개 = DO 1개.** 요청이 순차 처리돼 닉네임 유일성·콕 예산 차감에 경쟁 조건이 없다 |
| **WebSocket** | 비용 문제. 5초 폴링이면 100명 × 3시간에 216,000 요청(무료 한도 10만/일 초과), WS 는 연결 1건 |
| **Vite + React SPA** | SEO·SSR 이 필요 없는 앱이다. Next.js 어댑터를 한 겹 더 얹을 이유가 없다 |
| **KV (인덱스만)** | 입장 코드 → 회차 ID 조회용. 진실은 DO 안에 있다 |

부하 특성이 특이하다. **일주일의 99.8% 는 트래픽이 0**이고 3시간만 100명이 몰린다.
상시 서버(VPS)는 이 패턴에서 가장 비싸다.

**월 0원.** 주소는 `https://tone-pick.<계정>.workers.dev` (커스텀 도메인 불필요).

---

## 시작하기

```bash
npm install

# KV 네임스페이스를 만들고 id 를 wrangler.jsonc 에 채운다
npx wrangler kv namespace create INDEX

cp .dev.vars.example .dev.vars   # MASTER_PIN, SESSION_SECRET 설정

# 개발 — 터미널 두 개
npm run dev:worker   # Worker + DO  (127.0.0.1:8787)
npm run dev          # Vite (프록시로 /api, /ws 를 8787 로 넘긴다)

npm run typecheck    # 클라이언트 + Worker 각각 검사
npm run deploy
```

---

## 구조

```
src/
├── shared/          클라이언트·Worker 공용
│   ├── types.ts       도메인 타입.  ⚠️ PublicPlayer 밖의 필드를 참가자 응답에 넣지 말 것
│   ├── phase.ts       5단계 + 일회성 알람 모델(dueTransition / schedLocked)
│   └── constants.ts   기본값 · 자리 배정 가중치 · 콕 기대 매칭(k²)
├── server/
│   ├── index.ts       Hono 진입점. 인증·라우팅만 한다
│   ├── event-do.ts    회차 DO — SQLite 스키마 + WebSocket Hibernation
│   ├── auth.ts        PIN 검사 (회차 PIN 우선 — 보안 경계다)
│   ├── seating.ts     자리 배정. 성비는 구조적으로 못 깨진다
│   └── routes/        host.ts / participant.ts
└── client/
    ├── router.tsx     URL 맵. 모달도 라우트다
    ├── lib/           api · realtime · serverTime · history
    ├── routes/        화면 스텁
    └── styles/theme.css   전부 CSS 변수 → 테마 교체의 토대
```

---

## 반드시 지킬 것 세 가지

**① 참가자 응답에 실명·전화번호·인스타를 절대 넣지 않는다.**
매칭된 상대에게도 안 준다. 개발자 도구로 응답을 열어보는 참가자가 반드시 있다.
발표 전에는 콕 발신자 정보도 응답에 없어야 한다. `toPublic()` 을 거칠 것.

**② PIN 은 회차 PIN 을 먼저 검사한다.**
공통 PIN 을 먼저 보면 두 값이 같을 때 회차 담당자가 전체 관리자 권한을 얻는다.
실제로 겪은 사고다. 생성 지점(위저드·회차 설정·기본 설정·자동 생성기)에서도 동일 PIN 을 막는다.

**③ 단계 전환은 서버 시각으로 판단한다.**
클라이언트 시계를 쓰면 폰 시간을 바꿔 결과를 먼저 볼 수 있다.
모든 응답에 `x-server-time` 을 실어 보내고 클라이언트는 오프셋만 보정한다.

---

## 무료 플랜 주의점

요청당 CPU **10ms** 제한이 있다. 자리 배정 로컬 서치만 주의하면 된다.

1. `iterations` 를 인원 수에 맞춰 제한
2. 또는 배정을 여러 요청으로 쪼개 점진 개선 (DO 가 상태를 들고 있으므로 자연스럽다)
3. 그래도 부족하면 Workers 유료 **$5/월** (월 30M CPU-ms)

배포 전에 실제 인원으로 CPU 시간을 한 번 측정할 것.

---

## 다음 작업

- [ ] EventDO 도메인 명령 구현 (register / poke / phase / seating / reveal)
- [ ] 세션 쿠키 (HttpOnly, 전화번호를 URL 에 노출하지 않기)
- [ ] `buildSeating()` 이식 + CPU 시간 측정
- [ ] 화면 이식 — 참가자 3탭 → 운영자 4탭 → 위저드 → 데모 뷰
- [ ] 회차 종료 N일 뒤 개인정보 파기 (Cron Trigger)
- [ ] 100명 동시 접속 리허설

기획·UI/UX·엣지 케이스 문서는 Claude 프로젝트 *"솔로 파티에서 좋아하는 이상형 콕 찌르기 앱"* 의
`claude/00-문서-인덱스.md` 참고. 요약은 `docs/` 에 있습니다.
