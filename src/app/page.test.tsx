import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Landing } from "./page";

describe("Landing", () => {
  it("renders the product name as the page heading", () => {
    render(<Landing />);
    expect(
      screen.getByRole("heading", { name: "Intelligent Product Lab" }),
    ).toBeInTheDocument();
  });

  it("offers sign-in and sign-up paths", () => {
    render(<Landing />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/sign-in",
    );
    expect(
      screen.getByRole("link", { name: "Create account" }),
    ).toHaveAttribute("href", "/sign-up");
  });
});
