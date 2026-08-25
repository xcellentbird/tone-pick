/**
 * 새 회차 만들기 3스텝.
 *
 * **파티 일시가 먼저다.** 매력 투표 시작이 거기서 거꾸로 계산된다 —
 * 운영자가 실제로 아는 건 "언제 모이나" 하나뿐이고, 나머지는 그것에 딸린 값이다.
 * 파티 일시를 옮기면 아직 손대지 않은 값이 따라 움직인다. 직접 고친 값은 그대로 둔다.
 *
 * **등록 시작은 묻지 않는다** (ADR-38). 회차를 만드는 순간 열린다 —
 * 명단에 없는 사람은 어차피 못 들어오므로(ADR-32) 문을 늦게 열어 지킬 것이 없었다.
 * 그래서 예약이 걸리는 전환은 **매력 투표 시작과 커플 발표 둘**이다 (ADR-43).
 * **파티 시작은 운영자가 누른다** (ADR-14) — 사람이 다 모였는지는 시계가 모른다.
 * 매력 투표 마감(`voteEndAt`)은 전환이 아니라 판정이라 알람이 울리지 않는다 (ADR-39).
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { BTN, HOST_UI, SCREEN_TITLE, pokeEstimateLabel } from "../../../shared/copy.ts";
import type { CreateEventInput, Defaults, EventMeta } from "../../../shared/types.ts";
import { DEFAULTS, LIMITS, pokeEstimate } from "../../../shared/constants.ts";
import { SCHEDULE_STEP_MIN, fromLocalInput, snapSchedule, toLocalInput } from "../../../shared/time.ts";
import { ApiError, api, post } from "../../lib/api.ts";
import { useLoad } from "../../lib/useLoad.ts";
import { useAuthRedirect } from "../../lib/guard.ts";
import { NOTIFY_OPTIONS, Num, TARGET_OPTIONS, Toggle, UNDO_OPTIONS } from "./HostDefaults.tsx";

const HOUR = 3600_000;

/** 다음 금요일 저녁 8시 — 손대지 않고 넘어가도 말이 되는 값 */
function defaultPartyAt(from: number): number {
  const d = new Date(from);
  d.setHours(20, 0, 0, 0);
  d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7));
  return d.getTime();
}

