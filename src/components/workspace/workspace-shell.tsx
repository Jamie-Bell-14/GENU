"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { PanelLeftIcon, SettingsIcon } from "lucide-react";
import {
  clampSplit,
  persistLayout,
  readStoredLayout,
  DEFAULT_LAYOUT,
  type FocusMode,
  type WorkspaceLayout,
} from "@/lib/workspace/layout";
import { ConversationPane } from "@/components/conversation/conversation-pane";
import { LivingCanvas } from "@/components/canvas/living-canvas";
import type { EditSubmit } from "@/components/canvas/object-editor";
import type { CanvasObject } from "@/lib/canvas/model";
import type { ProjectRelationship } from "@/lib/canvas/relationships";
import type { ActivityLine, Message } from "@/lib/ai/turn-events";
import type { ResearchFinding, ResearchSource } from "@/lib/research/types";
import { useTurnRuntime } from "@/lib/ai/use-turn-runtime";
import { ActivityHistory } from "@/components/activity/activity-history";
import { AppearanceSettings } from "./appearance-settings";
import { PlanningNav } from "./planning-nav";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

function SkipLinks() {
  return (
    <div>
      {[
        ["#conversation-pane", "Skip to conversation"],
        ["#canvas-pane", "Skip to canvas"],
      ].map(([href, label]) => (
        <a
          key={href}
          href={href}
          className="focus-visible:ring-edge-focus sr-only rounded-md px-3 py-2 text-sm focus-visible:not-sr-only focus-visible:absolute focus-visible:top-2 focus-visible:left-2 focus-visible:z-50 focus-visible:bg-surface-elevated focus-visible:ring-2"
        >
          {label}
        </a>
      ))}
    </div>
  );
}

