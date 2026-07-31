import { NextResponse, type NextRequest } from "next/server";
import { createActivityReporter } from "@/lib/ai/activity-reporter";
import { finishTurn } from "@/lib/ai/finish-turn";
import { withLeaseHeartbeat } from "@/lib/ai/lease-heartbeat";
import { loadProjectContext, type LoadedContext } from "@/lib/ai/load-context";
import { selectDiscoveryEngine } from "@/lib/ai/select-engine";
import { createTurnHooks } from "@/lib/ai/turn-hooks";
import type { SafeError, TurnEvent } from "@/lib/ai/turn-events";
import {
  loadCanvasObjects,
  loadProjectRelationships,
} from "@/lib/canvas/project-model-store";
import type { TurnResult } from "@/lib/ai/discovery-engine";
import { loadTurnScope, scopeIsWhole } from "@/lib/canvas/project-scope";
import { commitTurn } from "@/lib/services/model-operations";
import { MockResearchProvider } from "@/lib/research/mock-research-provider";
import {
  closeTurnRun,
  completeTurnRecord,
  startTurn,
  recordActivity,
  recordAudit,
  recordResearchFinding,
  renewTurnLease,
  takeDirections,
  DIRECTION_CURSOR_START,
  type AuditAction,
} from "@/lib/services/trusted-writer";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TurnRequestSchema, TURN_RATE_LIMIT } from "@/lib/validation/turns";

export const runtime = "nodejs";

/**
 * What the engine sees when the project read failed. Empty rather than absent:
 * a turn with no context still answers the user's message, and pretending the
 * project has content that was never read would be worse than saying nothing
 * about it.
 */
function emptyProjectContext(): LoadedContext {
  return {
    fields: [],
    recentMessages: [],
    objects: [],
    relationshipIds: [],
    focalObjectId: null,
    complete: false,
  };
}

function errorResponse(error: SafeError, status: number) {
  return NextResponse.json({ error }, { status });
}

