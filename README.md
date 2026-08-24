# tone-pick

솔로 파티에서 관심 있는 이성을 **익명으로 '콕' 찔러두고**, 운영자가 그 신호를 **자리 배정에 반영**하며,
정해진 시각에 **서로 찌른 쌍만** 공개하는 파티 진행 웹앱.

프로토타입(`poke-party.html`)에서 기획·문구·엣지 케이스를 확정한 뒤 서버 구조로 옮긴 저장소입니다.
지금은 **동작하는 앱**입니다 — 회차 생성·등록·콕·자리 배정·발표까지 한 바퀴가 돕니다.

---

## 왜 이 스택인가

| 선택 | 이유 |
|---|---|
| **Cloudflare Workers** | 무료 플랜에 **상업적 사용 제한이 없다.** Vercel Hobby 는 비상업 전용이라 유료 파티에 못 쓴다 |
| **Durable Objects (SQLite)** | **회차 1개 = DO 1개.** 요청이 순차 처리돼 닉네임 유일성·콕 예산 차감에 경쟁 조건이 없다 |
| **WebSocket** | 비용 문제. 5초 폴링이면 100명 × 3시간에 216,000 요청(무료 한도 10만/일 초과), WS 는 연결 1건 |
| **Vite + React SPA** | SEO·SSR 이 필요 없는 앱이다. Next.js 어댑터를 한 겹 더 얹을 이유가 없다 |
| **레지스트리 DO** | 입장 코드 유일성·멱등키·공통 PIN. KV 는 쓰기 직후 읽기가 보장되지 않아 코드가 겹칠 수 있다 (ADR-9) |

부하 특성이 특이하다. **일주일의 99.8% 는 트래픽이 0**이고 3시간만 100명이 몰린다.
상시 서버(VPS)는 이 패턴에서 가장 비싸다.

**월 0원.** 주소는 `https://tone-pick.<계정>.workers.dev` (커스텀 도메인 불필요).

---

## 시작하기

```bash
npm install
cp .dev.vars.example .dev.vars   # MASTER_PIN, SESSION_SECRET 설정

# 개발 — 터미널 두 개
npm run dev:worker   # Worker + DO  (127.0.0.1:8787). 클라이언트를 빌드해 함께 서빙한다
npm run dev          # Vite (프록시로 /api, /ws 를 8787 로 넘긴다)

npm run check        # 타입 + 문구 검사. 커밋 전에 이걸 돌린다
npm test             # workerd 안의 규칙 테스트 + 화면 테스트
npm run deploy       # 별도 설정 없이 바로 나간다 (KV 네임스페이스 필요 없음)
```

배포에 필요한 비밀값은 두 개뿐입니다.

```bash
npx wrangler secret put MASTER_PIN
npx wrangler secret put SESSION_SECRET
```

## 두 환경

| 환경 | 주소 | 무엇에 쓰나 |
|---|---|---|
| 프로덕션 | `tone-pick.<계정>.workers.dev` | 진짜 파티 |
| QA | `tone-pick-qa.<계정>.workers.dev` | 리허설·부하 시험·기능 확인 |

**워커가 다르면 Durable Object 도 다릅니다.** QA 의 회차·참가자·콕은 프로덕션과 섞이지 않고
시크릿도 따로 넣습니다 (`npx wrangler secret put MASTER_PIN --env qa`).

### 어떻게 QA 로 올리나

```
브랜치 → PR(base: qa) → CI 통과하면 자동 머지 → QA 배포
브랜치 → PR(base: main) → CI 통과 + 사람이 머지 → 프로덕션 배포
```

프로덕션만 사람이 버튼을 누릅니다. QA 는 "일단 올려보는" 자리라 자동으로 들어갑니다 —
다만 관문(`npm run check` · `npm test` · `npm run build`)은 양쪽 다 지납니다.

`qa` 브랜치는 언제 버려도 되는 브랜치입니다. 오래 굴려 프로덕션과 멀어지면 맞춰주세요.

```bash
git push -f origin main:qa      # qa 를 main 기준으로 되돌린다
git push -f origin HEAD:qa      # PR 없이 지금 브랜치를 바로 QA 로 (급할 때)
```

### 100명 리허설