export function WorkspaceShell({
  projectId,
  projectName,
  initialMessages = [],
  initialActivity = [],
  activityTruncated = false,
  canvasObjects = [],
  canvasRelationships = [],
  initialResearch = null,
  initialEvidenceOutcome = null,
  onEditObject,
}: Readonly<{
  projectId: string;
  projectName: string;
  initialMessages?: Message[];
  /** Activity already recorded for this project, newest last. */
  initialActivity?: ActivityLine[];
  /** True when older activity exists beyond what was loaded. */
  activityTruncated?: boolean;
  canvasObjects?: CanvasObject[];
  canvasRelationships?: ProjectRelationship[];
  /**
   * The research receipt "Add as evidence" can still resolve, if the most
   * recent thing that happened in this project was the research that
   * produced it (T10 review round 2, P0-A) — otherwise absent, exactly as
   * a fresh session would be.
   */
  initialResearch?: {
    finding: ResearchFinding;
    turnId: string;
    unavailableSources: { source: ResearchSource; reason: string }[];
  } | null;
  /**
   * A refused "Add as evidence" still current as of the last reload
   * (T10 review round 4, P0-3) — recovered the same way `initialResearch`
   * is, so the correction survives a reload rather than only the stored,
   * staged assistant wording.
   */
  initialEvidenceOutcome?: { reason: string } | null;
  onEditObject?: EditSubmit;
}>) {
  /*
    The turn runs here, above both panes: analysis activity belongs to the
    conversation and canvas activity and scene recommendations belong to the
    canvas, so neither pane can own the stream. It also means changing focus
    mode no longer unmounts an in-flight turn.
  */
  const runtime = useTurnRuntime({
    projectId,
    initialMessages,
    initialActivity,
    initialResearch,
    initialEvidenceOutcome,
  });
  /*
    The canvas draws from the server-rendered model until a turn changes
    something, at which point the server re-reads its own tables and sends the
    result. Without that, a field or assumption recorded during a turn only
    appeared after a reload — the canvas looked inert during the one moment it
    is meant to be alive.
  */
  const liveObjects = runtime.state.projectModel?.objects ?? canvasObjects;
  const liveRelationships =
    runtime.state.projectModel?.relationships ?? canvasRelationships;

  // Two-pass hydration, same pattern as the appearance provider: the server
  // renders the default layout, the client corrects from storage on mount.
  const [layout, setLayout] = useState<WorkspaceLayout | null>(null);
  const effective = layout ?? DEFAULT_LAYOUT;
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional hydration two-pass; localStorage is unavailable during SSR
    setLayout(readStoredLayout(window.localStorage));
  }, []);

  useEffect(() => {
    if (!layout) return;
    persistLayout(window.localStorage, layout);
  }, [layout]);

  const update = useCallback((patch: Partial<WorkspaceLayout>) => {
    setLayout((current) => ({ ...(current ?? DEFAULT_LAYOUT), ...patch }));
  }, []);

  const onLayoutChanged = useCallback(
    (sizes: { [id: string]: number }) => {
      const conversation = sizes["conversation"];
      if (typeof conversation !== "number") return;
      // Debounce pointer-drag updates a little to avoid storage churn.
      if (persistTimer.current) clearTimeout(persistTimer.current);
      persistTimer.current = setTimeout(
        () => update({ split: clampSplit(conversation) }),
        150,
      );
    },
    [update],
  );

  const mode = effective.mode;

  return (
    <div className="bg-surface-canvas flex h-dvh flex-col">
      <SkipLinks />
      <header className="border-edge-subtle bg-surface-primary flex h-12 shrink-0 items-center gap-2 border-b px-2">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={
            effective.navCollapsed
              ? "Show planning navigation"
              : "Hide planning navigation"
          }
          aria-pressed={!effective.navCollapsed}
          onClick={() => update({ navCollapsed: !effective.navCollapsed })}
        >
          <PanelLeftIcon aria-hidden />
        </Button>
        <Link
          href="/projects"
          className="text-fg-tertiary hover:text-fg-primary rounded-sm text-sm underline-offset-4 hover:underline"
        >
          Projects
        </Link>
        <span className="text-fg-tertiary text-sm" aria-hidden>
          /
        </span>
        <h1 className="truncate text-sm font-medium">{projectName}</h1>

        <div className="ml-auto flex items-center gap-2">
          <ToggleGroup
            type="single"
            value={mode}
            onValueChange={(value) =>
              value && update({ mode: value as FocusMode })
            }
            aria-label="Workspace focus"
          >
            <ToggleGroupItem value="conversation">Conversation</ToggleGroupItem>
            <ToggleGroupItem value="balanced">Balanced</ToggleGroupItem>
            <ToggleGroupItem value="canvas">Canvas</ToggleGroupItem>
          </ToggleGroup>
          <ActivityHistory
            lines={runtime.state.activityLog}
            truncated={activityTruncated}
          />
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Settings">
                <SettingsIcon aria-hidden />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72">
              <AppearanceSettings />
            </PopoverContent>
          </Popover>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {!effective.navCollapsed && <PlanningNav />}
        <main className="min-w-0 flex-1">
          {mode === "balanced" ? (
            <ResizablePanelGroup
              // Panel defaultSize applies only at mount; remount once the
              // stored layout has hydrated so the saved split is restored.
              key={layout ? "hydrated" : "initial"}
              orientation="horizontal"
              className="h-full"
              onLayoutChanged={onLayoutChanged}
            >
              <ResizablePanel
                id="conversation"
                defaultSize={effective.split}
                minSize={25}
              >
                <ConversationPane runtime={runtime} />
              </ResizablePanel>
              <ResizableHandle />
              <ResizablePanel
                id="canvas"
                defaultSize={100 - effective.split}
                minSize={25}
              >
                <LivingCanvas
                  objects={liveObjects}
                  relationships={liveRelationships}
                  recommendedScene={runtime.state.recommendedScene}
                  activeResearch={runtime.state.activeResearch}
                  unavailableSources={runtime.state.unavailableSources}
                  activity={runtime.state.activity.canvas}
                  onEdit={onEditObject}
                />
              </ResizablePanel>
            </ResizablePanelGroup>
          ) : mode === "conversation" ? (
            <ConversationPane runtime={runtime} />
          ) : (
            <LivingCanvas
              objects={liveObjects}
              relationships={liveRelationships}
              recommendedScene={runtime.state.recommendedScene}
              activeResearch={runtime.state.activeResearch}
              unavailableSources={runtime.state.unavailableSources}
              activity={runtime.state.activity.canvas}
              onEdit={onEditObject}
            />
          )}
        </main>
      </div>
    </div>
  );
}
