import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { APPEARANCE_STORAGE_KEY } from "./appearance";
import { AppearanceProvider, useAppearance } from "./provider";

function ThemeSwitcher() {
  const { appearance, setAppearance } = useAppearance();
  return (
    <button onClick={() => setAppearance({ theme: "light" })}>
      theme: {appearance.theme}
    </button>
  );
}

describe("AppearanceProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: true, // OS prefers dark
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
  });

  it("applies a changed preference to the document and persists it", async () => {
    const user = userEvent.setup();
    render(
      <AppearanceProvider>
        <ThemeSwitcher />
      </AppearanceProvider>,
    );

    // Default preference is "system"; OS is dark.
    await waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe("dark"),
    );

    await user.click(screen.getByRole("button"));

    await waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe("light"),
    );
    const stored = JSON.parse(
      window.localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? "{}",
    );
    expect(stored.theme).toBe("light");
  });

  it("restores a stored preference on mount", async () => {
    window.localStorage.setItem(
      APPEARANCE_STORAGE_KEY,
      JSON.stringify({ theme: "light", density: "compact" }),
    );
    render(
      <AppearanceProvider>
        <ThemeSwitcher />
      </AppearanceProvider>,
    );
    await waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe("light"),
    );
    expect(document.documentElement.dataset.density).toBe("compact");
    expect(screen.getByRole("button")).toHaveTextContent("theme: light");
  });
});
