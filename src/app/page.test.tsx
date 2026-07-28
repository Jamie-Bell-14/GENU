import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Home from "./page";

describe("Home", () => {
  it("renders the product name as the page heading", () => {
    render(<Home />);
    expect(
      screen.getByRole("heading", { name: "Intelligent Product Lab" }),
    ).toBeInTheDocument();
  });
});
