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
    start(["입장 화면"])
    code[/"입장 코드 6자리"/]
    joinInfo["회차 확인"]
    joinCheck{"이미 등록했나"}
    canReg{"등록할 수 있나"}
    closed["언제 열리는지 안내"]

    reg1["1 기본 정보"]
    reg2["2 연락처"]
    reg3["3 MBTI · 매력 3가지"]
    nickTaken{"닉네임 중복"}

    subgraph tabs ["참가자 화면 · 하단 탭 3개"]
        home["홈 : 할 일 · 내 자리 · 소식"]
        people["참가자 : 목록 · 이성만 또는 전체"]
        me["내 정보 : 프로필 · 결과"]
    end

    profile["프로필 시트"]
    pokeConfirm{"콕 확인창"}
    poked["콕 발송 · 되돌릴 수 없음"]
    seatAck["자리 이동 확인 전체화면"]
    result["매칭 상세 · 닉네임까지만"]

    hostSeat(("운영자가 자리 발송"))
    hostReveal(("운영자가 발표"))

    start --> code --> joinInfo --> joinCheck
    joinCheck -->|"세션 있음"| home
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

- 참가 링크(`/j/:code`)를 다시 열면 **이미 등록한 사람인지 먼저 본다.** 등록 화면이 또 나오면
  "내가 등록이 안 됐나" 하고 두 번 등록하려 든다
- 홈이 스택의 바닥이다. 어느 탭에 있든 뒤로 가기 한 번이면 홈 (`ROUTES.md`)
- 자리 이동 확인은 **발표가 끝났으면 띄우지 않는다**

## 2 운영자 플로우

```mermaid
flowchart LR
    entry(["입장 화면"])
    pin[/"운영자 PIN"/]
    scope{"어느 PIN 인가"}
    events["회차 목록"]
    defaults["회차 기본 설정"]

    w1["1 이름 · PIN · 코드"]
    w2["2 일정 · 30분 단위"]
    w3["3 콕 횟수"]

    subgraph console ["회차 콘솔 · 4탭"]
        dash["현황"]
        players["참가자"]
        seats["자리"]
        settings["설정"]
    end

    phaseConfirm{"단계 전환 확인창"}
    sheet["참가자 상세"]
    delConfirm{"삭제 확인창"}
    draft["자리 초안"]
    swap["같은 성별 맞교환"]
    pubConfirm{"발송 확인창"}
    published["참가자에게 자리 알림"]

    entry --> pin --> scope
    scope -->|"공통 PIN"| events
    scope -->|"회차 PIN"| dash
    events --> defaults
    events --> w1 --> w2 --> w3 --> dash

    dash --> phaseConfirm
    dash --> demo
    players --> sheet --> delConfirm
    seats --> draft --> swap
    draft --> pubConfirm
    swap --> pubConfirm
    pubConfirm -->|"확인"| published

    style console fill:#FFECBD,stroke:#FFC943
    style phaseConfirm fill:#FFE0C2,stroke:#FF9E42
    style pubConfirm fill:#FFE0C2,stroke:#FF9E42
    style delConfirm fill:#FFCDC2,stroke:#FF7556
```

- 회차 PIN 으로 들어오면 **그 회차 콘솔로 바로** 간다. 회차 목록·기본 설정·회차 생성은 공통 PIN 전용
- 자리 초안은 확인 없이 몇 번이든 다시 만든다. **발송에만** 확인이 붙는다 (ADR-6)
- 좌석 변경은 **맞교환 하나뿐**이다. 한 명만 옮기면 테이블 성비가 깨진다

## 3 상호 영향

```mermaid
flowchart LR
    subgraph host ["운영자가 하는 것"]
        hReg["참가자 등록 시작"]
        hPre["사전 투표 시작"]
        hParty["파티 진행 시작"]
        hSeat["자리 발송"]
        hReveal["결과 발표"]
        hUndo["발표 되돌리기"]
        hConfig["콕 횟수 또는 대상 변경"]
        hDelete["참가자 삭제"]
    end

    subgraph guest ["참가자 화면에서 벌어지는 것"]
        gOpen["입장 코드가 열린다"]
        gPoke["콕 열림 · 남은 횟수 지급"]
        gBudget["파티 예산 새로 · 이전 콕 유지"]
        gSeat["전체 화면 이동 확인"]
        gResult["홈에 요약 · 내 정보에 상세"]
        gLock["콕 즉시 잠김"]
        gHidden["경고 배너 · 결과 다시 숨김"]
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

    hReg --> gOpen
    hPre --> gPoke
    hParty --> gBudget
    hSeat --> gSeat
    hReveal --> gResult
    hReveal --> gLock
    hUndo --> gHidden
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
    style gHidden fill:#FFCDC2,stroke:#FF7556
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

    [*] --> prep
    [*] --> reg: 지금 바로로 생성
    prep --> reg: 예약 알람 또는 수동
    reg --> prevote: 수동
    prevote --> party: 예약 알람 또는 수동
    party --> done: 예약 알람 또는 수동
    done --> party: 발표 되돌리기
    done --> [*]: 발표 후 3일
```

