// Per-repo "last alerted event" watermark in the PRIVATE Blob, so the alerts
// cron pushes each milestone / overtake / record / spike exactly once. Keyed by
// lowercased repo -> ISO ts of the latest alerted event. Best-effort: a read
// miss is an empty map (the cron then alerts from a recent baseline), a write
// failure is swallowed (the next run retries). Server-side only.
import { get, put } from "@vercel/blob";

const KEY = "alerts/sent.json";

export type AlertsSent = Record<string, string>;

export async function readAlertsSent(): Promise<AlertsSent> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return {};
  try {
    // useCache:false: the writer reads its own latest watermark each run.
    const res = await get(KEY, { access: "private", token, useCache: false });
    if (res?.statusCode === 200 && res.stream) {
      return JSON.parse(await new Response(res.stream).text()) as AlertsSent;
    }
  } catch {
    /* first run / transient */
  }
  return {};
}

export async function saveAlertsSent(map: AlertsSent): Promise<boolean> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return false;
  try {
    await put(KEY, JSON.stringify(map), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      token,
    });
    return true;
  } catch {
    return false;
  }
}
