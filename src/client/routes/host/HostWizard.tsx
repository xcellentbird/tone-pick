/**
 * 새 회차 만들기 3스텝.
 *
 * **파티 일시가 먼저다.** 매력 투표 시작이 거기서 거꾸로 계산된다 —
 * 운영자가 실제로 아는 건 "언제 모이나" 하나뿐이고, 나머지는 그것에 딸린 값이다.
 * 파티 일시를 옮기면 아직 손대지 않은 값이 따라 움직인다. 직접 고친 값은 그대로 둔다.
 *
 * **등록 시작은 묻지 않는다** (ADR-36). 회차를 만드는 순간 열린다 —
 * 명단에 없는 사람은 어차피 못 들어오므로(ADR-32) 문을 늦게 열어 지킬 것이 없었다.
 * 그래서 예약이 걸리는 전환은 **매력 투표 시작 하나뿐**이다.
 * 매력 투표 마감·파티 시작·발표는 현장에서 운영자가 누른다 (ADR-14).
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
import { NOTIFY_OPTIONS, Num, Toggle, UNDO_OPTIONS } from "./HostDefaults.tsx";

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
  /** 늘 같은 곳에서 여는 모임이면 기본값이 채워 온다 (ADR-36). 회차마다 고칠 수 있다 */
  const [place, setPlace] = useState("");
  // 기본은 '되돌릴 수 있다' 와 '알리지 않는다' 다 (ADR-34)
  const [allowUndo, setAllowUndo] = useState(true);
  const [allowUndoPre, setAllowUndoPre] = useState(true);
  const [pokeNotify, setPokeNotify] = useState(false);
  const [partyAt, setPartyAt] = useState<number>(() => defaultPartyAt(Date.now()));
  const [prevoteAt, setPrevoteAt] = useState<number>(() => defaultPartyAt(Date.now()) - DEFAULTS.prevoteBeforeH * HOUR);
  /** 매력 투표 마감 (ADR-37). 이 뒤로 파티 시작까지가 운영자가 첫 자리를 짜는 시간이다 */
  const [voteEndAt, setVoteEndAt] = useState<number>(() => defaultPartyAt(Date.now()) - DEFAULTS.voteEndBeforeH * HOUR);
  // 직접 고친 값은 파티 일시를 옮겨도 따라가지 않는다. 고쳐놓은 걸 되돌리는 건 사고다
  const [touched, setTouched] = useState<{ prevote?: boolean; voteEnd?: boolean }>({});
  const [maxPre, setMaxPre] = useState(DEFAULTS.maxPre);
  const [maxParty, setMaxParty] = useState(DEFAULTS.maxParty);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = defaults.data;
    if (!d) return;
    setMaxPre(d.maxPre);
    setMaxParty(d.maxParty);
    // 장소는 **비어 있을 때만** 채운다. 운영자가 이미 적었으면 기본값이 덮지 않는다
    setPlace((prev) => prev || d.place);
    setPrevoteAt((prev) => (touched.prevote ? prev : partyAt - d.prevoteBeforeH * HOUR));
    setVoteEndAt((prev) => (touched.voteEnd ? prev : partyAt - d.voteEndBeforeH * HOUR));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaults.data]);

  function changeParty(value: string) {
    const raw = fromLocalInput(value);
    if (!raw) return;
    const ts = snapSchedule(raw);
    setPartyAt(ts);
    const d = defaults.data ?? DEFAULTS;
    if (!touched.prevote) setPrevoteAt(ts - d.prevoteBeforeH * HOUR);
    if (!touched.voteEnd) setVoteEndAt(ts - d.voteEndBeforeH * HOUR);
  }

  function changeWhen(key: "prevote" | "voteEnd", value: string) {
    const raw = fromLocalInput(value);
    if (!raw) return;
    // 직접 타이핑하면 브라우저가 step 을 강제하지 않는다. 받은 값을 여기서 맞춘다
    const ts = snapSchedule(raw);
    setTouched({ ...touched, [key]: true });
    if (key === "prevote") setPrevoteAt(ts);
    else setVoteEndAt(ts);
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
        config: { maxPre, maxParty, allowUndo, allowUndoPre, pokeNotify },
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
          <div className="sub">{at}/3</div>
        </div>
      </header>

      <div className="body stack">
        {/*
          **회차 코드는 묻지 않는다.** 서버가 겹치지 않는 것으로 붙인다 (`freeCode`).
          참가자가 코드를 입력하는 화면이 없어진 뒤로 (ADR-15) 이 칸이 답하는 질문이 없어졌다 —
          운영자가 링크를 돌리고, 문은 초대 명단의 전화번호가 연다.
          코드는 만들어진 뒤 회차 목록과 콘솔 머리에서 볼 수 있다.
        */}
        {at === 1 && (
          <div className="field">
            <label htmlFor="ename">{HOST_UI.fields.name}</label>
            <input id="ename" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        )}

        {at === 2 && (
          <>
            <div className="field">
              <label htmlFor="party">{HOST_UI.fields.partyAt}</label>
              <input
                id="party"
                type="datetime-local"
                step={SCHEDULE_STEP_MIN * 60}
                value={toLocalInput(partyAt)}
                onChange={(e) => changeParty(e.target.value)}
              />
            </div>

            {/* "언제·어디서" 는 한 화면에 있다 (ADR-32). 장소는 안내문에만 쓰인다 */}
            <div className="field">
              <label htmlFor="place">{HOST_UI.fields.place}</label>
              <input id="place" value={place} onChange={(e) => setPlace(e.target.value)} />
              <span className="tiny dim">{HOST_UI.fields.placeHint}</span>
            </div>

            {/* 등록 시작은 묻지 않는다 (ADR-36) — 만들면 곧바로 열린다. 그 사실만 한 줄로 알린다 */}
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
              매력 투표 마감 (ADR-37). **이 시각과 파티 일시 사이가 자리를 짜는 시간이다** —
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
            <p className="tiny dim">{HOST_UI.fields.manualNote}</p>
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

            {/* 되돌리기·알림 (ADR-34). 라운드마다 따로 정한다 */}
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
