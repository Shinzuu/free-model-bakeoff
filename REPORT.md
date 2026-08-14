# Free-model bake-off

_Which free model should the chat edge function run on? 126 graded attempts over 14 questions, through the real production tool loop against fixture data._

## Contents

1. [Verdict](#verdict)
2. [How this was measured](#how-this-was-measured)
3. [Scoreboard](#scoreboard)
4. [Where each model breaks](#where-each-model-breaks)
5. [Errors, classified](#errors-classified)
6. [One failure mode that a percentage hides](#one-failure-mode-that-a-percentage-hides)
7. [Candidates with no usable result](#candidates-with-no-usable-result)
8. [Experiment 1 — send fewer tool schemas](#experiment-1-send-fewer-tool-schemas)
9. [Experiment 2 — define "open" in the prompt](#experiment-2-define-open-in-the-prompt)
10. [The throughput ceiling](#the-throughput-ceiling)
11. [What the limits actually did to this run](#what-the-limits-actually-did-to-this-run)
12. [What to do about it](#what-to-do-about-it)
13. [Ruled out](#ruled-out)
14. [Bugs this turned up in production code, and their fixes](#bugs-this-turned-up-in-production-code-and-their-fixes)
15. [How much of this was the harness](#how-much-of-this-was-the-harness)
16. [Known limits of this result](#known-limits-of-this-result)

## Verdict

**openai/gpt-oss-20b** on groq is the pick: 88% of answers correct, 95% correct tool routing, 1042ms median. Next best is `openai/gpt-oss-20b:free` at 64%.

The surprise is that the small model wins. `openai/gpt-oss-20b` (88%) beats `openai/gpt-oss-120b` (64%), its own six-times-larger sibling, on both accuracy and reliability — the big one produced 10 failed calls to the small one's 2. On a workload that is mostly "pick the right tool, read one number out of the result", parameter count buys nothing.

Accuracy is not what decides adoption, though, and neither is speed. One assistant question costs about 3312 tokens, because the system prompt and all 17 tool schemas are resent on every round trip. Groq's free tier allows 200,000 tokens **per day per model** — a cap that appears nowhere in the docs and only surfaces inside a 429. That works out to roughly **60 assistant questions a day for the whole team**, and this sweep hit it. Shrinking the prompt is worth more than any further model shopping.

One more thing to do before changing anything about the model: adding a single sentence that defines what "open" means moved two questions from never-correct to mostly-correct. That is a bigger accuracy gain than the gap between any two models here, and it costs nothing.

## How this was measured

The eval runs the **real production code path**, not a re-implementation: the same tool loop (`openai.ts`), the same 17 tool schemas and executors (`tools.ts`), and the system prompt read straight out of `index.ts` at run time so it cannot drift.

Only the data layer is swapped. Every tool already takes a `PgClient` (`get`/`count`/`rpc`), so `fakePg.ts` implements that interface over a hand-written fixture database instead of PostgREST. **No database, no Supabase traffic, no writes anywhere.**

The fixtures are small but deliberately hostile. A client named `Priya Menon | Northwind Media` owns a project named `Northwind Media` — answering the client question from the project is the real regression from 2026-08-05. `Rahman` is one employee's first name and another's last name. One DONE task sits past its due date and must not count as overdue. One shift is left open and one task timer is still running.

Before any sweep is believed, 34 tests must be green: 14 on the query engine itself, and 20 that run the real tools over the fixtures and pin every number the graders check. If those pass, a wrong answer in a sweep is the model's, not the harness's.

Scoring is deliberately two numbers. **Tool routing** asks whether it reached for the right data; **answers** asks whether it then said the right thing. Bad routing is a prompt or schema problem, bad answers is a reading problem, and averaging them together hides which one you have.

## Scoreboard

126 graded attempts across 4 model/provider pairs, 14 questions each.

| model | provider | tool routing | answers | answers (excl. errors) | errors | median | p95 | tokens/question |
|---|---|---|---|---|---|---|---|---|
| `openai/gpt-oss-20b` | groq | 95% | **88%** | 93% | 2/42 | 1042ms | 3019ms | 3312 |
| `openai/gpt-oss-20b:free` | openrouter | 79% | **64%** | 75% | 2/14 | 27909ms | 223768ms | 3235 |
| `openai/gpt-oss-120b` | groq | 76% | **64%** | 84% | 10/42 | 1149ms | 1951ms | 2910 |
| `llama-3.1-8b-instant` | groq | 75% | **32%** | 39% | 5/28 | 599ms | 798ms | 4394 |

## Where each model breaks

Aggregate percentages hide the shape of a failure. This is the same data per question — and it shows that weak models are not uniformly weak, they fail the same two or three questions every single time.

| question | probes | openai/gpt-oss-20b | openai/gpt-oss-20b:free | openai/gpt-oss-120b | llama-3.1-8b-instant |
|---|---|---|---|---|---|
| `client-vs-project` | THE regression: "Northwind" names both a client (6 projects, 12 open) and one of its projects (4 tasks) | 1/3 | 1/1 | 0/3 | 0/2 |
| `project-scoped` | The mirror of the above — when the user explicitly says "the project", staying scoped is correct | 1/3 | 1/1 | 0/3 | 0/2 |
| `ambiguous-person` | Rahman is one person's first name and another's last name | 2/3 | 1/1 | 0/3 | 0/2 |
| `on-leave-today` | Approved leave spanning today | 3/3 | 0/1 | 0/3 | 0/2 |
| `leave-approved` | PENDING is not APPROVED | 3/3 | 1/1 | 3/3 | 1/2 |
| `leave-balance` | Requires reading remaining_days (7), not quota (10) or quota-minus-used (10) | 3/3 | 1/1 | 3/3 | 0/2 |
| `clocked-in` | One dangling shift and one running task timer, same person | 3/3 | 0/1 | 3/3 | 2/2 |
| `overdue` | One DONE task is past its due date | 3/3 | 1/1 | 3/3 | 0/2 |
| `workload` | 4 open, 2 overdue | 3/3 | 1/1 | 3/3 | 2/2 |
| `eod` | EOD lines exist only via eod_report — models often try search_tasks instead | 3/3 | 0/1 | 3/3 | 2/2 |
| `holiday` | Defaults to upcoming only; the past Company Offsite must not be returned | 3/3 | 0/1 | 0/3 | 0/2 |
| `project-time` | 360 minutes = 6 hours | 3/3 | 0/1 | 3/3 | 0/2 |
| `empty-result` | She is INACTIVE with zero tasks | 3/3 | 1/1 | 3/3 | 1/2 |
| `refuse-to-guess` | MEPS is deliberately out of the tool set (spec §9) | 3/3 | 1/1 | 3/3 | 1/2 |

## Errors, classified

An error is not automatically a model failure, and conflating the two is how a sweep produces confident nonsense. A 429 means the free tier throttled us; a malformed tool call means the model could not hold the conversation.

| model | errors | kind | first error |
|---|---|---|---|
| `openai/gpt-oss-20b` | 2/42 | rate limit — throughput, not capability | `https://api.groq.com/openai/v1 429: {"error":{"message":"Rate limit reached for model `openai/gpt-oss-20b` in organization `org_[r` |
| `openai/gpt-oss-20b:free` | 2/14 | rate limit — throughput, not capability | `https://openrouter.ai/api/v1 429: {"error":{"message":"Provider returned error","code":429,"metadata":{"raw":"openai/gpt-oss-20b:f` |
| `openai/gpt-oss-120b` | 10/42 | rate limit — throughput, not capability; tool arguments failed schema validation — the model | `https://api.groq.com/openai/v1 400: {"error":{"message":"Tool call validation failed: tool call validation failed: parameters for ` |
| `llama-3.1-8b-instant` | 5/28 | malformed tool call — the model; tool arguments failed schema validation — the model | `https://api.groq.com/openai/v1 400: {"error":{"message":"Failed to call a function. Please adjust your prompt. See 'failed_generat` |

## One failure mode that a percentage hides

`openai/gpt-oss-20b:free` on openrouter did not just answer wrongly on some questions — it stopped producing language. The reply is a single character repeated to the output-token limit.

Two of these had already called the correct tool and received correct data; the collapse happened while writing the answer. That points at the serving stack rather than the weights — the same weights on the other provider never did this once in 42 attempts. It is the strongest argument in this whole report for treating "which provider" as a separate question from "which model".

| provider | question | tools it called first | output tokens | wall clock |
|---|---|---|---|---|
| openrouter | `clocked-in` | `who_is_clocked_in` | 2082 | 105s |
| openrouter | `holiday` | `holidays` | 2114 | 217s |
| openrouter | `project-time` | none | 2048 | 224s |

## Candidates with no usable result

These runs are not scored, because they did not produce scores. More than half of every attempt died being throttled, and reporting the survivors as a percentage would invent a capability finding out of a queueing one.

That is a result of its own kind, though: on the free tier these models are not merely slower, they are effectively unreachable at the token cost of an assistant question. They would need a paid tier or a much smaller prompt to be evaluated at all.

| model | attempts | errored | usable answers | why |
|---|---|---|---|---|
| `llama-3.3-70b-versatile` | 42 | 28 (67%) | 79% of 14 | every failure was a rate limit |
| `qwen/qwen3.6-27b` | 42 | 42 (100%) | none | mostly rate limits |

## Experiment 1 — send fewer tool schemas

All 17 tool schemas go to the model on every round trip, which is most of the token bill and therefore most of the daily budget. This arm narrows the list by intent with plain keyword matching before the call — deliberately not another model call, since a router that costs a round trip gives back everything it saves. The two name-resolution tools are always included, and an unclear intent falls back to all 17.

Run on `openai/gpt-oss-120b` against its own baseline, same questions, tool list the only difference. It sent 8.9 schemas on average instead of 17, and spent 2265 tokens per question against 2910 — a 22% cut, with accuracy unchanged.

Halving the schema count does not halve the bill, because the schemas are only part of what is sent: the system prompt, the conversation and the tool results all stay. But the saving lands directly on the constraint that matters — the daily question budget rises by the same proportion. Splitting the tool set properly, rather than by keyword guesswork, should do better than this.

| arm | tool schemas sent | tokens/question | answers | tool routing |
|---|---|---|---|---|
| baseline — all 17 | 17 | 2910 | 27/42 (64%) | 76% |
| intent-filtered | 8.9 | 2265 (-22%) | 19/28 (68%) | 79% |

## Experiment 2 — define "open" in the prompt

The most repeated failure in this whole sweep is `project-scoped`: models count only `TODO` as open and drop `IN_PROGRESS`, sometimes in the same reply that listed `IN_PROGRESS` correctly one clause earlier. The system prompt defines "overdue" but never defines "open" — a gap in our instructions, not a limit of the model.

One sentence was appended to the production prompt: *"A task is OPEN if its status is anything other than DONE — TODO and IN_PROGRESS both count as open."* Run on `openai/gpt-oss-120b`, three repeats, against the same model's baseline on the same questions.

| question | baseline prompt | + definition of "open" |
|---|---|---|
| `client-vs-project` | 0/3 | 2/3 |
| `project-scoped` | 0/3 | 3/3 |

One sentence, and two questions this model had never once answered correctly it now mostly gets right. No model change, no retraining, no meaningful extra tokens. It is the largest single accuracy movement in this study — which suggests some of what reads as model weakness in the scoreboard above is really an unstated assumption in our own prompt.

## The throughput ceiling

This is the finding that matters more than the ranking, and it is not the one we expected. The per-minute limit is an annoyance: it slows a sweep down but you get there. The limit that actually stops you is **tokens per day**, which does not appear on the pricing page at all — it only shows up inside a 429.

The assistant spends a lot of tokens per question for reasons that have nothing to do with the model: the system prompt plus all 17 tool schemas is 1,783 tokens, and it is resent on every round trip. Measured against what the providers billed, the winning model makes about 1.7 round trips per question. Divide the daily budget by that and the free tier is not "slow" — it is small.

The questions-per-minute column is arithmetic, budget over cost; real throughput is lower, because a question's round trips arrive within seconds of each other rather than spread across the minute, so the bucket empties in a burst. This sweep had to pace at roughly one question per minute. The questions-per-day column is the number that decides whether this is deployable.

| model | tokens/question (measured) | tokens/minute | questions/minute | tokens/**day** | **questions/day** |
|---|---|---|---|---|---|
| `openai/gpt-oss-20b` | 3312 | 8000 | 2.4 | 200,000 | **60** |
| `openai/gpt-oss-120b` | 2910 | 8000 | 2.7 | not observed | — |
| `llama-3.1-8b-instant` | 4394 | 6000 | 1.4 | not observed | — |
| `llama-3.3-70b-versatile` | 5288 | 12000 | 2.3 | 100,000 | **18** |
| `openai/gpt-oss-20b:free` (OpenRouter) | 3235 | request-capped | — | request-capped | **~20** (≈50 requests) |

## What the limits actually did to this run

Every ceiling above is measured, not quoted — parsed out of the provider's own 429 text, which is per model and changes without notice. Three things follow that are easy to miss from a spec page.

**The daily cap ended this sweep, and it will end a workday.** `openai/gpt-oss-20b` burned 200,000 of its 200,000 daily tokens on one 42-question sweep, at which point it stopped answering for the rest of the day — no retry helps, because the budget resets on a clock rather than a timer. That is roughly 60 assistant questions a day from the whole team, on the winning model.

**Verbose models are throttled harder than they look.** `llama-3.3-70b-versatile` spends 5288 tokens a question against `openai/gpt-oss-120b`'s 2910. A chatty model does not just cost more, it gets fewer turns per minute — the penalty compounds.

**Latency on a free tier is not the model's latency.** Groq answers in about a second. The same weights on OpenRouter's free endpoint took 28s at the median and 224s at p95, because the free pool is shared and queued. For an assistant a manager is waiting on, that difference matters more than a few points of accuracy.

## What to do about it

**Use `openai/gpt-oss-20b` on Groq.** It is the most accurate free option tested, the fastest by an order of magnitude against the alternative provider, and the most reliable — two errors in 42 attempts, both rate limits rather than anything the model did wrong.

**Add the missing definition to the system prompt first.** It is one sentence, it costs nothing, and on the model where it was measured it moved two questions from never-correct to mostly-correct. Do this before drawing any further conclusions about model quality; some of the scoreboard is measuring our prompt.

**Then cut the tool list.** The intent-filtered version measured a 22% cut in tokens per question with no accuracy cost, using nothing but keyword matching. A deliberate split of the 17 tools into intent groups should beat that. Every percent here converts directly into questions per day, which is the binding limit.

**Spread across models.** Groq charges the daily budget per model, not per key. Two trusted models double the daily ceiling at no cost — and production already has fallback machinery in `modelPick.ts` to do it.

**Do not treat the free tier as capacity.** At today's prompt size the whole team gets about 60 assistant questions a day per model. The three fixes above stack to perhaps double that. If the assistant is meant to be something managers use rather than try, the honest answer is that the free tier buys us the evaluation, not the deployment.

## Ruled out

Not everything that appears in a provider's model list can actually do the job, and a model that cannot hold a tool conversation scores 0% in a way that looks like incompetence rather than incapability.

| candidate | why it is out |
|---|---|
| Cerebras | $5 of one-off signup credits, not a renewing free tier — fine for a benchmark, wrong answer for "run this for free" |
| `allam-2-7b`, `groq/compound`, `groq/compound-mini` | listed by Groq as available, but no tool-calling support at all; they now fail preflight instead of scoring 0% |
| `llama-3.1-8b-instant` | emits malformed tool calls — `tool_use_failed`, invalid enum values |
| Gemini free tier | deprioritised: the key page is referrer-restricted and the current production fallback already covers it |

## Bugs this turned up in production code, and their fixes

Four defects that have nothing to do with model choice, all found by the harness rather than by a user, all fixed on the same day. Two of them were silently costing us answers; one was silently costing us money.

| where | problem | fix |
|---|---|---|
| `tools/shared.ts` — `resolveEmployee` | A full name could never match. `likeArg("Rahman Siddique")` becomes `%Rahman%Siddique%`, which was tested against `first_name` OR `last_name` separately, and neither column ever holds both words — so the assistant answered "no employee matching" whenever anyone was polite enough to use a full name. | Queries one clause per word and ranks the rows in the resolver, preferring a row that accounts for every word. Single-word lookups, including deliberately ambiguous ones, behave exactly as before. |
| `modelPick.ts` — `PREFERENCES` | The preference list put a large Qwen model first, so Groq — the only provider that auto-picks — was serving the one model in this study that could not complete a single question inside the free tier. | The measured winner goes first. Pinned by a test built from Groq-shaped model entries, so the ordering cannot drift back silently. |
| `tools/shared.ts` — `shapeTask` | Cast through `Record<string, never>`, which is unsound and trips TS2352. Every module importing the edge function had to run with typechecking disabled. | Cast through `unknown` instead. Typechecking is back on for the whole eval suite — 34 tests, no `--no-check`. |
| `index.ts` — `DEFAULT_OPENROUTER_MODEL` | The production primary has no `:free` suffix. It is a **paid** model that was assumed to be free when it was moved to the front of the chain. | Documented in place rather than swapped: the free variant measured 64% answers at 28s median and degenerated on three questions, so switching would trade money for quality. That is a decision to take deliberately, not a bug to patch. |

## How much of this was the harness

Worth recording, because it nearly produced the wrong answer several times over. Every early "bad model" result turned out to be a harness bug. Production silently substitutes a different model on a 404, so a dead model id was answered by a stand-in and scored as the original. Groq lists models that cannot call tools at all. Pacing was sized per round trip instead of per question, which killed 50 of 70 attempts on rate limits and then scored the survivors. And four graders failed answers that were correct — one demanded a literal digit where models enumerate instead, one broke on a Unicode apostrophe in "couldn't", and one had a negative pattern that matched the correct answer's own negation.

The rule that came out of it: read the actual reply before believing a low score. The per-question breakdown above exists for exactly that.

## Known limits of this result

Every person, client and project named in this report is invented. Earlier sweeps ran against fixtures carrying internal names with the same structure — the same client/project collision, the same shared first-and-last name — and those were replaced with placeholders so this document could be shared. The names do not affect any measurement; the shapes do, and the shapes are unchanged.

Answer grading is substring and regex against pinned ground truth — no LLM judge, deliberately, so the results are reproducible and cost nothing to re-derive. The price is that an unusually phrased correct answer can still fail.

The fixture database is about 5 employees, 8 projects and 18 tasks. It measures routing and reading, not behaviour at production scale.

The question set is 14 hand-written probes chosen to be hostile. It is not yet the set of questions managers actually ask — those still need to be written down and added.

**Both experiments ran on `openai/gpt-oss-120b`, not on the winner.** `gpt-oss-20b` had spent 199,060 of its 200,000 daily tokens on the baseline sweep, and the daily budget resets on a clock, not a timer. Each experiment is a clean A/B against that same model's own baseline, so the deltas are real — but whether they carry across to `gpt-oss-20b` is untested, and that re-run is the first thing to do after the reset.

The prompt-fix arm covers two questions, not fourteen, for the same budget reason. It is enough to show the effect on the questions it targets; it is not an overall accuracy figure.

`llama-3.3-70b-versatile` and `qwen/qwen3.6-27b` were not evaluated. Both exhausted their daily budgets before producing a usable sample, so nothing here should be read as a judgement of either.
