"use client";

import { useId } from "react";
import { useAppearance } from "@/lib/appearance/provider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

function SettingRow({
  label,
  children,
}: Readonly<{ label: string; children: React.ReactNode }>) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <span id={id} className="text-fg-secondary text-xs font-medium">
        {label}
      </span>
      <div aria-labelledby={id}>{children}</div>
    </div>
  );
}

/** The four initial user settings (DESIGN.md §18), shared by the workspace
 *  settings menu and the dev primitives review. */
export function AppearanceSettings() {
  const { appearance, setAppearance } = useAppearance();
  return (
    <div className="flex flex-col gap-4">
      <SettingRow label="Theme">
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
      </SettingRow>
      <SettingRow label="Density">
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
      </SettingRow>
      <SettingRow label="Motion">
        <ToggleGroup
          type="single"
          value={appearance.motion}
          onValueChange={(value) =>
            value &&
            setAppearance({ motion: value as typeof appearance.motion })
          }
          aria-label="Motion"
        >
          <ToggleGroupItem value="system">System</ToggleGroupItem>
          <ToggleGroupItem value="reduced">Reduced</ToggleGroupItem>
        </ToggleGroup>
      </SettingRow>
      <SettingRow label="Text size">
        <ToggleGroup
          type="single"
          value={appearance.textSize}
          onValueChange={(value) =>
            value &&
            setAppearance({ textSize: value as typeof appearance.textSize })
          }
          aria-label="Text size"
        >
          <ToggleGroupItem value="default">Default</ToggleGroupItem>
          <ToggleGroupItem value="large">Large</ToggleGroupItem>
        </ToggleGroup>
      </SettingRow>
    </div>
  );
}