```bash
MASTER_PIN=**** npm run rehearsal https://tone-pick-qa.<계정>.workers.dev
```

100명 등록 → 소켓 100개 → 콕 300회 → 자리 배정 → 발표까지 실제 규모로 한 바퀴 돌리고,
구간별 p50/p95 를 찍습니다. 끝나면 회차를 지웁니다(`--keep` 으로 남길 수 있음).

**ENV_LABEL 이 없는 곳에서는 시작하지 않습니다** — 프로덕션에 가짜 100명을 넣는 사고를 막습니다.
CPU 시간은 밖에서 잴 수 없으니, 자리 배정이 성공하는지로 판정하고 정확한 값은 대시보드의
Observability 에서 봅니다.

실측(100명·12테이블): 자리 배정 **261ms**, 단계 알림 99/99 도달, 실패 0.
한계는 **회차 DO 의 쓰기 약 5건/초** — 읽기는 동시 25건에도 195ms 입니다.
자세한 숫자와 해석은 `docs/PLAN.md`.

QA 에서는 화면 맨 위에 노란 띠가 뜹니다. 주소가 아니라 **배포된 설정**(`ENV_LABEL`)이 근거라,
나중에 커스텀 도메인이 붙어도 그대로 따라옵니다. 파티 당일 운영자가 연습용 콘솔에서 단계를
넘기고 "참가자 화면이 왜 안 바뀌지?" 하는 사고를 막는 장치입니다.

---

## 구조

```
src/
├── shared/          클라이언트·Worker 공용
│   ├── types.ts       도메인 타입.  ⚠️ PublicPlayer 밖의 필드를 참가자 응답에 넣지 말 것
│   ├── phase.ts       5단계 + 일회성 알람 모델(dueTransition / schedLocked)
│   └── constants.ts   기본값 · 자리 배정 가중치 · 콕 기대 매칭(k²)
│   └── time.ts        시각·기간 포매팅 (문장 조립은 copy.ts 가 한다)
├── server/
│   ├── index.ts       Hono 진입점. 인증·라우팅만 한다
│   ├── event-do.ts    회차 DO — 상태를 바꾸는 곳은 여기뿐이다
│   ├── registry-do.ts 회차 목록·입장 코드·공통 PIN. 단 하나뿐인 DO
│   ├── auth.ts        PIN 검사 (회차 PIN 우선 — 보안 경계다) + 세션 쿠키
│   ├── seating.ts     자리 배정. 성비는 구조적으로 못 깨진다
│   ├── http.ts        환경·서버 시각·에러 응답·권한 확인
│   └── routes/        host.ts / participant.ts
└── client/
    ├── router.tsx     URL 맵. 모달도 라우트다
    ├── lib/           api · realtime · serverTime · history · 알림 파생
    ├── ui/            확인창·토스트 · 상태 셀 · 자리 확인 화면
    ├── routes/        참가자 4탭 · 운영자 4탭 · 위저드
    └── styles/theme.css   전부 CSS 변수 → 테마 교체의 토대

test/
├── 01-event-create-join.test.ts     회차 생성·입장 코드·권한 경계
├── 02-register-poke-reveal.test.ts  등록·콕·공개 범위
├── 05-seating.test.ts               자리 배정 불변식 (순수 함수)
└── client/                          화면이 조용히 죽지 않는지 (ADR-8)
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

- [x] EventDO 도메인 명령 (register / poke / phase / seating / reveal)
- [x] 세션 쿠키 (HttpOnly, 전화번호를 URL 에 노출하지 않기)
- [x] `buildSeating()` + CPU 시간 측정 (100명 12테이블 기준 3ms 안쪽)
- [x] 화면 — 참가자 4탭 · 운영자 4탭 · 위저드
- [x] 100명 동시 접속 리허설 — 실측은 `docs/PLAN.md`
- [ ] 실기기 점검 (iOS 100dvh·가장자리 스와이프, 안드로이드 백 버튼)

기획·UI/UX·엣지 케이스 문서는 Claude 프로젝트 *"솔로 파티에서 좋아하는 이상형 콕 찌르기 앱"* 의
`claude/00-문서-인덱스.md` 참고. 요약은 `docs/` 에 있습니다.
