// What the Vital Signs panel must say, from what the store answered and
// whether the repo is entitled. Pure and type-only, so the client panel can use
// it. The upsell is ONLY for a repo that is not entitled and has nothing
// stored: a failed read (a 503, a timeout) never shows "locked", and an
// entitled repo whose first reading has not landed is "pending".
import type { Loaded } from "./blob-read";
import type { Vitals } from "./vitals";

export type VitalsReading =
  | { state: "data"; value: Vitals }
  | { state: "failed" }
  | { state: "pending" }
  | { state: "locked" };

export function vitalsReading(read: Loaded<Vitals>, entitled: boolean): VitalsReading {
  if (read.state === "data") return read;
  if (read.state === "failed") return { state: "failed" };
  return entitled ? { state: "pending" } : { state: "locked" };
}
