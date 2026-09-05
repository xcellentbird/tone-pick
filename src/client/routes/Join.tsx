/**
 * 참가 링크가 여는 화면. **링크는 회차마다 하나이고, 열쇠는 전화번호 + PIN 번호다** (ADR-75).
 *
 * 링크에 신원이 없다. 그래서 이 화면은 어느 파티인지 한 번 보여주고 버튼 하나(`들어가기`)를
 * 둔다 — 누르면 입장 확인창(`/j/:id/enter`)이 뜨고, 거기서 번호를 받는다.
 *
 * **버튼 문구는 하나다.** 번호를 받기 전에는 첫 입장인지 재입장인지 모른다.
 *
 * **장소는 여기 없다.** 안내문으로만 알린다 — 지금 운영이 그렇다.
 *
 * ─────────────────────────────────────────────────────────────
 * **이 화면만 머리 띠가 없다.** 앱을 통틀어 로고가 서는 유일한 자리이고,
 * 참가자가 이 앱을 처음 만나는 화면이라 그렇다. `회차 확인` 이라는 제목은 걷어냈다 —
 * 로고가 어느 파티인지, 그 아래 회차 이름이 어느 회차인지 말한다.
 * 제목 줄은 그 둘 사이에서 아무것도 더하지 않았다.
 *
 * ⚠️ **로고에 회차 이름을 그려 넣지 마라.** 로고는 고정 자산이고 회차 이름은
 * 운영자가 친 글자다 — 회차마다 다르다. 이름은 늘 텍스트로 선다.
 *
 * ⚠️ **입력칸을 배너에 두지 마라.** 키보드가 뜨면 화면이 `100dvh - var(--kb)` 로 줄어
 *    로고가 잘린 채로 남는다. 실제로 그려서 확인했다. 칸은 전부 확인창 안이다.
 *
 * ─────────────────────────────────────────────────────────────
 * **링크를 열면 이 브라우저의 마지막 세션으로 들어간다** (ADR-75). `/` 와 같은 규칙이다 —
 * 링크에 신원이 없으니 쿠키가 유일한 단서다. 그 세션이 **이 회차의 참가자**면 배너를 거치지 않고
 * 자기 화면으로 간다.
 *
 *   탭에 이름표가 있다  → `/me` 를 기다렸다가 답에 따라 간다 (돌아온 사람일 확률이 높다)
 *   탭에 이름표가 없다  → 배너를 먼저 그리고, `/me` 를 뒤에서 묻는다. 200 이면 그때 넘어간다
 *
 * 이름표 없는 탭에서 돌아온 사람은 배너가 잠깐 보였다가 넘어간다. 받아들인 비용이다 —
 * 반대로 하면(답을 기다린 뒤 그리기) 처음 온 모든 사람의 첫 그림이 늦어진다 (ADR-70).
 *
 * ADR-44 가 막은 건 *남의 링크를 열었는데 내 세션으로 넘어가는 것* 이었다 —
 * 링크가 사람마다 다르지 않으면 그 사고 자체가 없다. **친구 폰으로 열면 친구 화면이 뜬다.**
 * 알고 고른 것이다 (ADR-75). `/` 도 지금 그렇다.
 */
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { BTN, ENTRY, PHASE_LABEL, REGISTER } from "../../shared/copy.ts";
import type { EnterProbe, EnterResult, ParticipantState, PublicEvent } from "../../shared/types.ts";
import { PHONE_SEED, PIN, formatPhone, typedPhone, validPin } from "../../shared/constants.ts";
import { formatWhen } from "../../shared/time.ts";
import { ApiError, api, post } from "../lib/api.ts";
import { takeBoot } from "../lib/boot.ts";
import { keepPhoneSeed } from "../lib/phoneField.ts";
import { setTabRef, tabRef } from "../lib/session.ts";
import { useLoad } from "../lib/useLoad.ts";
import Sheet from "../ui/Sheet.tsx";

/** 11자리가 찬 뒤 서버에 묻기까지. 고치는 중에 요청이 나가면 문구가 깜빡인다 */
const PROBE_DELAY_MS = 300;

