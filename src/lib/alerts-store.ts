// Per-repo "last alerted event" watermark in the PRIVATE Blob, so the alerts
// cron pushes each milestone / overtake / record / spike exactly once. Keyed by
// lowercased repo -> ISO ts of the latest alerted event. A missing store (404)
// is an empty map (the cron then alerts from a recent baseline); a store that
// cannot be read THROWS: read as empty, every repo would fall back to that
// baseline and re-send the last 24 h of alerts. Server-side only.
import { readJsonStrict, updateJson, keepsEveryKey } from "./blob";

const KEY = "alerts/sent.json";

export type AlertsSent = Record<string, string>;

export async function readAlertsSent(): Promise<AlertsSent> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return {};
  const r = await readJsonStrict<AlertsSent>(KEY);
  return r.state === "data" ? r.value : {};
}

// Merged into the stored map at write time: a repo is never dropped and a
// watermark only moves forward, whatever this run read or another run wrote.
// A failure is swallowed (the next run retries).
export async function saveAlertsSent(map: AlertsSent): Promise<boolean> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return false;
  try {
    await updateJson<AlertsSent>(KEY, (stored) => {
      const next = { ...(stored ?? {}) };
      for (const [repo, ts] of Object.entries(map)) if (!(next[repo] >= ts)) next[repo] = ts;
      keepsEveryKey(stored, next, KEY);
      return next;
    });
    return true;
  } catch {
    return false;
  }
}
