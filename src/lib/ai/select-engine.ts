import {
  AnthropicDiscoveryEngine,
  type AnthropicEngineOptions,
} from "./anthropic-engine";
import {
  ScriptedDiscoveryEngine,
  type DiscoveryEngine,
  type TurnHooks,
  type TurnInput,
  type TurnResult,
} from "./discovery-engine";

/**
 * Chooses the engine for a turn.
 *
 * Presence of a provider key is the whole condition, deliberately. A separate
 * "use the real engine" flag would be a second source of truth that can
 * disagree with the first, and the disagreement is silent: a flag set with no
 * key throws at request time, and a key present with the flag unset runs the
 * scripted engine while a developer wonders why the model has no opinions.
 *
 * CI has no key, so end-to-end and visual tests run against the deterministic
 * engine without needing to know this exists (docs/VERTICAL_SLICE_TASKS.md T9:
 * "e2e stays on scripted engine").
 */
export function liveEngineAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Which engine ran, so the caller can report it without inspecting a class. */
export interface SelectedEngine {
  readonly directionApplication: DiscoveryEngine["directionApplication"];
  readonly live: boolean;
  runTurn(
    input: TurnInput,
    hooks: TurnHooks,
    signal?: AbortSignal,
  ): Promise<TurnResult>;
}

export function selectDiscoveryEngine(
  options: AnthropicEngineOptions = {},
): SelectedEngine {
  if (liveEngineAvailable()) {
    const engine = new AnthropicDiscoveryEngine(options);
    return {
      directionApplication: engine.directionApplication,
      live: true,
      runTurn: (input, hooks, signal) => engine.runTurn(input, hooks, signal),
    };
  }
  const engine = new ScriptedDiscoveryEngine();
  return {
    directionApplication: engine.directionApplication,
    live: false,
    runTurn: (input, hooks, signal) => engine.runTurn(input, hooks, signal),
  };
}
