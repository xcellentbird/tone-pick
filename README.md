# tone-pick

솔로 파티에서 마음이 가는 사람을 **익명으로 '콕' 찔러두고**, 그 신호가 **자리 배정에 반영**되며,
정해진 시각에 **서로 찌른 쌍만** 공개하는 파티 진행 웹앱.

고르는 일은 **둘로 갈려 있습니다** — 만나기 전에 하는 `프로필 투표`,
파티에서 만나본 뒤에 하는 `콕 찌르기`. 발표에 이어지는 건 뒤엣것뿐입니다 (ADR-34).

**참가 링크는 회차마다 하나입니다.** 참가자는 초대 명단에 있는 **전화번호**로 들어오고, 등록할 때 정한
**PIN 번호 4자리**로 다시 들어옵니다 (ADR-75). 링크 자체에는 신원이 없습니다.

지금 버전은 **2.12.0** — 무엇이 바뀌었는지는 `CHANGELOG.md`.

---

## 왜 이 스택인가

| 선택 | 이유 |
|---|---|
| **Cloudflare Workers** | 무료 플랜에 **상업적 사용 제한이 없다.** Vercel Hobby 는 비상업 전용이라 유료 파티에 못 쓴다 |
| **Durable Objects (SQLite)** | **회차 1개 = DO 1개.** 요청이 순차 처리돼 닉네임 유일성·콕 예산 차감에 경쟁 조건이 없다 |
| **WebSocket** | 비용 문제. 5초 폴링이면 100명 × 3시간에 216,000 요청(무료 한도 10만/일 초과), WS 는 연결 1건 |
| **Vite + React SPA** | SEO·SSR 이 필요 없는 앱이다. Next.js 어댑터를 한 겹 더 얹을 이유가 없다 |
| **레지스트리 DO** | 입장 코드 유일성·멱등키·운영자 PIN 시도 기록. KV 는 쓰기 직후 읽기가 보장되지 않아 코드가 겹칠 수 있다 (ADR-9) |

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