export default function Join() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  /** 입장 확인창도 라우트다 — 뒤로 가기로 닫힌다 (ROUTES.md) */
  const atEnter = pathname.endsWith("/enter");
  /*
   * **`index.html` 이 번들보다 먼저 띄워둔 답을 먼저 본다** (`lib/boot.ts`).
   * 없으면(새로고침·되불러오기·다른 경로) 평소대로 서버에 묻는다.
   * 토큰이 없다 — 회차 정보는 아이디만으로 열린다. 회차가 있다는 사실은 링크로 이미 드러난다 (ADR-75).
   */
  const found = useLoad(() => {
    const path = `/events/by-id/${id}`;
    return takeBoot<PublicEvent>(path) ?? api<PublicEvent>(path);
  }, [id]);

  /*
   * **이 브라우저의 마지막 세션으로 들어간다** (위 머리말). 이름표가 있는 탭은 답을 기다렸다 그린다 —
   * 그 탭은 이 회차를 지나온 탭이라 돌아온 사람일 확률이 높고, 배너가 번쩍이면 되레 튄다.
   * 이름표는 **첫 렌더에 한 번만** 본다. 확인창이 심는 이름표에 이 판정이 다시 돌면 안 된다.
   */
  const [waitSession] = useState(() => !!tabRef());
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    let alive = true;
    api<ParticipantState>(`/me?event=${encodeURIComponent(id)}`)
      // 뒤로 가기로 배너에 되돌아오지 않게 replace 로 넘긴다 (`/` 와 같다)
      .then((me) => alive && navigate(`/e/${me.event.code}`, { replace: true }))
      // 401·404 — 이 브라우저에 이 회차의 세션이 없다. 배너 그대로, 문은 확인창이다
      .catch(() => alive && setChecked(true));
    return () => {
      alive = false;
    };
  }, [id, navigate]);

  // 회차를 아직 못 읽었거나, 세션을 기다리는 탭이다. 카드를 한 번 그리면 화면이 튄다
  if ((!found.data && !found.error) || (waitSession && !checked)) return <div className="screen join" />;

  return (
    <div className="screen join">
      {/*
        **`이전` 버튼을 두지 않는다.** 이 화면에 오는 길은 참가 링크 하나뿐이고,
        링크로 온 사람에게는 앱 안에 돌아갈 자리가 없다.
        브라우저 뒤로 가기로 링크를 받은 자리(카톡)로 돌아가는 게 맞는 동작이다.
      */}
      <div className="body joinBody">
        {/*
          로고는 **장식이다** — 바로 아래에 회차 이름이 글자로 서 있어서,
          낭독기가 `TONE PARTY` 를 한 번 더 읽으면 같은 말이 두 번 난다.
          크기를 박아 두는 건 그림이 늦게 와도 아래 것들이 안 튀게 하기 위해서다.
        */}
        {/*
          **`public/` 의 고정 주소다** — 번들을 거치면 해시가 붙어 `index.html` 이 그 이름을
          모르고, 그러면 첫 화면 스켈레톤이 로고를 띄울 수 없다. 로고는 거의 안 바뀌므로
          해시로 얻는 캐시 무효화보다 **먼저 보이는 것**이 값지다.
        */}
        <img className="joinLogo" src="/logo.webp" alt="" aria-hidden width={640} height={455} />

        {found.error && <p className="err danger joinErr">{found.error.userMessage ?? ENTRY.notFound}</p>}

        {found.data && (
          <>
            <div className={`joinMeta phase-${found.data.phase}`}>
              <div className="joinTitle">
                {/*
                  **단계는 남긴다.** 등록이 발표 전까지 열려 있어서, 파티가 이미 시작된 뒤
                  늦게 링크를 연 사람도 `들어가기` 만 보게 된다 — 이 줄이 없으면
                  파티가 진행 중인 걸 알 길이 없다.
                */}
                <p className="joinPhase">{PHASE_LABEL[found.data.phase]}</p>
                <h1 className="joinName">{found.data.name}</h1>
              </div>
              {/* 이름과 시각을 가르는 선. 글자가 아니라 자리 표시라 낭독기에서는 없다 */}
              <span className="joinRule" aria-hidden />
              {/*
                `파티` 라고 다시 쓰지 않는다 — 바로 위 로고가 이미 그 말을 하고 있다.
                시각 하나만 남기는 것이 이 줄이 답하는 질문(`그 파티가 맞나`)에 맞다.
              */}
              {found.data.partyAt && <p className="joinWhen">{formatWhen(found.data.partyAt)}</p>}
              {/* 등록이 닫혔을 때만 뜬다. 운영자가 쓴 글이 아니라 `ENTRY.*` 다 */}
              {found.data.message && <p className="joinNote pre">{found.data.message}</p>}
            </div>

            {!found.data.canRegister ? (
              <button className="btn ghost block joinGo" onClick={() => navigate("/")}>
                {BTN.home}
              </button>
            ) : (
              <>
                {/* 확인창은 push — 뒤로 가기가 곧 닫기다 */}
                <button className="btn primary block joinGo" onClick={() => navigate(`/j/${id}/enter`)}>
                  {ENTRY.start}
                </button>
                <EnterDialog open={atEnter && found.data.canRegister} eventId={id} room={found.data} />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * 확인창이 어디까지 왔나.
 *
 *   phone — 번호를 받는 중. 명단에 없거나 회차가 없으면 여기서 끝난다 (`error`)
 *   pin   — 등록한 번호다. PIN 번호 칸이 그 아래로 펼쳐진다. `mode` 가 칸 수를 정한다 —
 *           `required` 는 이미 정한 값을 대조하는 칸 하나, `set` 은 운영자가 초기화해서
 *           새로 정하는 칸 둘(정하기 · 재입력). `locked` 면 칸은 있되 잠긴다
 */
type Gate =
  | { step: "phone"; error?: string }
  | { step: "pin"; mode: "required" | "set"; locked: boolean; error?: string };

/**
 * 입장 확인창 (ADR-75). **가운데, 좁게** — 묻는 게 칸 둘뿐인 자리다.
 *
 * 걸음을 가르지 않는다. 번호가 계속 보여야 원인이 번호일 때 그 자리에서 고친다 —
 * 등록한 사람이면 PIN 번호 칸이 번호 **아래로** 펼쳐진다.
 *
 *   · 11자리가 차면 자동으로 묻는다 (300ms 늦춘다 — 고치는 중에 요청이 나가면 문구가 깜빡인다)
 *   · 4자리가 차면 자동으로 제출한다. 실패하면 **PIN 칸만 비우고 번호는 남긴다**
 *   · 남은 횟수는 서버 문구가 말한다 (`ENTRY.pinWrong`) — 2회 남았을 때부터다
 *   · 잠겨도 **번호 칸은 잠그지 않는다** — 남의 번호를 쳤을 수 있다
 *
 * **열릴 때 번호 칸에 커서를 준다** — ADR-63 의 예외 1호 (`Sheet` 의 `autoFocus`).
 * 칠 것밖에 없는 창이라 커서가 없으면 탭이 순수하게 하나 낭비된다.
 *
 * 번호 칸의 라벨은 `전화번호` 뿐이다. **약속 문장을 붙이지 않는다** — 이 창은 자물쇠이지
 * 수집 폼이 아니다. 번호는 운영자가 초대할 때 이미 가진 값이다.
 */
function EnterDialog({ open, eventId, room }: { open: boolean; eventId: string; room: PublicEvent }) {
  const navigate = useNavigate();
  /** 상태는 **숫자 그대로**다. 하이픈은 보여줄 때만 붙는다 (`formatPhone`) — 운영자 명단 칸과 같다 */
  const [phone, setPhone] = useState(PHONE_SEED);
  const [pin, setPin] = useState("");
  const [pinAgain, setPinAgain] = useState("");
  const [gate, setGate] = useState<Gate>({ step: "phone" });
  const [busy, setBusy] = useState(false);
  /** 늦게 온 답을 버리기 위한 순번. 번호를 고치는 사이 앞 요청이 돌아오면 그 답은 옛것이다 */
  const seq = useRef(0);

  /*
   * 확인창을 닫았다 다시 열면 **처음부터다.** 열려 있는 동안의 값은 남지만, 닫히면 번호도
   * PIN 번호도 비운다 — 뒤로 가기로 닫은 창에 남의 번호가 남아 있을 이유가 없다.
   */
  useEffect(() => {
    if (open) return;
    seq.current++;
    setPhone(PHONE_SEED);
    setPin("");
    setPinAgain("");
    setGate({ step: "phone" });
    setBusy(false);
  }, [open]);

  /*
   * **11자리가 차면 자동으로 묻는다.** 번호가 그 아래로 내려가면(고치는 중) 펼쳤던 칸을 접는다 —
   * PIN 번호 칸은 **그 번호의 것**이라 번호가 바뀌면 같이 사라져야 한다.
   */
  useEffect(() => {
    if (!open) return;
    const mine = ++seq.current;
    if (phone.length < 11) {
      setGate({ step: "phone" });
      setPin("");
      setPinAgain("");
      setBusy(false); // 날아가 있던 요청은 순번이 어긋나 버려진다 — 그 요청이 잡아둔 표시도 함께 푼다
      return;
    }
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const res = await post<EnterProbe>(`/events/${eventId}/enter`, { phone });
        if (mine !== seq.current) return;
        if (!res.registered) {
          /*
           * 아직 등록 전이다. 초대 쿠키가 심겼고 **이 탭의 이름표**를 받았다 (ADR-44) —
           * 다음 요청부터 이 이름표가 실려, 다른 탭이 다른 번호로 들어와도 서로를 덮지 않는다.
           * 확인창 칸을 등록 폼으로 갈아끼운다 — 뒤로 가면 배너다, 창이 아니다.
           * 방금 읽은 회차 정보를 함께 넘긴다 — 등록 화면이 같은 요청을 또 하지 않게 (최적화이지 계약이 아니다).
           */
          if (res.ref) setTabRef(res.ref);
          navigate(`/j/${eventId}/register/1`, { replace: true, state: { room } });
          return;
        }
        setGate({ step: "pin", mode: res.pin ?? "required", locked: false });
      } catch (err) {
        if (mine !== seq.current) return;
        setGate(gateAfter(err, { step: "phone" }));
      } finally {
        if (mine === seq.current) setBusy(false);
      }
    }, PROBE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [open, phone, eventId, navigate, room]);

  /** 번호 + PIN 번호로 문을 연다. 통과하면 참가자 쿠키가 심기고 자기 화면으로 간다 */
  async function submit(value: string) {
    const mine = ++seq.current;
    setBusy(true);
    try {
      const res = await post<EnterResult>(`/events/${eventId}/enter`, { phone, pin: value });
      if (mine !== seq.current) return;
      setTabRef(res.ref);
      // 확인창 칸을 자기 화면으로 갈아끼운다 — 뒤로 가면 배너이고, 배너는 세션을 보고 다시 들여보낸다
      navigate(`/e/${res.code}`, { replace: true });
    } catch (err) {
      if (mine !== seq.current) return;
      // 실패하면 **PIN 칸만 비운다.** 번호는 남는다 — 원인이 번호면 그 자리에서 고친다
      setPin("");
      setPinAgain("");
      setGate((g) => gateAfter(err, g));
      setBusy(false);
    }
  }

  /** PIN 번호 칸 하나 — 이미 정한 값을 대조한다. 4자리가 차면 곧바로 낸다 */
  function onPin(raw: string) {
    const v = digits(raw);
    setPin(v);
    if (gate.step !== "pin" || gate.locked || busy) return;
    if (gate.mode === "required" && v.length === PIN.length) void submit(v);
    else if (gate.mode === "set") pair(v, pinAgain);
  }

  /** 초기화된 사람의 재입력 칸. 둘이 다 찼을 때 같으면 낸다, 다르면 재입력만 비운다 */
  function onPinAgain(raw: string) {
    const v = digits(raw);
    setPinAgain(v);
    if (gate.step !== "pin" || gate.locked || busy) return;
    pair(pin, v);
  }

  function pair(a: string, b: string) {
    if (a.length < PIN.length || b.length < PIN.length) return;
    if (a !== b) {
      setPinAgain("");
      setGate((g) => (g.step === "pin" ? { ...g, error: REGISTER.pinMismatch } : g));
      return;
    }
    if (validPin(a)) void submit(a);
  }

  const locked = gate.step === "pin" && gate.locked;
  const pinLabel = gate.step === "pin" && gate.mode === "set" ? ENTRY.pinNew : ENTRY.pin;
  const pinHint = gate.step === "pin" && gate.mode === "set" ? ENTRY.pinNewHint : ENTRY.pinHint;

  return (
    <Sheet open={open} onClose={() => navigate(-1)} title={ENTRY.enterTitle} variant="dialog" tone="narrow" autoFocus>
      <div className="field">
        <label htmlFor="enterPhone">{ENTRY.phone}</label>
        <input
          id="enterPhone"
          value={formatPhone(phone)}
          /* 미리 든 `010` 이 통째로 선택된 채 오면 다음 숫자가 그걸 덮는다 */
          onFocus={keepPhoneSeed}
          inputMode="tel"
          autoComplete="tel"
          /* 자르는 곳은 `typedPhone` 한 곳이다 — `maxLength` 를 걸지 마라 (국가번호 붙여넣기) */
          onChange={(e) => setPhone(typedPhone(e.target.value))}
          {...(gate.step === "phone" && gate.error
            ? ({ "aria-invalid": true, "aria-describedby": "enterPhone-err" } as const)
            : {})}
        />
        {gate.step === "phone" && gate.error && (
          <span className="err" id="enterPhone-err" role="alert">
            {gate.error}
          </span>
        )}
      </div>

      {gate.step === "pin" && (
        <>
          <div className="field">
            <label htmlFor="enterPin">{pinLabel}</label>
            <input
              id="enterPin"
              className="pinInput"
              value={pin}
              inputMode="numeric"
              autoComplete="off"
              maxLength={PIN.length}
              disabled={locked}
              /* 번호를 다 친 손이 바로 이어서 친다 — 열릴 때가 아니라 펼쳐질 때라 ADR-63 의 자리가 아니다 */
              autoFocus={!locked}
              onChange={(e) => onPin(e.target.value)}
            />
            <span className="tiny dim">{pinHint}</span>
          </div>
          {gate.mode === "set" && (
            <div className="field">
              <label htmlFor="enterPinAgain">{ENTRY.pinAgain}</label>
              <input
                id="enterPinAgain"
                className="pinInput"
                value={pinAgain}
                inputMode="numeric"
                autoComplete="off"
                maxLength={PIN.length}
                disabled={locked}
                onChange={(e) => onPinAgain(e.target.value)}
              />
            </div>
          )}
          {gate.error && (
            <p className={locked ? "err danger" : "err"} role="alert">
              {gate.error}
            </p>
          )}
        </>
      )}
    </Sheet>
  );
}

/** PIN 번호 칸은 숫자만 받는다. 폰 키패드가 숫자여도 붙여넣기는 무엇이든 들어온다 */
const digits = (s: string) => s.replace(/[^0-9]/g, "").slice(0, PIN.length);

/**
 * 실패를 어느 칸의 말로 돌릴지. **세 가지 실패는 세 가지 문구다** (S-A8) —
 * 뭉개면 번호를 잘못 친 사람이 PIN 번호를 계속 다시 쳐서 잠금에 걸린다.
 *
 *   명단에 없음·회차 없음·시도 초과 → 번호 칸의 말. 펼쳤던 PIN 칸은 접는다
 *   PIN 번호 틀림                  → PIN 칸의 말 (남은 횟수는 서버가 문구에 담는다)
 *   잠김                           → PIN 칸이 잠긴다. 번호 칸은 산다
 */
function gateAfter(err: unknown, current: Gate): Gate {
  const e = err instanceof ApiError ? err : undefined;
  const text = e?.userMessage ?? ENTRY.notInvited;
  if (e?.code === "pin_locked") {
    return { step: "pin", mode: current.step === "pin" ? current.mode : "required", locked: true, error: ENTRY.pinLocked };
  }
  if (current.step === "pin" && (e?.code === "pin_wrong" || e?.code === "bad_request" || e?.code === "offline")) {
    return { ...current, error: text };
  }
  return { step: "phone", error: text };
}
