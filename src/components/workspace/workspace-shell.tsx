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
import type { CanvasObject } from "@/lib/canvas/model";
import type { Message } from "@/lib/ai/turn-events";
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
  canvasObjects = [],
}: Readonly<{
  projectId: string;
  projectName: string;
  initialMessages?: Message[];
  canvasObjects?: CanvasObject[];
}>) {
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
                <ConversationPane
                  projectId={projectId}
                  initialMessages={initialMessages}
                />
              </ResizablePanel>
              <ResizableHandle />
              <ResizablePanel
                id="canvas"
                defaultSize={100 - effective.split}
                minSize={25}
              >
                <LivingCanvas objects={canvasObjects} />
              </ResizablePanel>
            </ResizablePanelGroup>
          ) : mode === "conversation" ? (
            <ConversationPane
              projectId={projectId}
              initialMessages={initialMessages}
            />
          ) : (
            <LivingCanvas objects={canvasObjects} />
          )}
        </main>
      </div>
    </div>
  );
}
