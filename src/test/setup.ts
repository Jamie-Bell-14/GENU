import "@testing-library/jest-dom/vitest";

/*
  jsdom does not implement scrollIntoView; components that keep the
  conversation pinned to the latest turn call it on every update.

  Guarded because a few suites deliberately run in the node environment —
  server-only modules that must not load in a browser — where there is no DOM
  to patch.
*/
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
