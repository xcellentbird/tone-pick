# Code review — tone-pick

You are reviewing the uncommitted changes on branch `main` of the tone-pick app
(Cloudflare Workers + Durable Objects backend, React SPA frontend).

Run `git diff HEAD` and review the changes. Read surrounding files as needed for context.

The app lets solo-party guests anonymously "poke" each other; only mutual pokes are
revealed at a scheduled time. The privacy and fairness rules below are non-negotiable —
prioritize finding violations of them over style nits.

## Absolute rules to verify (from CLAUDE.md)

1. **No PII in participant responses.** Only `PublicPlayer` from `toPublic()` reaches
   participants — never real name, phone, or Instagram, not even to a matched partner.
   Before reveal, the poke sender (`fromId`) must also be absent from responses. Assume a
   participant will open the raw response in devtools.
2. **Round PIN is checked before master PIN.** Checking master first lets a round operator
   gain full rights when the two PINs are equal (a real past incident:
   `roundPIN=0000, commonPIN=0000 → granted master, all-round access true`). Also, every
   place that *creates* PINs must prevent the two values from being equal.
3. **Phase transitions use server time.** Never judge a deadline with client `Date.now()` —
   a guest could change their phone clock to see results early. Responses carry
   `x-server-time`; client only corrects for offset.
4. **Confirmation dialogs show what changes, with numbers.** No bare "Are you sure?".
   Reversible actions get no confirmation at all.
5. **Modals/sheets are routes** (closeable with back). Confirm dialogs must `navigate(-1)`
   *before* executing, or the handled dialog reappears when going back after execution.

## Design boundaries
- Only `EventDO` mutates state; the Worker only does auth/routing.
- `toPublic()` is the single place participant responses are built.
- `buildSeating` is a pure function — no DO/request/current-time access.
- Seat changes are only `swap(a, b)`; there must be no single-move API (breaks gender-ratio quota).
- Participant notifications go only through the DO's `broadcast()`.

## Output
For each finding: file:line, which rule/boundary it breaks, why it's exploitable or wrong,
and a concrete fix. Rank by severity. If a rule is upheld well, say so briefly. Do not
rewrite the code — report findings only.