function encodeEvent(event: TurnEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

/**
 * Conversation turn. Treated as a public mutation endpoint: authenticate,
 * authorise the project, validate input, rate-limit, then stream
 * (SECURITY_STANDARDS §8). Message bodies are never logged.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return errorResponse(
      {
        code: "engine_unavailable",
        userMessage:
          "The workspace is not connected to its database in this environment.",
        recoverable: false,
      },
      503,
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return errorResponse(
      {
        code: "session_expired",
        userMessage: "Your session has ended. Sign in again to continue.",
        recoverable: true,
      },
      401,
    );
  }

  // Ownership check in the service layer, with RLS underneath. A foreign or
  // nonexistent project produces the same 404 (no existence inference).
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) {
    return errorResponse(
      {
        code: "engine_unavailable",
        userMessage: "That project is not available.",
        recoverable: false,
      },
      404,
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    payload = null;
  }
  const parsed = TurnRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return errorResponse(
      {
        code: "message_too_long",
        userMessage: parsed.error.issues[0].message,
        recoverable: true,
      },
      400,
    );
  }

  const { data: limit, error: limitError } = await supabase
    .rpc("check_rate_limit", {
      p_action: TURN_RATE_LIMIT.action,
      p_limit: TURN_RATE_LIMIT.limit,
      p_window_seconds: TURN_RATE_LIMIT.windowSeconds,
    })
    .single<{ allowed: boolean; retry_after_seconds: number }>();
  if (limitError) {
    return errorResponse(
      {
        code: "engine_unavailable",
        userMessage:
          "The message could not be sent right now. Your text is unchanged — try again.",
        recoverable: true,
      },
      503,
    );
  }
  if (!limit.allowed) {
    return errorResponse(
      {
        code: "rate_limited",
        userMessage: `You have sent a lot of messages in a short time. Wait ${limit.retry_after_seconds} seconds and send again — your text is unchanged.`,
        recoverable: true,
        retryAfterSeconds: limit.retry_after_seconds,
      },
      429,
    );
  }

  const turnId = crypto.randomUUID();

  /*
    The message and the turn's operational record are written together, before
    the stream opens. Together, because a message saved for a turn that was then
    refused is an orphan the client re-sends as a duplicate; before, because
    steering and recovery both read the run, so a turn that cannot record that
    it is running must not open a stream and offer controls that cannot work —
    it fails here, where a plain error response is still possible.
  */
  const started = await startTurn({
    projectId,
    turnId,
    // The function authorises this itself rather than trusting the check above:
    // an elevated path has to carry its own authorisation.
    actorId: user.id,
    content: parsed.data.message,
  });
  if (started === "already_running") {
    /*
      One turn per project at a time (T9 edge case). Nothing was saved, so the
      client keeps the draft and this says to send it again — the earlier
      version claimed the message was saved, which was true then and is not now.
    */
    return errorResponse(
      {
        code: "engine_unavailable",
        userMessage:
          "This project already has a response in progress — probably in another tab. Wait for it to finish, then send again; your text is unchanged.",
        recoverable: true,
      },
      409,
    );
  }
  if (started !== "started") {
    return errorResponse(
      {
        code: "engine_unavailable",
        userMessage:
          "The workspace could not start this turn. Nothing was sent — your text is unchanged, so try again.",
        recoverable: true,
      },
      503,
    );
  }

  const engine = selectDiscoveryEngine({
    buildContext: () => loadedContext ?? emptyProjectContext(),
    onDiagnostics: (diagnostics) =>
      // Structured, correlated, and free of message bodies (§12).
      console.info("turn", { projectId, ...diagnostics }),
  });
  /*
    Populated inside the stream, before the engine runs. The engine asks for
    context synchronously through `buildContext`, so the read happens here
    where it can be reported as an activity step and audited.
  */
  let loadedContext: LoadedContext | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      /*
        Emission is best-effort. If the client has gone the controller throws,
        and that must never stop the turn recording its outcome — a run that
        cannot finalise stays eligible for direction and recoverable until its
        lease expires.
      */
      const emit = (event: TurnEvent) => {
        try {
          controller.enqueue(encodeEvent(event));
        } catch {
          // The reader is gone; the turn still finishes its own work.
        }
      };
      const audit = (
        action: AuditAction,
        extra: {
          target?: string;
          detail?: Record<string, string | number>;
        } = {},
      ) =>
        recordAudit({
          projectId,
          actorId: user.id,
          actorKind: action === "turn_started" ? "user" : "system",
          action,
          correlationId: turnId,
          ...extra,
        });

      /*
        Reporting happens around the work that performs it, so a label is never
        emitted for something that already finished (T8: activity describes
        observable work).
      */
      /*
        The turn id is the first thing on the stream, before any activity: the
        client needs it to steer the turn and to ask for catch-up if the
        connection drops, so it must not arrive after work has begun.
      */
      emit({ type: "turn_started", turnId });

      const reporter = createActivityReporter({
        emit,
        persist: (operationId, step, state) =>
          recordActivity({ projectId, turnId, operationId, step, state }),
      });

      /*
        Steering arrives on a separate request, so the turn reads directions
        newer than a cursor it advances itself. The table stays append-only:
        "already applied" is state of this run, not an edit to history.
      */
      let directionCursor = DIRECTION_CURSOR_START;

      try {
        await audit("turn_started");

        // Every id a scene may name comes from rows this user can already
        // read, and the focal object is the application's reading of the
        // project rather than an engine's guess.
        const turnScope = await reporter.step(
          "reading_project_model",
          async () => {
            const scope = await loadTurnScope(supabase, projectId);
            // Context for the model is read in the same step, because it is
            // the same operation from the user's point of view: the project
            // being read before the turn thinks about it.
            loadedContext = await loadProjectContext(
              supabase,
              projectId,
              {
                // The inventory a scene may name, with enough about each object
                // for the choice of focal object to be informed rather than a
                // guess at a UUID.
                objects: scope.objects.map((object) => ({
                  id: object.id,
                  kind: object.kind,
                  label: object.title,
                })),
                relationshipIds: scope.relationshipIds,
                focalObjectId: scope.focalObjectId,
              },
              // Correlated by turn, not by "whichever message is newest".
              turnId,
            );
            return scope;
          },
          // A partial or failed read is not "project model read": what is in
          // hand is narrower than the project, so the label says so.
          (scope) =>
            scopeIsWhole(scope) && loadedContext?.complete
              ? "succeeded"
              : "failed",
        );
        if (!scopeIsWhole(turnScope)) {
          // An incomplete scope fails closed, so record why rather than
          // treating a partial read as the whole project.
          await audit("scope_truncated", {
            detail: {
              objects: turnScope.objectIds.length,
              reason: turnScope.failed ? "read_failed" : "limit_reached",
            },
          });
        }

        /*
          What the canvas is told the project now holds — re-read from the
          application's own tables after a write landed, never from anything
          the model described. Used by `finishTurn` after the turn's own
          commit, whenever that commit actually changed something — including
          "Add as evidence", which is staged into that same commit like any
          other project-truth write (T10 review round 2, P0-B).
        */
        const publishProjectModel = async () => {
          const [objects, relationships] = await Promise.all([
            loadCanvasObjects(supabase, projectId),
            loadProjectRelationships(supabase, projectId),
          ]);
          emit({
            type: "project_model_updated",
            objects: objects.data,
            relationships: relationships.data,
          });
        };

        const hooks = createTurnHooks({
          emit,
          scope: turnScope.scope,
          reporter,
          turnId,
          researchProvider: new MockResearchProvider(),
          recordResearchFinding: ({
            finding,
            focalObjectId,
            unavailableSources,
            appliedDirections,
          }) =>
            recordResearchFinding({
              projectId,
              turnId,
              finding,
              focalObjectId,
              unavailableSources,
              appliedDirections,
            }),
          onSceneAccepted: (scene) =>
            audit("scene_recommended", {
              target: scene.renderer,
              detail: { objects: scene.visibleObjectIds.length },
            }),
          onSceneRejected: (rejection) =>
            audit("scene_rejected", { detail: { code: rejection.code } }),
          /*
            Emitted only once the model has actually been given the direction.
            Announcing it when the note merely existed was the defect: the
            interface said "applied" for a direction no request ever carried.
          */
          onDirectionApplied: (note) =>
            emit({ type: "direction_applied", note }),
          takeDirection: async ({ final }) => {
            /*
              Reading and sealing are one locked operation: a direction is
              either inserted before the seal and returned here, or the seal
              wins and the endpoint refuses it. A read followed by a separate
              seal would leave a window where neither happens.
            */
            const result = await takeDirections({
              projectId,
              turnId,
              after: directionCursor,
              seal: final,
            });
            if (!result.ok) {
              /*
                The read failed, so the seal did not happen either. At a final
                boundary that leaves the window open with no step left to
                consume anything, so the turn fails rather than continuing —
                closing it in the catch below seals the window as a side
                effect. A non-final boundary can simply try again later; the
                cursor has not advanced.
              */
              if (final) throw new Error("direction_seal_failed");
              return null;
            }
            const directions = result.directions;
            if (directions.length === 0) return null;
            directionCursor = directions[directions.length - 1].cursor;
            // Returned, not announced: whether the model uses it is the
            // engine's to report through `onDirectionApplied`.
            return directions.map((entry) => entry.note).join("\n");
          },
        });

        /*
          A live turn can run for minutes, well past the fixed lease a scripted
          turn never approached (issue #11). The worker says it is alive while
          it works; when it can no longer say so, it stops rather than
          continuing to produce a result that cannot be recorded against a live
          run — by then recovery may already have told the user the turn did
          not finish.
        */
        const lost = new AbortController();

        let result: TurnResult;
        /*
          `withLeaseHeartbeat` keeps the lease renewed for the whole of `work`,
          not merely for the provider call inside it: the turn is not over when
          the model stops talking, only once its durable completion has
          actually committed (docs/AI_SYSTEM.md §4.1), and that commit is
          itself a database round trip the lease has to survive. Stopping the
          heartbeat as soon as the model finished would let the lease lapse
          while the row still said `running` — exactly the state
          `complete_turn` now refuses to trust on its own (issue #11). Putting
          both calls inside `work` makes that ordering structural rather than
          a convention this file has to keep re-deriving correctly.
        */
        await withLeaseHeartbeat(
          {
            renew: (seconds) => renewTurnLease({ turnId, seconds }),
            onLost: (reason) => {
              void audit("turn_failed", {
                detail: { code: `lease_${reason}` },
              });
              lost.abort();
            },
          },
          async () => {
            result = await engine.runTurn(
              {
                projectId,
                turnId,
                userMessage: parsed.data.message,
                context: {
                  objectIds: turnScope.objectIds,
                  focalObjectId: turnScope.focalObjectId,
                },
              },
              hooks,
              AbortSignal.any([request.signal, lost.signal]),
            );

            /*
              The host — not the engine — decides the turn is over, and
              everything the turn changes is committed together: the answer,
              the project-truth writes it produced and the terminal state
              (see finish-turn.ts).
            */
            await finishTurn(
              {
                turnId,
                /*
                  One transaction, through the one port that can reach it.
                  The elevated function is authorised against this user
                  inside the database, so this path carries its own
                  authorisation rather than inheriting the ownership check
                  made above.
                */
                completeTurn: (assistantText) =>
                  commitTurn(
                    (writes) =>
                      completeTurnRecord({
                        projectId,
                        turnId,
                        actorId: user.id,
                        ...writes,
                      }),
                    {
                      projectId,
                      turnId,
                      // The message as the server received it, so provenance
                      // is checked against text the provider cannot have
                      // rewritten.
                      userMessage: parsed.data.message,
                      activeFindingId: parsed.data.activeFindingId ?? null,
                    },
                    result.operations,
                    assistantText,
                  ),
                publishProjectModel,
                closeRun: (state) => closeTurnRun({ turnId, state }),
                audit: (action, detail) => audit(action, { detail }),
                /*
                  Audited from what the transaction did, so
                  `operation_applied` means a row exists rather than that a
                  write was attempted. Every outcome is recorded including
                  refusal, which is exactly the kind of event that matters
                  after the fact, and none of it travels back to the engine.
                */
                auditOperation: (outcome) =>
                  outcome.applied
                    ? audit("operation_applied", {
                        target: outcome.kind,
                        detail: outcome.refused
                          ? { count: outcome.count, refused: outcome.refused }
                          : { count: outcome.count },
                      })
                    : audit("operation_rejected", {
                        target: outcome.kind,
                        detail:
                          outcome.reason === "rejected"
                            ? { reason: outcome.reason, issue: outcome.issue }
                            : { reason: outcome.reason },
                      }),
                emit,
              },
              result.assistantText,
            );
          },
        );
      } catch {
        // Internal detail stays server-side (SECURITY_STANDARDS §8).
        // Finalisation first: a dead stream must not stop the turn recording
        // that it failed.
        await closeTurnRun({ turnId, state: "failed" });
        emit({
          type: "turn_failed",
          turnId,
          error: {
            code: "engine_unavailable",
            userMessage:
              "The response could not be completed. Your message is saved — send another when you are ready.",
            recoverable: true,
          },
        });
        await audit("turn_failed");
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      /*
        Also outside the body. The client learns the turn id from the first SSE
        frame, and a connection that dies before that frame would otherwise
        leave it with nothing to recover by.
      */
      "x-turn-id": turnId,
    },
  });
}
