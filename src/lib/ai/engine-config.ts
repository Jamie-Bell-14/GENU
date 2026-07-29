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
 */
export const DISCOVERY_MODEL = "claude-opus-5";

/**
 * Output ceiling for one turn, covering *everything* the model generates.
 *
 * On this model thinking is on by default and is billed and bounded inside the
 * same allowance as the visible answer, so a limit sized only for the prose a
 * user reads truncates the answer mid-sentence. 8k leaves room for reasoning,
 * one focused reply and a tool call.
 */
export const MAX_OUTPUT_TOKENS = 8_000;

/**
 * Input budget for assembled context. Not a provider parameter — the
 * application enforces it while assembling, which is the point: it forces real
 * windowing instead of sending the whole project (§11.5, minimum necessary).
 */
export const MAX_CONTEXT_TOKENS = 30_000;

/**
 * How much thinking and tool work the model spends per turn. `medium` is the
 * starting point for a sweep, not a tuned value: this model performs strongly
 * at lower effort, and a discovery turn is a conversation rather than a
 * long-horizon agentic run.
 */
export const DISCOVERY_EFFORT = "medium" as const;

/**
 * Tool calls one turn may make. The approved design is a single streaming
 * tool-use call (PROJECT_PLAN §17, decision 2); this leaves room for a retry
 * and a scene recommendation alongside it, and stops a confused-deputy loop
 * calling a tool indefinitely.
 */
export const MAX_TOOL_STEPS = 5;

/**
 * Schema-guided retries for invalid structured output (docs/AI_SYSTEM.md §5).
 * Exactly one: a second failure is a safe user-facing error, not a third
 * attempt to talk the model into a valid shape.
 */
export const MAX_SCHEMA_RETRIES = 1;

/** How long a single turn may run before it is abandoned. */
export const TURN_TIMEOUT_MS = 120_000;

/**
 * Interval between lease renewals for a running turn (see issue #11). Well
 * inside the 15-minute lease so several consecutive heartbeats can fail
 * without the run being declared dead while its worker is alive.
 */
export const LEASE_HEARTBEAT_MS = 60_000;
