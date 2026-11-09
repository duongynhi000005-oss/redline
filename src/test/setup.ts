import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { resetApp } from "../state/app";

// jsdom has no layout. Give elements a size so the virtualized issue list
// renders rows, and stub the observers it uses.
Object.defineProperties(HTMLElement.prototype, {
  offsetHeight: { configurable: true, get: () => 800 },
  offsetWidth: { configurable: true, get: () => 1000 },
  clientHeight: { configurable: true, get: () => 800 },
  clientWidth: { configurable: true, get: () => 1000 },
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= function scrollIntoView() {};
Element.prototype.scrollTo ??= function scrollTo() {} as Element["scrollTo"];

afterEach(() => {
  cleanup();
  resetApp();
  localStorage.clear();
});