npm run check        # 타입 + 문구·번역투·설정·테마·ADR 검사. 커밋 전에 이걸 돌린다
npm test             # workerd 안의 규칙 테스트 + 화면 테스트
npm run guard        # 릴리스 차선. 옛 스키마 + 번들 예산 (main 으로 올리기 전에)
npm run deploy       # 프로덕션 (KV 네임스페이스 필요 없음 — 아래 비밀값과 R2 버킷만)
```

배포에 필요한 비밀값은 두 개입니다. 오늘의 연애운을 켜려면 LLM 키를 하나 더 넣습니다
(없어도 화면은 뜨고 규칙 문구로 대신합니다).

```bash
npx wrangler secret put MASTER_PIN
npx wrangler secret put SESSION_SECRET
npx wrangler secret put OPENAI_API_KEY   # 선택
```

콕 로그(ADR-84)를 쌓는 R2 버킷은 **배포 전에 있어야 합니다** — 없으면 배포가 거절됩니다.

```bash
npx wrangler r2 bucket create tone-pick-logs
```

### 한국에서만 열립니다

`/api` 와 `/ws` 는 `wrangler.jsonc` 의 `ALLOWED_COUNTRIES` 에 적힌 나라에서만 답합니다
(ADR-92). 기본값은 `KR` 입니다.

**파티 중에 로밍이나 VPN 때문에 못 들어오는 참가자가 생기면** 그 값을 `""` 로 비우고
다시 배포하세요. 그것이 끄는 유일한 길입니다 — 운영자 콘솔에는 스위치가 없습니다.

## 두 환경

| 환경 | 주소 | 무엇에 쓰나 |
|---|---|---|
| 프로덕션 | `tone-pick.<계정>.workers.dev` | 진짜 파티 |
| QA | `tone-pick-qa.<계정>.workers.dev` | 리허설·부하 시험·기능 확인 |

**워커가 다르면 Durable Object 도 다릅니다.** QA 의 회차·참가자·콕은 프로덕션과 섞이지 않습니다.
QA 의 `MASTER_PIN`·`SESSION_SECRET` 은 **`wrangler.jsonc` 의 `env.qa.vars` 에 적혀 있습니다** —
`wrangler secret put ... --env qa` 를 쓰지 마세요. 시크릿이 그 값을 이겨서 둘이 어긋납니다.
QA 에 따로 넣는 시크릿은 `OPENAI_API_KEY` 하나이고, R2 버킷은 `tone-pick-qa-logs` 입니다.

### 어떻게 QA 로 올리나

```
기능 브랜치 → PR(base: qa)  → CI 통과하면 자동 머지 → QA 배포
qa          → PR(base: main) → CI + release-guard 통과 + 사람이 머지 → 프로덕션 배포
```

사람이 버튼을 누르는 건 `qa → main` 하나뿐입니다. QA 는 "일단 올려보는" 자리라 자동으로 들어갑니다 —
다만 관문(`npm run check` · `npm test` · `npm run build`)은 양쪽 다 지납니다.
`qa` 로 가는 PR 은 드래프트로 열지 마세요 — 드래프트는 자동 머지를 멈춰 세웁니다.

`main` 으로 가는 PR 은 여기에 **`release-guard`** 가 하나 더 붙습니다 (`npm run guard`) —
옛 모양으로 저장된 회차가 지금 코드로 열리는지, 번들이 예산 안인지 봅니다.
`npm test` 가 구조적으로 못 잡는 둘이라 따로 뒀고, 매 PR 에 붙이지 않는 이유는
러너를 하나 더 잡기 때문입니다 — 큐가 밀리면 필수 검사가 앉습니다.

`qa` 에는 **아직 프로덕션에 안 나간 기능**이 쌓여 있습니다. 강제 푸시로 되돌리거나 PR 없이 밀어 넣지
마세요 — 나갈 차례를 기다리던 기능이 사라지고, CI 라는 관문을 건너뜁니다.

### 100명 리허설

```bash
MASTER_PIN=**** npm run rehearsal https://tone-pick-qa.<계정>.workers.dev
```

100명 등록 → 소켓 100개 → 콕 300회 → 자리 배정 → 발표까지 실제 규모로 한 바퀴 돌리고,
구간별 p50/p95 를 찍습니다. 끝나면 회차를 지웁니다(`--keep` 으로 남길 수 있음).

**ENV_LABEL 이 없는 곳에서는 시작하지 않습니다** — 프로덕션에 가짜 100명을 넣는 사고를 막습니다.
CPU 시간은 밖에서 잴 수 없으니, 자리 배정이 성공하는지로 판정하고 정확한 값은 대시보드의
Observability 에서 봅니다.

실측(QA 50명, 2026-08-20): 실패 0, **어느 구간도 줄을 서지 않습니다** — 읽기가 쓰기 뒤에 서지 않고,
콕은 핸들러 안에서 48ms 입니다. 예전에 적혀 있던 "DO 쓰기 약 5건/초" 는 측정 도구가 만든 숫자라
철회했습니다. 자세한 숫자와 해석은 `docs/PLAN.md`.

QA 에서는 화면 맨 위에 노란 띠가 뜹니다. 주소가 아니라 **배포된 설정**(`ENV_LABEL`)이 근거라,
나중에 커스텀 도메인이 붙어도 그대로 따라옵니다. 파티 당일 운영자가 연습용 콘솔에서 단계를
넘기고 "참가자 화면이 왜 안 바뀌지?" 하는 사고를 막는 장치입니다.

---

## 구조

```
src/
├── shared/          클라이언트·Worker 공용
│   ├── types.ts       도메인 타입.  ⚠️ 참가자 응답은 toPublic()(남) · toMe()(본인) 두 곳에서만 만든다
│   ├── phase.ts       5단계 + 일회성 알람 모델(dueTransition / schedLocked)
│   ├── constants.ts   기본값 · 자리 배정 가중치(SEAT_W) · 콕 기대 매칭(k²)
│   ├── fortune.ts     LLM 에 보내는 값을 만드는 곳 — fortuneInput / missionInput (ADR-20)
│   ├── pulse.ts       지표 허용 목록 (ADR-56)
│   ├── copy.ts        화면에 나가는 **모든** 문구. 밖에 하드코딩하면 check:copy 가 잡는다
│   ├── invite.ts      안내문 렌더링 — {장소} {일시} {링크} (ADR-75)
│   ├── time.ts        시각·기간 포매팅 (문장 조립은 copy.ts 가 한다)
│   └── …              poke · roster · seats 등
├── server/
│   ├── index.ts       Hono 진입점. 인증·라우팅만 한다
│   ├── event-do.ts    회차 DO — 상태를 바꾸는 곳은 여기뿐이다
│   ├── registry-do.ts 회차 목록·입장 코드·운영자 PIN 시도 기록. 단 하나뿐인 DO
│   ├── auth.ts        PIN 검사 (운영자 PIN 하나뿐 — ADR-12) + 탭별 세션 쿠키 (ADR-44)
│   ├── seating.ts     자리 배정(buildSeating). 배정 결과의 성비는 구조적으로 못 깨진다
│   ├── http.ts        환경·서버 시각·에러 응답·권한 확인
│   ├── metrics.ts     운영 카운터 · 집계 지표 (회차 DO 밖에 쌓이는 것)
│   ├── poke-log.ts    콕 로그 → R2 (ADR-84)
│   └── routes/        host.ts / participant.ts
└── client/
    ├── router.tsx     URL 맵. 모달도 라우트다
    ├── lib/           api · realtime · serverTime · history · 알림 파생
    ├── ui/            확인창·토스트 · 상태 셀 · 자리 확인 화면
    ├── routes/        참가자 4탭 · 운영자 5탭 · 위저드
    └── styles/theme.css   전부 CSS 변수 → 테마 교체의 토대

