# 평가용 파티 판

`buildSeating` 을 **실제 파티의 사람 구성**으로 돌려보는 자리다.
`test/05-seating.test.ts` 의 표본은 24~44세 균등 난수라 실제와 나이 분포가 다르고,
나이차 벌점이나 `MEET_GAP` 을 건드릴 때 그 차이가 결론을 바꾼다.

```
npx wrangler r2 object get tone-pick-logs/poke-logs/<회차id>.csv --remote --file tmp/poke-log.csv
MASTER_PIN=**** node scripts/party-export.mjs --name 2026-09-1회차 --pokes tmp/poke-log.csv
```

`eval/parties/<이름>.json` 하나가 나온다.

## 들어 있는 것

| 칸 | 설명 |
|---|---|
| `people` · `men` · `women` | 인원과 성비 |
| `tableCounts` · `rounds` | 운영자가 라운드마다 고른 테이블 수 |
| `players[]` | `nickname` · `age` · `gender` · `mbti` · `charms` |
| `voteSent` · `voteReceived` | 매력 투표 — 사람별 수 |
| `pokeSent` · `pokeReceived` | 콕 — 사람별 수 |
| `votes` · `pokes` | **방향이 있는 표·콕** (`"p0>p3": 2`) — `buildSeating` 이 받는 모양 그대로다 |
| `mutual[]` | 서로 찌른 쌍 |
| `seatings[]` | 라운드별로 실제 만들어진 자리 |

**이름 · 전화번호 · 인스타는 가명이다.** 값을 버리고 자리만 채운다.
닉네임은 남는다 — 자리 결과를 눈으로 읽을 때 필요해서다. `--anon-nick` 을 주면 그것도 지운다.

## 방향이 있는 표·콕 — 들어간다, 그래서 무겁다

`buildSeating` 은 `votes: { "A>B": n }` 를 받고, 이 판에 그 모양 그대로 들어간다.
**끌림까지 그대로 재생할 수 있다** — 나이차 벌점을 바꿨을 때 그 파티의 자리가 실제로 어떻게
달라졌을지를 잰다는 뜻이다. 앱은 그 방향을 내주지 않는다 — 콕 로그 파일(ADR-84)을 Cloudflare 에서 받아
`--pokes tmp/poke-log.csv` 로 넘긴다. 로그는 ADR-84 배포 뒤의 파티에만 있다.

⚠️ **그 줄 하나하나가 일방적인 호감이다.** 참가자에게는 끝까지 드러나지 않고(이 앱의 존재 이유다)
운영 중 콘솔에도 뜨지 않는 값이다 (ADR-22). 로그 파일로 남는 것까지는 ADR-84 가 연 길이지만,
**저장소에 넣는 것은 그것을 git 기록에 영구히 남기는 일**이라 그 다음 걸음이다.
방향이 필요 없는 측정이면 `--no-pairs` 로 빼고 뽑아라 — 나이 분포·성비·테이블 수가 만드는 것은
그것 없이도 다 잰다.

## ⚠️ 넣을 때마다 다시 정하라

가명으로 바꿔도 **실제 사람들의 자료다.** 닉네임 · 나이 · MBTI · 매력 문구가 함께 있으면
그 파티에 있던 사람은 서로를 알아본다. 매력 문구는 **본인이 쓴 문장**이라 특히 그렇다.

저장소에 넣으면 **git 기록에 영구히 남고 GitHub 로 나간다.** 지우는 커밋을 올려도 기록에는 남는다.
`.gitignore` 의 `tmp/` 줄이 같은 이유로 회고용 뽑기를 막고 있다 — 그 판단과 이 폴더는 어긋난다.
재는 일이 끝났으면 **파일을 지우는 쪽이 기본**이고, 남기는 것이 예외다.
