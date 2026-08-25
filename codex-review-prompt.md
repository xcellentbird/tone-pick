# Code review — tone-pick

You are reviewing changes to the tone-pick app
(Cloudflare Workers + Durable Objects backend, React SPA frontend).

Run `git diff HEAD` (or against the base branch for a PR) and review the changes.
Read surrounding files as needed for context.

The app lets solo-party guests anonymously "poke" each other; only mutual pokes are
revealed at a scheduled time. Its privacy and fairness rules are non-negotiable —
prioritize finding violations of them over style nits.

## Where the rules live

**Read `CLAUDE.md` first, then `docs/ADR.md` for anything that looks deliberate.**

⚠️ **Do not restate the rules in this file.** They used to be copied here and they
drifted: this prompt still claimed *"never real name, not even to a matched partner"*
after ADR-42 made a matched partner's real name the one thing that does go out, and it
still described a per-round PIN that ADR-12 removed. A second copy of a rule is a
second thing to keep true. `CLAUDE.md` is the only copy.

Load in this order:

| | |
|---|---|
| `CLAUDE.md` | the rules that are load-bearing right now — "이 앱이 지키는 것" and "절대 규칙" |
| `docs/ADR.md` | why a thing is the way it is. **Check here before calling something wrong** — most surprises are recorded decisions, often reversals of an earlier one |
| `docs/UI.md` · `docs/FLOWS.md` | screen requirements and cross-side effects |
| `CHANGELOG.md` | what shipped in the current major version |

## What to weigh most

1. **Anything that widens what reaches a participant.** `toPublic()` is the single place
   participant responses are built. Assume a participant opens the raw response in devtools.
2. **Anything that lets a one-way poke be inferred** — from a response, a count, a
   notification, a timestamp, a seating hint, or a screen that says more than the code does.
3. **Copy that promises more than the code delivers.** This has bitten twice
   (auto-deletion that never ran; "contacts open at reveal" when they never do).
   A sentence is as load-bearing as a type here.
4. **Server-time judgments.** A deadline decided with client `Date.now()` is a bug.
5. **Design boundaries** listed under "설계 경계" in `CLAUDE.md`.

## Output

For each finding: `file:line`, which rule or boundary it breaks, why it is exploitable or
wrong, and a concrete fix. Rank by severity. If a rule is upheld well, say so briefly.
Do not rewrite the code — report findings only.
