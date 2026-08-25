# 사용자 플로우

GitHub 에서 그대로 그려진다. 화면을 바꾸면 **여기도 같이 고친다** — 안 고치면
다음에 이 그림을 근거로 틀린 판단을 하게 된다. (실제로 `FLOWS.md` 가 한 번 뒤처졌다)

| 그림 | 답하는 질문 |
|---|---|
| [1 참가자](#1-참가자-플로우) | 참가자가 어느 화면을 거치나 |
| [2 운영자](#2-운영자-플로우) | 운영자가 어느 화면을 거치나 |
| [3 상호 영향](#3-상호-영향) | 한쪽 행동이 반대쪽에 어떻게 나타나나 |
| [4 회차 단계](#4-회차-단계) | 회차가 어떤 상태를 지나나 |
| [5 단계별 양쪽](#5-단계별로-양쪽이-무엇을-하나) | 각 단계에서 둘이 각각 뭘 하나 |
| [6 설정 분기](#6-설정이-만드는-분기) | 운영자 설정이 단계와 화면을 어떻게 바꾸나 |

---

## 1 참가자 플로우

```mermaid
flowchart LR
    link(["참가 링크 /j/회차id/토큰"])
    app(["앱 주소만 연 경우"])
    linkOnly["참가 링크로 들어와주세요"]
    joinInfo["회차 확인 — 토큰이 있어야 열린다"]
    joinCheck{"토큰이 등록됐다고 하나"}
    canReg{"등록할 수 있나"}
    closed["언제 열리는지 안내"]

    reg1["1 기본 정보"]
    reg2["2 연락처"]
    reg3["3 나를 소개"]
    nickTaken{"닉네임 중복"}

    subgraph tabs ["참가자 화면 · 하단 탭 4개"]
        home["홈 : 할 일 · 내 자리 · 소식"]
        people["참가자 : 목록 · 이성만 또는 전체"]
        me["내 정보 : 프로필 · 결과"]
        fun["재미 : 운세 · 미션 (매력 투표부터)"]
    end

    profile["프로필 시트"]
    pokeConfirm{"콕 확인창"}
    poked["콕 발송 · 되돌리기는 회차 설정"]
    seatAck["자리 이동 확인 전체화면"]
    result["매칭 상세 · 실명까지"]

    hostSeat(("운영자가 자리 발송"))
    hostReveal(("운영자가 발표"))

    app --> linkOnly
    link --> joinInfo --> joinCheck
    joinCheck -->|"등록했다"| home
    joinCheck -->|"처음"| canReg
    canReg -->|"준비 중 또는 종료"| closed
    canReg -->|"등록 중"| reg1
    reg1 --> reg2 --> reg3 --> nickTaken
    nickTaken -->|"겹침"| reg1
    nickTaken -->|"통과"| home

    people --> profile
    people --> pokeConfirm
    profile --> pokeConfirm
    pokeConfirm -->|"확인"| poked
    poked -.->|"익명 알림"| people

    hostSeat -.-> seatAck
    seatAck -->|"이동했어요"| home
    hostReveal -.-> result
    me --> result

    style tabs fill:#C2E5FF,stroke:#3DADFF
    style closed fill:#D9D9D9,stroke:#B3B3B3
    style pokeConfirm fill:#FFECBD,stroke:#FFC943
    style nickTaken fill:#FFECBD,stroke:#FFC943
    style seatAck fill:#FFE0C2,stroke:#FF9E42
    style result fill:#CDF4D3,stroke:#66D575
```

- **링크가 곧 신원이다** (ADR-32). 명단 한 줄마다 토큰이 하나고, 사람마다 다른 링크를 1:1 로 보낸다 —
  참가자는 전화번호를 치지 않는다. 링크 없이 앱 주소만 연 사람에게는 안내 한 줄뿐이다
- 링크를 다시 열면 **이미 등록한 사람인지 먼저 본다.** 등록 화면이 또 나오면
  "내가 등록이 안 됐나" 하고 두 번 등록하려 든다
- **그 판정은 토큰이 답한 값(`registered`)이 한다** (ADR-44). 브라우저 세션에 물으면
  두 번째 탭이 첫 번째 탭 사람으로 넘어간다
- 홈이 스택의 바닥이다. 어느 탭에 있든 뒤로 가기 한 번이면 홈 (`ROUTES.md`)
- 자리 이동 확인은 **발표가 끝났으면 띄우지 않는다**

## 2 운영자 플로우

```mermaid
flowchart LR
    entry(["입장 화면"])
    pin[/"운영자 PIN — 하나뿐이다 (ADR-12)"/]
    events["회차 목록"]
    defaults["회차 기본 설정 · 안내문 템플릿"]

    w1["1 기본 정보"]
    w2["2 예약 · 30분 단위"]
    w3["3 투표 · 콕 설정"]

    subgraph console ["회차 콘솔 · 4탭"]
        dash["현황"]
        players["참가자"]
        seats["자리"]
        settings["설정"]
    end

    phaseConfirm{"단계 전환 확인창"}
    invites["초대 명단 시트 · 링크 복사"]
    sheet["참가자 상세"]
    delConfirm{"삭제 확인창"}
    pick["배정 1걸음 · 뺄 사람"]
    tables["배정 2걸음 · 테이블 수"]
    draft["자리 초안 · 💘 💔 로 짝 표시"]
    swap["맞교환 — 남녀도 된다 (ADR-16)"]
    pubConfirm{"발송 확인창"}
    published["참가자에게 자리 알림"]

    entry --> pin --> events
    events --> defaults
    events --> w1 --> w2 --> w3 --> dash

    dash --> phaseConfirm
    players --> invites
    players --> sheet --> delConfirm
    seats --> pick --> tables --> draft
    draft --> swap
    draft --> pubConfirm
    swap --> pubConfirm
    pubConfirm -->|"확인"| published

    style console fill:#FFECBD,stroke:#FFC943
    style phaseConfirm fill:#FFE0C2,stroke:#FF9E42
    style pubConfirm fill:#FFE0C2,stroke:#FF9E42
    style delConfirm fill:#FFCDC2,stroke:#FF7556
```

- **PIN 은 하나뿐이다** (ADR-12). 회차별 PIN 은 없다 — 두 PIN 이 같을 때 회차 담당자가
  전체 권한을 얻는 사고가 거기서 나왔다
- 개인 링크는 **초대 명단 시트**에서 한 줄씩 복사한다 (ADR-32). 단톡방에 뿌리는 링크가 아니다
- 배정 버튼은 **하나뿐이다** (ADR-51). 못 붙은 쌍은 초안의 `💔` 를 보고 맞교환으로 옮긴다
- 자리 초안은 확인 없이 몇 번이든 다시 만든다. **발송에만** 확인이 붙는다 (ADR-6)
- 좌석 변경은 **맞교환 하나뿐**이다. 한 명만 옮기면 테이블 인원이 어긋난다

## 3 상호 영향

```mermaid
flowchart LR
    subgraph host ["운영자가 하는 것"]
        hPre["사전 투표 시작"]
        hParty["파티 진행 시작"]
        hSeat["자리 발송"]
        hReveal["결과 발표"]
        hConfig["콕 횟수 또는 대상 변경"]
        hDelete["참가자 삭제"]
    end

    subgraph guest ["참가자 화면에서 벌어지는 것"]
        gPoke["콕 열림 · 남은 횟수 지급"]
        gBudget["파티 예산 새로 · 이전 콕 유지"]
        gSeat["전체 화면 이동 확인"]
        gResult["홈에 요약 · 내 정보에 상세"]
        gLock["콕 즉시 잠김"]
        gRecalc["남은 횟수 그 자리에서 재계산"]
        gGone["목록 · 자리 · 집계에서 사라짐"]
    end

    subgraph back ["참가자가 하는 것"]
        pJoin["등록 완료"]
        pPoke["콕 찌르기"]
        pAck["자리 이동 확인"]
        pLate["지각 등록"]
    end

    subgraph cons ["운영자 콘솔에서 벌어지는 것"]
        cCount["인원 · 성비 갱신"]
        cNoPoke["아직 콕을 못 받은 사람"]
        cRank["콕 현황 · 사전 투표 1위"]
        cWeight["자리 배정 가중치"]
        cAck["자리 이동 확인율"]
        cUnassigned["미배정 인원으로 표시"]
    end

    hPre --> gPoke
    hParty --> gBudget
    hSeat --> gSeat
    hReveal --> gResult
    hReveal --> gLock
    hConfig --> gRecalc
    hDelete --> gGone

    pJoin --> cCount
    pJoin --> cNoPoke
    pPoke --> cRank
    pPoke --> cWeight
    pAck --> cAck
    pLate --> cUnassigned

    style host fill:#FFECBD,stroke:#FFC943
    style cons fill:#FFECBD,stroke:#FFC943
    style guest fill:#C2E5FF,stroke:#3DADFF
    style back fill:#C2E5FF,stroke:#3DADFF
    style gLock fill:#FFCDC2,stroke:#FF7556
```

참가자 화면은 실시간(WS)으로 **"다시 읽어라"** 신호만 받고 서버에서 한 벌을 다시 가져온다.
부분 갱신을 만들면 화면과 서버가 조용히 어긋난다.

## 4 회차 단계

```mermaid
stateDiagram-v2
    direction LR

    prep: 준비 중
    reg: 등록 중
    prevote: 사전 투표
    party: 파티 진행
    done: 발표 완료

    [*] --> reg: 회차 생성 (ADR-38)
    prep --> reg: 예약 알람 또는 수동 (옛 회차·되돌린 회차)
    reg --> prevote: 예약 알람 또는 수동 (prevoteAt)
    prevote --> party: 수동 — 운영자가 누른다 (ADR-14)
    party --> done: 예약 알람 또는 수동 (revealAt · 파티가 시작된 뒤에만 울린다)
    done --> [*]: 운영자가 회차를 지울 때까지 (ADR-36)
```

**예약은 한 번만 울리는 알람이다** (ADR-2). 실제 전환 시각을 `fired` 에 남기고, 알람은 `fired` 가
비어 있을 때만 울린다. 그래서 되돌리기를 해도 즉시 다시 앞으로 밀리지 않는다.
예약 값 자체는 지우지 않는다 — "예약은 21:00 이었는데 20:45 에 진행했다"를 보여줘야 하기 때문.

## 5 단계별로 양쪽이 무엇을 하나

```mermaid
flowchart TD
    subgraph p1 ["준비 중 — 되돌렸을 때만"]
        h1["단계를 되돌려 등록을 닫았다"]
        g1["링크를 열어도 언제 열리는지만 보인다"]
    end
    subgraph p2 ["등록 중 — 만들면 바로 (ADR-38)"]
        h2["인원과 성비를 본다 · 초대 명단에서 링크를 하나씩 보낸다"]
        g2["등록 3스텝을 마치면 홈 · 콕은 아직 잠김"]
    end
    subgraph p3 ["사전 투표"]
        h3["콕 현황과 1위를 본다 · 자리 배정 가능"]
        g3["매력 투표를 쓴다 · 마감까지 카운트다운"]
    end
    subgraph p4 ["파티 진행"]
        h4["자리 초안 · 맞교환 · 발송 · 확인율"]
        g4["파티 콕을 새로 받는다 · 자리 이동 확인"]
    end
    subgraph p5 ["발표 완료"]
        h5["자리를 더 바꾸지 않는다 · 되돌릴 수 없다 (ADR-50)"]
        g5["서로 찌른 상대만 공개 · 실명까지 · 콕 즉시 잠김"]
    end

    h2 -.->|"되돌리기"| h1
    h2 -->|"사전 투표 시작"| h3
    h3 -->|"파티 시작"| h4
    h4 -->|"결과 발표"| h5

    h1 -.->|"참가자에게는"| g1
    h2 -.->|"참가자에게는"| g2
    h3 -.->|"참가자에게는"| g3
    h4 -.->|"참가자에게는"| g4
    h5 -.->|"참가자에게는"| g5

    style p1 fill:#D9D9D9,stroke:#B3B3B3
    style p2 fill:#C2E5FF,stroke:#3DADFF
    style p3 fill:#FFC2EC,stroke:#F849C1
    style p4 fill:#FFECBD,stroke:#FFC943
    style p5 fill:#CDF4D3,stroke:#66D575
```

## 6 설정이 만드는 분기

```mermaid
flowchart LR
    create["회차 생성"]
    sReg["등록 중 — 만들면 바로 (ADR-38)"]
    qClosed{"사전 투표 마감이 이미 지났나"}
    warn["확인창에 시작하자마자 마감 경고"]
    sPre["사전 투표"]
    sParty["파티 진행"]
    autoDone["revealAt 알람으로 자동 발표 · 운영자가 먼저 눌러도 된다"]

    qSame{"콕 대상이 모두에게인가"}
    gAll["목록이 전체로 열림 · 동성도 찌를 수 있음"]
    gOpp["목록이 이성만으로 열림"]

    openSeat["자리 발송 · 다음 라운드 계속"]

    create --> sReg
    sReg --> qClosed
    qClosed -->|"지났음"| warn
    warn -->|"그래도 시작"| sParty
    qClosed -->|"안 지남"| sPre
    sPre -->|"마감은 판정일 뿐 (ADR-39) · 파티 시작은 운영자가 누른다"| sParty
    sParty --> autoDone

    create --> qSame
    qSame -->|"모두에게"| gAll
    qSame -->|"이성에게만"| gOpp

    sParty --> openSeat

    style warn fill:#FFCDC2,stroke:#FF7556
    style gAll fill:#DCCCFF,stroke:#874FFF
    style autoDone fill:#CDF4D3,stroke:#66D575
```

- **생성 위저드는 등록 시작을 묻지 않는다** (ADR-38) — 만드는 순간 열린다.
  **파티 시작은 1스텝(기본 정보)에 선다** (ADR-54) — 나머지 일정이 거기서 거꾸로 계산되는 기준점이라
  가장 먼저 정한다. 2스텝(예약)에 남은 셋은 매력 투표 시작 · 마감 · 커플 발표이고,
  **그 스텝에 있는 것은 전부 저절로 넘어간다** — 예외가 없으니 예외를 설명할 줄도 없다.
  다만 마감(`voteEndAt`)은 단계를 넘기지 않는 판정이다 (ADR-39)
- **참가자 카운트다운은 발표를 세지 않는다** (ADR-43). 시각은 있지만 파티 중에 보이면
  남은 시간을 재며 서두르게 된다 — 이 앱이 만들려는 자리가 아니다
- **배정은 발표 전까지 닫히지 않는다** (ADR-28). 라운드 횟수에도 제한이 없다 —
  못 붙은 쌍은 운영자가 자리 탭의 💔 를 보고 맞교환으로 붙인다 (ADR-51)
- 동성 콕을 열어도 **자리 배정의 남녀 정원은 그대로다.** 콕은 가중치로만 들어간다