**예약은 한 번만 울리는 알람이다** (ADR-2). 실제 전환 시각을 `fired` 에 남기고, 알람은 `fired` 가
비어 있을 때만 울린다. 그래서 되돌리기를 해도 즉시 다시 앞으로 밀리지 않는다.
예약 값 자체는 지우지 않는다 — "예약은 21:00 이었는데 20:45 에 진행했다"를 보여줘야 하기 때문.

## 5 단계별로 양쪽이 무엇을 하나

```mermaid
flowchart TD
    subgraph p1 ["준비 중"]
        h1["회차를 만들고 기다린다"]
        g1["코드를 넣어도 언제 열리는지만 보인다"]
    end
    subgraph p2 ["등록 중"]
        h2["인원과 성비를 본다 · 참가 링크를 뿌린다"]
        g2["등록 3스텝을 마치면 홈 · 콕은 아직 잠김"]
    end
    subgraph p3 ["사전 투표"]
        h3["콕 현황과 1위를 본다 · 자리 배정 가능"]
        g3["사전 콕을 쓴다 · 투표 마감까지 카운트다운"]
    end
    subgraph p4 ["파티 진행"]
        h4["자리 초안 · 맞교환 · 발송 · 확인율"]
        g4["파티 콕을 새로 받는다 · 자리 이동 확인"]
    end
    subgraph p5 ["발표 완료"]
        h5["자리를 더 바꾸지 않는다 · 되돌리기 가능"]
        g5["서로 찌른 상대만 공개 · 콕 즉시 잠김"]
    end

    h1 -->|"등록 시작"| h2
    h2 -->|"사전 투표 시작"| h3
    h3 -->|"파티 시작"| h4
    h4 -->|"결과 발표"| h5
    h5 -.->|"되돌리기"| h4

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
    qNow{"등록 시작이 지금 바로인가"}
    sPrep["준비 중 · 알람 대기"]
    sReg["등록 중"]
    qClosed{"사전 투표 마감이 이미 지났나"}
    warn["확인창에 시작하자마자 마감 경고"]
    sPre["사전 투표"]
    sParty["파티 진행"]
    qReveal{"발표 시각을 넣었나"}
    autoDone["예약 알람으로 자동 발표"]
    manualDone["수동 발표만"]
    gCount["참가자 상단에 발표까지 카운트다운"]
    gSoon["참가자 상단에 곧 발표해요"]

    qSame{"콕 대상이 모두에게인가"}
    gAll["목록이 전체로 열림 · 동성도 찌를 수 있음"]
    gOpp["목록이 이성만으로 열림"]

    qFinal{"마지막 자리로 발송했나"}
    closedSeat["배정 닫힘 · 다시 열기 필요"]
    openSeat["다음 라운드 계속"]

    create --> qNow
    qNow -->|"지금 바로"| sReg
    qNow -->|"시각 지정"| sPrep
    sPrep -->|"알람 한 번"| sReg
    sReg --> qClosed
    qClosed -->|"지났음"| warn
    warn -->|"그래도 시작"| sParty
    qClosed -->|"안 지남"| sPre
    sPre -->|"마감 알람"| sParty
    sParty --> qReveal
    qReveal -->|"있음"| autoDone
    qReveal -->|"없음"| manualDone
    autoDone --> gCount
    manualDone --> gSoon

    create --> qSame
    qSame -->|"모두에게"| gAll
    qSame -->|"이성에게만"| gOpp

    sParty --> qFinal
    qFinal -->|"마지막 자리"| closedSeat
    qFinal -->|"보통 발송"| openSeat

    style warn fill:#FFCDC2,stroke:#FF7556
    style closedSeat fill:#FFE0C2,stroke:#FF9E42
    style gAll fill:#DCCCFF,stroke:#874FFF
    style gCount fill:#C2E5FF,stroke:#3DADFF
```

- **발표 시각은 회차 설정에서만** 넣을 수 있다. 생성 위저드는 등록 시작·투표 마감 둘만 받는다
- 마지막 자리라는 사실은 **참가자에게 알리지 않는다.** 운영자에게만 배정이 닫힌다
- 동성 콕을 열어도 **자리 배정의 남녀 정원은 그대로다.** 콕은 가중치로만 들어간다
