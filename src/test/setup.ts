import "@testing-library/jest-dom/vitest";

// jsdom does not implement scrollIntoView; components that keep the
// conversation pinned to the latest turn call it on every update.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
