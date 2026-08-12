/**
 * 새 회차 만들기 3스텝.
 *
 * '지금 바로'는 시각이 아니라 **토글**이다 — `datetime-local` 이 초를 버려서
 * "지금"을 시각으로 넣으면 매번 몇 초씩 어긋난다. 서버에는 리터럴 "now" 로 보낸다.
 *
 * 토글 규칙 (UI.md)
 *   켤 때  → 기존 시각을 보관하고 now 로 바꾼다
 *   끌 때  → 보관한 시각이 미래면 그대로 복원, 아니면 +1시간
 *   공통   → 마감이 등록 시작보다 앞이면 기본 기간만큼 밀어준다
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { BTN, HOST_UI, SCREEN_TITLE, pokeEstimateLabel } from "../../../shared/copy.ts";
import type { CreateEventInput, Defaults, EventMeta } from "../../../shared/types.ts";
import { LIMITS, pokeEstimate } from "../../../shared/constants.ts";
import { fromLocalInput, toLocalInput } from "../../../shared/time.ts";
import { ApiError, api, post } from "../../lib/api.ts";
import { useLoad } from "../../lib/useLoad.ts";
import { useAuthRedirect } from "../../lib/guard.ts";
import { Num } from "./HostDefaults.tsx";

const HOUR = 3600_000;

export default function HostWizard() {
  const { step = "1" } = useParams();
  const navigate = useNavigate();
  const defaults = useLoad(() => api<Defaults>("/host/defaults"));
  useAuthRedirect(defaults.error);

  const at = Math.min(3, Math.max(1, Number(step) || 1));
  // 멱등키는 위저드 한 번에 하나. 두 번 눌러도 회차는 하나만 생긴다
  const requestId = useMemo(() => `w-${Date.now()}-${Math.random().toString(36).slice(2)}`, []);

  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [code, setCode] = useState("");
  const [openNow, setOpenNow] = useState(false);
  const [regOpenAt, setRegOpenAt] = useState<number>(Date.now() + HOUR);
  const [keptRegOpenAt, setKept] = useState<number>(Date.now() + HOUR);
  const [voteCloseAt, setVoteCloseAt] = useState<number>(Date.now() + 25 * HOUR);
  const [maxPre, setMaxPre] = useState(3);
  const [maxParty, setMaxParty] = useState(3);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = defaults.data;
    if (!d) return;
    setMaxPre(d.maxPre);
    setMaxParty(d.maxParty);
    const open = Date.now() + d.regOpenAfterH * HOUR;
    setRegOpenAt(open);
    setKept(open);
    setVoteCloseAt(open + d.voteWindowH * HOUR);
    // 기본값이 0시간이면 위저드가 '지금 바로'로 열린다
    setOpenNow(d.regOpenAfterH === 0);
  }, [defaults.data]);

  function toggleNow(next: boolean) {
    if (next) {
      setKept(regOpenAt);
      setRegOpenAt(Date.now());
    } else {
      const restored = keptRegOpenAt > Date.now() ? keptRegOpenAt : Date.now() + HOUR;
      setRegOpenAt(restored);
      if (voteCloseAt <= restored) {
        setVoteCloseAt(restored + (defaults.data?.voteWindowH ?? 24) * HOUR);
      }
    }
    setOpenNow(next);
  }

  function changeRegOpen(value: string) {
    const ts = fromLocalInput(value);
    if (!ts) return;
    setRegOpenAt(ts);
    setKept(ts);
    if (voteCloseAt <= ts) setVoteCloseAt(ts + (defaults.data?.voteWindowH ?? 24) * HOUR);
  }

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      const body: CreateEventInput = {
        name: name.trim(),
        pin,
        code: code.trim() ? code.trim().toUpperCase() : undefined,
        regOpenAt: openNow ? "now" : regOpenAt,
        voteCloseAt,
        config: { maxPre, maxParty },
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
        {at === 1 && (
          <>
            <div className="field">
              <label htmlFor="ename">{HOST_UI.fields.name}</label>
              <input id="ename" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="epin">{HOST_UI.fields.pin}</label>
              <input
                id="epin"
                value={pin}
                inputMode="numeric"
                maxLength={8}
                onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ""))}
              />
            </div>
            <div className="field">
              <label htmlFor="ecode">{HOST_UI.fields.code}</label>
              <input
                id="ecode"
                value={code}
                maxLength={6}
                autoCapitalize="characters"
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
              <span className="tiny dim">{HOST_UI.fields.codeAuto}</span>
            </div>
          </>
        )}

        {at === 2 && (
          <>
            <div className="field">
              <label>{HOST_UI.fields.regOpenAt}</label>
              <div className="choice">
                <button type="button" aria-pressed={openNow} onClick={() => toggleNow(true)}>
                  {HOST_UI.nowToggle}
                </button>
                <button type="button" aria-pressed={!openNow} onClick={() => toggleNow(false)}>
                  {HOST_UI.pickTime}
                </button>
              </div>
              {!openNow && (
                <input
                  type="datetime-local"
                  value={toLocalInput(regOpenAt)}
                  onChange={(e) => changeRegOpen(e.target.value)}
                />
              )}
            </div>
            <div className="field">
              <label htmlFor="close">{HOST_UI.fields.voteCloseAt}</label>
              <input
                id="close"
                type="datetime-local"
                value={toLocalInput(voteCloseAt)}
                onChange={(e) => setVoteCloseAt(fromLocalInput(e.target.value) ?? voteCloseAt)}
              />
            </div>
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
          </>
        )}

        {error && <p className="err danger">{error}</p>}
      </div>

      <div className="row" style={{ padding: "0 16px 16px" }}>
        <button
          className="btn wide primary"
          disabled={busy || (at === 1 && (!name.trim() || pin.length < 4))}
          onClick={() => (at < 3 ? navigate(`/host/new/${at + 1}`) : finish())}
        >
          {at < 3 ? BTN.next : HOST_UI.newEvent}
        </button>
      </div>
    </div>
  );
}
