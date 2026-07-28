"use client";

import { useAppearance } from "@/lib/appearance/provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

function Section({
  title,
  children,
}: Readonly<{ title: string; children: React.ReactNode }>) {
  return (
    <section
      aria-labelledby={`section-${title}`}
      className="flex flex-col gap-3"
    >
      <h2 id={`section-${title}`} className="text-lg font-medium">
        {title}
      </h2>
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-edge-subtle bg-surface-primary p-4">
        {children}
      </div>
    </section>
  );
}

function AppearanceControls() {
  const { appearance, setAppearance } = useAppearance();
  return (
    <div className="flex flex-wrap items-center gap-4">
      <ToggleGroup
        type="single"
        value={appearance.theme}
        onValueChange={(value) =>
          value && setAppearance({ theme: value as typeof appearance.theme })
        }
        aria-label="Theme"
      >
        <ToggleGroupItem value="dark">Dark</ToggleGroupItem>
        <ToggleGroupItem value="light">Light</ToggleGroupItem>
        <ToggleGroupItem value="system">System</ToggleGroupItem>
      </ToggleGroup>
      <ToggleGroup
        type="single"
        value={appearance.density}
        onValueChange={(value) =>
          value &&
          setAppearance({ density: value as typeof appearance.density })
        }
        aria-label="Density"
      >
        <ToggleGroupItem value="comfortable">Comfortable</ToggleGroupItem>
        <ToggleGroupItem value="compact">Compact</ToggleGroupItem>
      </ToggleGroup>
      <ToggleGroup
        type="single"
        value={appearance.motion}
        onValueChange={(value) =>
          value && setAppearance({ motion: value as typeof appearance.motion })
        }
        aria-label="Motion"
      >
        <ToggleGroupItem value="system">Motion: system</ToggleGroupItem>
        <ToggleGroupItem value="reduced">Reduced</ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}

export function PrimitivesReview() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 p-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-2xl font-medium">Primitives review</h1>
        <p className="text-fg-secondary">
          Development-only reference of the re-themed shadcn primitives in every
          state. Review in both themes and with reduced motion.
        </p>
        <AppearanceControls />
      </header>

      <Section title="Button">
        <Button>Save changes</Button>
        <Button variant="secondary">Duplicate</Button>
        <Button variant="outline">Cancel</Button>
        <Button variant="ghost">Dismiss</Button>
        <Button variant="destructive">Delete project</Button>
        <Button variant="link">View history</Button>
        <Button disabled>Disabled</Button>
        <Button disabled>
          <Spinner data-icon="inline-start" />
          Saving…
        </Button>
        <Button size="sm">Small</Button>
        <Button size="lg">Large</Button>
      </Section>

      <Section title="Badge">
        <Badge>Default</Badge>
        <Badge variant="secondary">Secondary</Badge>
        <Badge variant="outline">Outline</Badge>
        <Badge variant="destructive">Contradicted</Badge>
      </Section>

      <Section title="Form fields">
        <FieldGroup className="w-full max-w-sm">
          <Field>
            <FieldLabel htmlFor="pr-name">Project name</FieldLabel>
            <Input id="pr-name" placeholder="Deposit disputes" />
            <FieldDescription>Visible only to you.</FieldDescription>
          </Field>
          <Field data-invalid>
            <FieldLabel htmlFor="pr-email">Email</FieldLabel>
            <Input id="pr-email" aria-invalid defaultValue="not-an-email" />
            <FieldDescription>Enter a valid email address.</FieldDescription>
          </Field>
          <Field data-disabled>
            <FieldLabel htmlFor="pr-locked">Locked field</FieldLabel>
            <Input id="pr-locked" disabled placeholder="Unavailable" />
          </Field>
          <Field>
            <FieldLabel htmlFor="pr-notes">Notes</FieldLabel>
            <Textarea id="pr-notes" placeholder="Ask, answer or direct…" />
          </Field>
        </FieldGroup>
      </Section>

      <Section title="Toggle group">
        <ToggleGroup type="single" defaultValue="balanced" aria-label="Layout">
          <ToggleGroupItem value="conversation">Conversation</ToggleGroupItem>
          <ToggleGroupItem value="balanced">Balanced</ToggleGroupItem>
          <ToggleGroupItem value="canvas">Canvas</ToggleGroupItem>
        </ToggleGroup>
      </Section>

      <Section title="Overlays">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline">Open dialog</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Discard draft?</DialogTitle>
              <DialogDescription>
                The unsent message will be lost.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline">Keep editing</Button>
              <Button variant="destructive">Discard</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline">Open sheet</Button>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Review changes</SheetTitle>
              <SheetDescription>
                Inspect each affected area before approving.
              </SheetDescription>
            </SheetHeader>
          </SheetContent>
        </Sheet>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline">Open popover</Button>
          </PopoverTrigger>
          <PopoverContent className="text-sm">
            Source: demonstration data, retrieved today.
          </PopoverContent>
        </Popover>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">Open menu</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Canvas object</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem>Pin</DropdownMenuItem>
              <DropdownMenuItem>Hide</DropdownMenuItem>
              <DropdownMenuItem>Re-centre</DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost">Hover for tooltip</Button>
            </TooltipTrigger>
            <TooltipContent>Compare the selected segments</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </Section>

      <Section title="Command">
        <Command className="max-w-sm rounded-md border border-edge-subtle">
          <CommandInput placeholder="Search actions…" />
          <CommandList>
            <CommandEmpty>No matching action.</CommandEmpty>
            <CommandGroup heading="Research">
              <CommandItem>Research this</CommandItem>
              <CommandItem>Inspect sources</CommandItem>
              <CommandItem>Compare segments</CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </Section>

      <Section title="Loading and structure">
        <div className="flex w-full max-w-sm flex-col gap-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Separator className="my-2" />
          <Spinner aria-label="Loading" />
        </div>
      </Section>

      <Section title="Scroll area">
        <ScrollArea className="h-24 w-full max-w-sm rounded-md border border-edge-subtle p-3 text-sm">
          {Array.from({ length: 12 }, (_, i) => (
            <p key={i} className="py-1">
              Activity entry {i + 1}: reviewing scheme annual reports…
            </p>
          ))}
        </ScrollArea>
      </Section>

      <Section title="Resizable">
        <ResizablePanelGroup
          orientation="horizontal"
          className="h-24 w-full max-w-lg rounded-md border border-edge-subtle"
        >
          <ResizablePanel defaultSize={50} className="p-3 text-sm">
            Conversation
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={50} className="p-3 text-sm">
            Canvas
          </ResizablePanel>
        </ResizablePanelGroup>
      </Section>
    </main>
  );
}