test/                                번호는 대개 슬라이스, 일부는 ADR 번호다 (실행 순서가 아니다)
├── 01-event-create-join.test.ts     회차 생성·입장 코드·권한 경계
├── 02-register-poke-reveal.test.ts  등록·콕·공개 범위
├── 05-seating.test.ts               자리 배정 불변식 (순수 함수)
├── 15-pin-entry.test.ts             번호 + PIN 번호로 들어오는 길 (ADR-75)
├── 22-poke-rules.test.ts            매력 투표 ↔ 콕 라운드 경계 (ADR-34)
├── 44-tab-sessions.test.ts          탭마다 다른 참가자 (ADR-44)
└── client/                          화면이 조용히 죽지 않는지 (ADR-8)
```

**파일이 곧 성능 대책이다.** 워커 테스트는 파일마다 아이솔레이트가 새로 뜨는데
한 파일 안에서는 앞 테스트가 뒤에 쌓인다 — 96개짜리 파일 끝에서 110ms 짜리가 11초가 됐다.
100개 가까이 불어나면 나눈다.

---

## 반드시 지킬 것

규칙은 **`CLAUDE.md` 한 곳**에 있습니다 — 여기 옮겨 적으면 둘이 어긋납니다. 가장 무거운 셋만 이름을 들면:
참가자 응답에 연락처를 넣지 않는다(ADR-42·47) · 운영자 PIN 은 하나뿐이다(ADR-12) ·
단계 전환은 서버 시각으로 판단한다.

---

## 무료 플랜 주의점

요청당 CPU **10ms** 제한이 있다. 걸리는 건 자리 배정 로컬 서치 하나다 —
`buildSeating` 에 평가 예산이 걸려 있고, 100명·12테이블에서 통과했다 (`docs/SEATING.md`).
그래도 모자라면 Workers 유료 **$5/월** (월 30M CPU-ms).

---

## 다음 작업

남은 것은 `docs/PLAN.md` 의 슬라이스 표에 있습니다. 지금 열려 있는 것:

- [ ] 실기기 점검 (iOS 100dvh·가장자리 스와이프, 안드로이드 백 버튼)
- [ ] 운영자가 텍스트 공지를 쓰는 화면 (서버와 참가자 쪽 소식은 있다. 설문은 27 로 나갔다 — `docs/PLAN.md` 14)
- [ ] 둘째 라운드부터의 함께 점수 — 실제 파티에서 재보고 확정한다 (ADR-34 `보류한 것`)

문서는 전부 `docs/` 에 있습니다. 어느 것을 읽어야 하는지는 `CLAUDE.md` 의 라우팅 표를 보세요.
