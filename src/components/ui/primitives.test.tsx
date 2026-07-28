import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge } from "./badge";
import { Button } from "./button";
import { Field, FieldLabel } from "./field";
import { Input } from "./input";
import { Spinner } from "./spinner";

describe("Button", () => {
  it("exposes its variant and size for the base styles", () => {
    render(
      <Button variant="destructive" size="sm">
        Delete
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Delete" });
    expect(button).toHaveAttribute("data-variant", "destructive");
    expect(button).toHaveAttribute("data-size", "sm");
    expect(button.className).toContain("cn-button-variant-destructive");
    expect(button.className).toContain("cn-button-size-sm");
  });

  it("keeps the token-driven focus ring classes from the base styles", () => {
    render(<Button>Save</Button>);
    // Focus visibility comes from .cn-button (focus-visible:ring-ring/50,
    // focus-visible:border-ring) — assert the hook class is present so a
    // re-theme cannot silently drop focus states.
    expect(screen.getByRole("button").className).toContain("cn-button");
  });

  it("supports a loading composition with Spinner and disabled", () => {
    render(
      <Button disabled>
        <Spinner data-icon="inline-start" />
        Saving…
      </Button>,
    );
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  });
});

describe("Badge", () => {
  it("renders variants through the base style classes", () => {
    render(<Badge variant="outline">Estimate</Badge>);
    const badge = screen.getByText("Estimate");
    expect(badge.className).toContain("cn-badge-variant-outline");
  });
});

describe("Field validation state", () => {
  it("pairs data-invalid on the field with aria-invalid on the control", () => {
    render(
      <Field data-invalid>
        <FieldLabel htmlFor="email">Email</FieldLabel>
        <Input id="email" aria-invalid />
      </Field>,
    );
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.closest("[data-invalid]")).not.toBeNull();
  });
});
