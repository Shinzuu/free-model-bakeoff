# Which free LLM should run a tool-calling assistant?

An interactive write-up of a real bake-off: six free models, 126 graded attempts,
14 deliberately hostile questions, run through a production tool-calling loop
against a fixture database.

**→ [Read it](https://shinzuu.github.io/free-model-bakeoff/)** ·
[static version](./REPORT.md) · [printable](./report-static.html)

Portfolio: https://shinzuu.asktechguy.com/

## What we found

- **The small model won.** `openai/gpt-oss-20b` answered 88% correctly with 95%
  correct tool routing, beating its own six-times-larger sibling (64% / 76%).
  The large one kept emitting tool arguments that failed schema validation.
- **The provider matters as much as the model.** The same weights on a different
  free host scored 64% at a 28-second median, and on three questions stopped
  producing language entirely — 2048 tokens of a single repeated character,
  *after* correctly calling the tool and receiving correct data.
- **The limit that decides deployment is a daily one.** Not tokens per minute:
  tokens per **day**. 200,000 per model, which appears on no pricing page and
  surfaces once, inside a 429, after you have spent it. At this assistant's
  prompt size that is about 60 questions a day for a whole team.
- **The biggest accuracy win came from one sentence.** The system prompt defined
  "overdue" and never defined "open". Adding that definition took two questions
  from never-correct to mostly-correct — a larger gain than the gap between any
  two models tested.

## How it was measured

The eval runs the **real production code path** — the same tool loop, the same
17 tool schemas and executors, and the system prompt read out of the source at
run time so it cannot drift. Only the data layer is swapped: every tool takes a
small database interface, so a fixture implementation stands in for the real one.
No database, no writes anywhere.

Two scores are kept separate on purpose. **Tool routing** asks whether the model
reached for the right data; **answers** asks whether it then said the right
thing. Averaging them hides which problem you have.

Grading is substring and regex against pinned ground truth — deliberately no
model-as-judge, so any grader change can be re-scored against every stored reply
for free. Before any result was believed, six *harness* bugs had to be found and
fixed: silent model substitution on a 404, models that cannot call tools at all,
pacing sized per round trip instead of per question, and four graders that failed
correct answers — one of them over a Unicode apostrophe.

## Honest limits

- Every person, client and project named here is **invented**. The recorded runs
  used internal names with the same structure; names do not affect any
  measurement, shapes do, and the shapes are unchanged.
- The fixture database is small — about 5 people, 8 projects, 18 tasks. It
  measures routing and reading, not behaviour at production scale.
- Two candidates were never evaluated. They exhausted their daily token budgets
  before producing a usable sample, so they are reported as missing data rather
  than as a low score. Nothing here is a judgement of them.
- Both experiments ran on the runner-up rather than the winner, for the same
  budget reason. Whether the deltas carry across is untested.
- No provider's pricing was measured, which is why the cost calculator asks you
  to enter a rate instead of guessing one.

## This repository

| file | what it is |
|---|---|
| `index.html`, `styles.css`, `app.js` | the interactive page |
| `data.json` | every number on the page, emitted by the eval harness |
| `REPORT.md` | the same findings as a plain document |
| `report-static.html` | printable version with static charts |

The page reads `data.json` at load and derives everything from it — there is no
second copy of the numbers to fall out of date. Re-running a sweep regenerates
that file and the page changes with it.

Third-party libraries (GSAP, interact.js) load from a CDN pinned by version and
Subresource Integrity hash.

## Licence

MIT — see [LICENSE](./LICENSE).
