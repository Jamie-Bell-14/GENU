"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  applyAppearance,
  persistAppearance,
  readStoredAppearance,
  DEFAULT_APPEARANCE,
  type Appearance,
} from "./appearance";

interface AppearanceContextValue {
  appearance: Appearance;
  setAppearance: (patch: Partial<Appearance>) => void;
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

function systemPrefersDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function AppearanceProvider({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // null until hydrated: the server cannot know the stored preference, so it
  // renders defaults and the client corrects on mount (two-pass rendering,
  // matching the pre-hydration attribute script).
  const [stored, setStored] = useState<Appearance | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional hydration two-pass; localStorage is unavailable during SSR
    setStored(readStoredAppearance(window.localStorage));
  }, []);

  useEffect(() => {
    if (!stored) return;
    applyAppearance(document.documentElement, stored, systemPrefersDark());
    persistAppearance(window.localStorage, stored);
  }, [stored]);

  // Track OS theme changes while the preference is "system".
  useEffect(() => {
    if (!stored || stored.theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () =>
      applyAppearance(document.documentElement, stored, media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [stored]);

  const setAppearance = useCallback((patch: Partial<Appearance>) => {
    setStored((current) => ({ ...(current ?? DEFAULT_APPEARANCE), ...patch }));
  }, []);

  const value = useMemo(
    () => ({ appearance: stored ?? DEFAULT_APPEARANCE, setAppearance }),
    [stored, setAppearance],
  );

  return (
    <AppearanceContext.Provider value={value}>
      {children}
    </AppearanceContext.Provider>
  );
}

export function useAppearance(): AppearanceContextValue {
  const context = useContext(AppearanceContext);
  if (!context) {
    throw new Error("useAppearance must be used within AppearanceProvider");
  }
  return context;
}
