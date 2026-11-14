import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pollWhileVisible } from "@/lib/visible-poll";

// LiveProvider's polling: a hidden tab polled /api/live/* every minute for
// nobody. Hidden pauses every interval; visible again polls at once.

class FakeDoc extends EventTarget {
  hidden = false;
  set(hidden: boolean) {
    this.hidden = hidden;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("pollWhileVisible", () => {
  it("polls at once and on every interval while visible", () => {
    const doc = new FakeDoc();
    const fast = vi.fn();
    const slow = vi.fn();
    pollWhileVisible([{ run: fast, everyMs: 60_000 }, { run: slow, everyMs: 300_000 }], doc);
    expect(fast).toHaveBeenCalledTimes(1);
    expect(slow).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(300_000);
    expect(fast).toHaveBeenCalledTimes(6);
    expect(slow).toHaveBeenCalledTimes(2);
  });

  it("sends nothing while the tab is hidden, and catches up the moment it shows", () => {
    const doc = new FakeDoc();
    const fast = vi.fn();
    pollWhileVisible([{ run: fast, everyMs: 60_000 }], doc);
    doc.set(true);
    vi.advanceTimersByTime(30 * 60_000);
    expect(fast).toHaveBeenCalledTimes(1); // only the initial poll
    doc.set(false);
    expect(fast).toHaveBeenCalledTimes(2); // immediately, not a minute later
    vi.advanceTimersByTime(60_000);
    expect(fast).toHaveBeenCalledTimes(3); // and the interval is back
  });

  it("waits for the first show when the page opens in a background tab", () => {
    const doc = new FakeDoc();
    doc.hidden = true;
    const fast = vi.fn();
    pollWhileVisible([{ run: fast, everyMs: 60_000 }], doc);
    vi.advanceTimersByTime(10 * 60_000);
    expect(fast).not.toHaveBeenCalled();
    doc.set(false);
    expect(fast).toHaveBeenCalledTimes(1);
  });

  it("stops for good on cleanup, visibility changes included", () => {
    const doc = new FakeDoc();
    const fast = vi.fn();
    const stop = pollWhileVisible([{ run: fast, everyMs: 60_000 }], doc);
    stop();
    doc.set(true);
    doc.set(false);
    vi.advanceTimersByTime(10 * 60_000);
    expect(fast).toHaveBeenCalledTimes(1);
  });

  it("does not stack intervals when visible fires twice in a row", () => {
    const doc = new FakeDoc();
    const fast = vi.fn();
    pollWhileVisible([{ run: fast, everyMs: 60_000 }], doc);
    doc.set(false);
    doc.set(false);
    fast.mockClear();
    vi.advanceTimersByTime(60_000);
    expect(fast).toHaveBeenCalledTimes(1);
  });
});
