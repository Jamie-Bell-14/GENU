/**
 * Provider and cost limits for the live discovery engine
 * (SECURITY_STANDARDS §17, PROJECT_PLAN §17.1).
 *
 * These are reversible engineering defaults, not approved product policy. They
 * exist here rather than at call sites so a limit can be changed in one place
 * and asserted in tests, and so no request can be built without them.
 */

/**
 * The model this product reasons with.
 *
 * Held as a constant rather than read from the environment: a model change
 * alters behaviour, cost and prompt-cache identity, so it is a code change with
 * a diff, not configuration that can drift between environments unnoticed.
 *
 * Pinned to Claude Haiku 4.5 on the T11 entry-gate branch (issue #14): the
 * live-provider smoke test is a controlled, low-cost check that the real
 * provider boundary works — model, prompt and strict tool schemas — not a
 * product model decision. `DISCOVERY_EFFORT` is not sent with this model;
 * see its own comment.
 */
export const DISCOVERY_MODEL = "claude-haiku-4-5-20251001";

/**
 * Output ceiling for a single provider request, covering everything the model
 * generates on that request.
 *
 * On the model this was originally sized for, thinking was on by default and
 * bounded by this same allowance, so a limit sized only for the prose a user
 * reads would truncate the answer mid-sentence. `DISCOVERY_MODEL` is
 * currently pinned to Claude Haiku 4.5 (T11 entry-gate branch, issue #14),
 * which is not sent a `thinking`/`output_config` parameter at all — the cap
 * still bounds the visible answer correctly, but the "thinking" rationale
 * does not apply to a live request on this branch.
 *
 * This is *not* the turn's budget. A turn may make several requests, so a
 * per-request ceiling bounds none of them collectively; see
 * `TURN_OUTPUT_ALLOWANCE`.
 */
export const MAX_REQUEST_OUTPUT_TOKENS = 8_000;

/**
 * Output the whole turn may generate, across every request it makes.
 *
 * Deliberately equal to the per-request ceiling, which is the *stricter*
 * reading of the only figure on record. PROJECT_PLAN §17.1 records a per-turn
 * output cap, and multiplying it by the number of rounds a turn may make would
 * be choosing a new number — a cost decision that belongs to Jamie, not an
 * implementation detail. Until that decision exists, a turn may spend the
 * recorded figure in total, however many rounds it takes.
 *
 * The consequence is honest and worth stating: a tool-heavy turn can exhaust
 * this and fail with nothing written, rather than quietly costing three times
 * what was approved.
 */
export const TURN_OUTPUT_ALLOWANCE = MAX_REQUEST_OUTPUT_TOKENS;

/**
 * Input the whole turn may send, across every request.
 *
 * Separate from `MAX_CONTEXT_TOKENS`, which bounds one assembly. A turn's
 * transcript grows with each round — assistant content, tool results, a
 * direction — and every round re-sends all of it, so the per-assembly budget
 * says nothing about what a turn costs. This is checked *before* each request
 * rather than accumulated from responses afterwards, because a bound you
 * discover after paying is a report, not a bound.
 */
export const TURN_INPUT_ALLOWANCE = 120_000;

/**
 * Input budget for assembled context. Not a provider parameter — the
 * application enforces it while assembling, which is the point: it forces real
 * windowing instead of sending the whole project (§11.5, minimum necessary).
 *
 * The system prompt, tool definitions and the accumulating tool transcript are
 * counted against the turn's input accounting too, so the figure reported for
 * a turn is what was actually sent rather than the first snapshot only.
 */
export const MAX_CONTEXT_TOKENS = 30_000;

/**
 * How much thinking and tool work the model spends per turn. `medium` is the
 * starting point for a sweep, not a tuned value: this model performs strongly
 * at lower effort, and a discovery turn is a conversation rather than a
 * long-horizon agentic run.
 *
 * Not sent while `DISCOVERY_MODEL` is pinned to Claude Haiku 4.5 (T11
 * entry-gate branch, issue #14): Haiku does not support `output_config.effort`,
 * and sending an unsupported field would fail every live request before the
 * smoke test could observe anything else about the provider boundary.
 */
export const DISCOVERY_EFFORT = "medium" as const;

/**
 * Provider round-trips one turn may make. The approved design is a single
 * streaming tool-use call (PROJECT_PLAN §17, decision 2); this leaves room for
 * a schema retry and a direction step alongside it.
 */
export const MAX_PROVIDER_ROUNDS = 5;

/**
 * Tool calls one turn may make, counted per *block* rather than per round.
 *
 * A round limit alone bounds nothing: a single response may contain many
 * parallel `tool_use` blocks, so a turn could make twenty tool calls inside
 * one "step". This is the cap that actually holds.
 */
export const MAX_TOOL_CALLS = 6;

/**
 * Schema-guided retries for invalid structured output (docs/AI_SYSTEM.md §5).
 * Exactly one: a second failure is a safe user-facing error, not a third
 * attempt to talk the model into a valid shape.
 */
export const MAX_SCHEMA_RETRIES = 1;

/**
 * How long a turn's lease runs from each renewal.
 *
 * Matches the database default so a renewed lease and a fresh one mean the
 * same thing. Renewal is monotonic in SQL — it can only move an expiry later —
 * so this value cannot shorten a lease even if it were reduced here.
 */
export const LEASE_TTL_SECONDS = 900;

/**
 * Interval between lease renewals. Well inside `LEASE_TTL_SECONDS`, so several
 * consecutive heartbeats can fail without the run being declared dead while
 * its worker is alive.
 */
export const LEASE_HEARTBEAT_MS = 60_000;

/**
 * How long a single turn may run before it is abandoned.
 *
 * Deliberately longer than `LEASE_TTL_SECONDS`. The point of the heartbeat
 * (issue #11) is that a healthy turn outliving one lease period stays
 * `running` because something keeps saying so — and that invariant is
 * unreachable if the engine gives up first, which would make the lease's fixed
 * expiry the real limit and the heartbeat decoration.
 *
 * A turn this long is the *ceiling*, not the expectation: the user can stop at
 * any point, the per-turn output allowance bounds cost independently, and a
 * dead worker is detected by the lease rather than by this timer.
 */
export const TURN_TIMEOUT_MS = 20 * 60_000;