export default function HostWizard() {
  const { step = "1" } = useParams();
  const navigate = useNavigate();
  const defaults = useLoad(() => api<Defaults>("/host/defaults"));
  useAuthRedirect(defaults.error);

  const at = Math.min(3, Math.max(1, Number(step) || 1));
  // 멱등키는 위저드 한 번에 하나. 두 번 눌러도 회차는 하나만 생긴다
  const requestId = useMemo(() => `w-${Date.now()}-${Math.random().toString(36).slice(2)}`, []);

  const [name, setName] = useState("");
  /** 늘 같은 곳에서 여는 모임이면 기본값이 채워 온다 (ADR-38). 회차마다 고칠 수 있다 */
  const [place, setPlace] = useState("");
  /**
   * 콕을 찌를 수 있는 대상. **기본은 '모두에게'** 다 —
   * 누구에게 마음이 가는지는 앱이 정할 일이 아니다 (ADR-17).
   * 좁히고 싶은 회차에서만 '이성에게만' 으로 바꾼다.
   */
  const [allowSameGender, setAllowSameGender] = useState(true);
  // 기본은 '되돌릴 수 있다' 와 '알리지 않는다' 다 (ADR-34)
  const [allowUndo, setAllowUndo] = useState(true);
  const [allowUndoPre, setAllowUndoPre] = useState(true);
  const [preNotify, setPreNotify] = useState(false);
  const [pokeNotify, setPokeNotify] = useState(false);
  const [partyAt, setPartyAt] = useState<number>(() => defaultPartyAt(Date.now()));
  const [prevoteAt, setPrevoteAt] = useState<number>(() => defaultPartyAt(Date.now()) - DEFAULTS.prevoteBeforeH * HOUR);
  /** 매력 투표 마감 (ADR-39). 이 뒤로 파티 시작까지가 운영자가 첫 자리를 짜는 시간이다 */
  const [voteEndAt, setVoteEndAt] = useState<number>(() => defaultPartyAt(Date.now()) - DEFAULTS.voteEndBeforeH * HOUR);
  /** 커플 발표 (ADR-43). **더하기다** — 파티 뒤를 재는 유일한 값이라 부호가 반대다 */
  const [revealAt, setRevealAt] = useState<number>(() => defaultPartyAt(Date.now()) + DEFAULTS.revealAfterH * HOUR);
  // 직접 고친 값은 파티 일시를 옮겨도 따라가지 않는다. 고쳐놓은 걸 되돌리는 건 사고다
  const [touched, setTouched] = useState<{ prevote?: boolean; voteEnd?: boolean; reveal?: boolean }>({});
  const [maxPre, setMaxPre] = useState(DEFAULTS.maxPre);
  const [maxParty, setMaxParty] = useState(DEFAULTS.maxParty);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    /*
     * **빠진 칸은 코드의 기본값으로 메운다.** 서버가 `withDefaults` 로 채워 보내지만,
     * 새 칸이 붙은 직후에는 그렇지 않은 응답이 올 수 있다 — 그때 `undefined * HOUR` 가
     * `NaN` 이 되고, 시각 칸이 **빈 채로** 뜬다. 빈 칸은 만들기 버튼에서야 막힌다.
     */
    const d = defaults.data && { ...DEFAULTS, ...defaults.data };
    if (!d) return;
    setMaxPre(d.maxPre);
    setMaxParty(d.maxParty);
    // 장소는 **비어 있을 때만** 채운다. 운영자가 이미 적었으면 기본값이 덮지 않는다
    setPlace((prev) => prev || d.place);
    setPrevoteAt((prev) => (touched.prevote ? prev : partyAt - d.prevoteBeforeH * HOUR));
    setVoteEndAt((prev) => (touched.voteEnd ? prev : partyAt - d.voteEndBeforeH * HOUR));
    setRevealAt((prev) => (touched.reveal ? prev : partyAt + d.revealAfterH * HOUR));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaults.data]);

  function changeParty(value: string) {
    const raw = fromLocalInput(value);
    if (!raw) return;
    const ts = snapSchedule(raw);
    setPartyAt(ts);
    const d = { ...DEFAULTS, ...defaults.data };
    if (!touched.prevote) setPrevoteAt(ts - d.prevoteBeforeH * HOUR);
    if (!touched.voteEnd) setVoteEndAt(ts - d.voteEndBeforeH * HOUR);
    if (!touched.reveal) setRevealAt(ts + d.revealAfterH * HOUR);
  }

  function changeWhen(key: "prevote" | "voteEnd" | "reveal", value: string) {
    const raw = fromLocalInput(value);
    if (!raw) return;
    // 직접 타이핑하면 브라우저가 step 을 강제하지 않는다. 받은 값을 여기서 맞춘다
    const ts = snapSchedule(raw);
    setTouched({ ...touched, [key]: true });
    if (key === "prevote") setPrevoteAt(ts);
    else if (key === "voteEnd") setVoteEndAt(ts);
    else setRevealAt(ts);
  }

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      const body: CreateEventInput = {
        name: name.trim(),
        place: place.trim(),
        partyAt,
        prevoteAt,
        voteEndAt,
        revealAt,
        config: { maxPre, maxParty, allowSameGender, allowUndo, allowUndoPre, preNotify, pokeNotify },
        requestId,
      };
      const made = await post<EventMeta>("/host/events", body);
      navigate(`/host/${made.id}`, { replace: true });
    } catch (e) {
      setBusy(false);
      setError(e instanceof ApiError ? (e.userMessage ?? "") : "");
    }
  }

  const estimate = pokeEstimate(8, 8, maxPre);
  const label = pokeEstimateLabel(estimate.pct);

  return (
    <div className="screen">
      <header>
        <button className="btn ghost" onClick={() => (at === 1 ? navigate("/host/events") : navigate(-1))}>
          {BTN.back}
        </button>
        <div className="grow">
          <h1>{SCREEN_TITLE.hostWizard}</h1>
          {/* 숫자만 있으면 몇 장 남았는지는 알아도 **지금 무엇을 정하는 중인지**는 모른다 */}
          <div className="sub">{at}/3 · {HOST_UI.steps[at - 1]}</div>
        </div>
      </header>

      <div className="body stack">
        {/*
          **회차 코드는 묻지 않는다.** 서버가 겹치지 않는 것으로 붙인다 (`freeCode`).
          참가자가 코드를 입력하는 화면이 없어진 뒤로 (ADR-15) 이 칸이 답하는 질문이 없어졌다 —
          운영자가 링크를 돌리고, 문은 그 링크의 토큰이 연다 (ADR-32).
          코드는 만들어진 뒤 회차 목록과 콘솔 머리에서 볼 수 있다.
        */}
        {/*
          **1스텝은 기본 정보다** — 이 회차가 무엇이고 어디서 열리는지.
          장소는 2스텝(일시)에 있었는데, 그 스텝이 **예약**만 다루게 되면서 여기로 왔다.
          시각이 아닌 유일한 칸이 시각 넷 사이에 끼어 있으면 그 목록이 시간 순으로 안 읽힌다.
        */}
        {at === 1 && (
          <>
            <div className="field">
              <label htmlFor="ename">{HOST_UI.fields.name}</label>
              <input id="ename" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            {/* 장소는 안내문에만 쓰인다 (ADR-32) — 참가자 화면에는 안 나간다 */}
            <div className="field">
              <label htmlFor="place">{HOST_UI.fields.place}</label>
              <input id="place" value={place} onChange={(e) => setPlace(e.target.value)} />
              <span className="tiny dim">{HOST_UI.fields.placeHint}</span>
            </div>
          </>
        )}

        {/*
          **2스텝은 예약이다.** 네 시각을 **시간 순으로** 늘어놓는다 —
          매력 투표 시작 → 마감 → 파티 시작 → 커플 발표.
          그래야 읽는 사람이 어느 것이 먼저인지 다시 계산하지 않는다.

          ⚠️ **넷 중 파티 시작만 예약이 아니다** (ADR-14). 운영자가 현황 탭에서 누른다.
          그 사실은 목록 아래가 아니라 **그 칸에** 붙는다(`partyHint`) — 아래에 떠 있으면
          어느 칸 이야기인지 알 수 없고, 넷 다 저절로 넘어가는 줄로 읽으면 파티가 영영 안 열린다.

          **`partyAt` 은 여전히 기준점이다.** 셋째 자리에 있어도 이걸 옮기면 손대지 않은 칸이
          따라 움직인다 (`changeParty`). 화면 순서와 계산 순서는 다른 이야기다.
        */}
        {at === 2 && (
          <>
            {/* 등록 시작은 묻지 않는다 (ADR-38) — 만들면 곧바로 열린다. 그 사실만 한 줄로 알린다 */}
            <div className="field">
              <label htmlFor="prevote">{HOST_UI.fields.prevoteAt}</label>
              <input
                id="prevote"
                type="datetime-local"
                step={SCHEDULE_STEP_MIN * 60}
                value={toLocalInput(prevoteAt)}
                onChange={(e) => changeWhen("prevote", e.target.value)}
              />
            </div>
            {/*
              매력 투표 마감 (ADR-39). **이 시각과 파티 시작 사이가 자리를 짜는 시간이다** —
              그래서 힌트가 몇 시인지가 아니라 그 사이에 무엇을 하는지를 말한다.
            */}
            <div className="field">
              <label htmlFor="voteEnd">{HOST_UI.fields.voteEndAt}</label>
              <input
                id="voteEnd"
                type="datetime-local"
                step={SCHEDULE_STEP_MIN * 60}
                value={toLocalInput(voteEndAt)}
                onChange={(e) => changeWhen("voteEnd", e.target.value)}
              />
              <span className="tiny dim">{HOST_UI.fields.voteEndHint}</span>
            </div>
            <div className="field">
              <label htmlFor="party">{HOST_UI.fields.partyAt}</label>
              <input
                id="party"
                type="datetime-local"
                step={SCHEDULE_STEP_MIN * 60}
                value={toLocalInput(partyAt)}
                onChange={(e) => changeParty(e.target.value)}
              />
              <span className="tiny dim">{HOST_UI.fields.partyHint}</span>
            </div>
            {/*
              커플 발표 (ADR-43). 힌트는 `파티를 시작해야 울린다` 를 말한다 —
              그걸 모르면 이 시각만 믿고 `파티 시작` 을 안 눌러서,
              발표도 콕도 안 열린 채 시각만 지나간다.
            */}
            <div className="field">
              <label htmlFor="reveal">{HOST_UI.fields.revealAt}</label>
              <input
                id="reveal"
                type="datetime-local"
                step={SCHEDULE_STEP_MIN * 60}
                value={toLocalInput(revealAt)}
                onChange={(e) => changeWhen("reveal", e.target.value)}
              />
              <span className="tiny dim">{HOST_UI.fields.revealHint}</span>
            </div>
            <p className="tiny dim">{HOST_UI.regOpensNow}</p>
          </>
        )}

        {at === 3 && (
          <>
            <Num
              label={HOST_UI.fields.maxPre}
              value={maxPre}
              min={LIMITS.maxPre.min}
              max={LIMITS.maxPre.max}
              onChange={setMaxPre}
            />
            <Num
              label={HOST_UI.fields.maxParty}
              value={maxParty}
              min={LIMITS.maxParty.min}
              max={LIMITS.maxParty.max}
              onChange={setMaxParty}
            />
            {/* 기대 상호 매칭 쌍 수는 파티 규모와 무관하게 k² 에 수렴한다 — 고르는 자리에서 보여준다 */}
            <p className={`small ${label.tone === "good" ? "okText" : "warnText"}`}>{label.label}</p>

            {/*
              대상·되돌리기 둘·알림 둘. **다섯은 콕이 오가기 시작하면 함께 굳는다** (ADR-35) —
              여기서 고르지 않으면 나중에 못 고친다. 그래서 설정 탭과 **같은 순서**로 둔다:
              대상 → 되돌리기(매력 투표·콕) → 알림(매력 투표·콕).
              두 화면의 순서가 다르면 운영자가 매번 다시 찾는다.
            */}
            <Toggle
              label={HOST_UI.fields.pokeTarget}
              value={allowSameGender}
              options={TARGET_OPTIONS}
              note={HOST_UI.fields.pokeTargetNote}
              onChange={setAllowSameGender}
            />
            <Toggle
              label={HOST_UI.fields.undoPre}
              value={allowUndoPre}
              options={UNDO_OPTIONS}
              onChange={setAllowUndoPre}
            />
            <Toggle
              label={HOST_UI.fields.undoParty}
              value={allowUndo}
              options={UNDO_OPTIONS}
              onChange={setAllowUndo}
            />
            <Toggle
              label={HOST_UI.fields.preNotify}
              value={preNotify}
              options={NOTIFY_OPTIONS}
              note={HOST_UI.fields.preNotifyNote}
              onChange={setPreNotify}
            />
            <Toggle
              label={HOST_UI.fields.pokeNotify}
              value={pokeNotify}
              options={NOTIFY_OPTIONS}
              note={HOST_UI.fields.pokeNotifyNote}
              onChange={setPokeNotify}
            />
          </>
        )}

        {error && <p className="err danger">{error}</p>}
      </div>

      <div className="row" style={{ padding: "0 16px 16px" }}>
        <button
          className="btn wide primary"
          disabled={busy || (at === 1 && !name.trim())}
          onClick={() => (at < 3 ? navigate(`/host/new/${at + 1}`) : finish())}
        >
          {at < 3 ? BTN.next : HOST_UI.newEvent}
        </button>
      </div>
    </div>
  );
}
