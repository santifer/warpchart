// /api/traffic's answer, read as TrafficPanel must say it. Only 400/401/403
// mean the key was refused. A 5xx means the store did not answer: reading that
// as a rejection put a FORGET KEY button in front of a valid key. Pure, so the
// client panel and its test share it.
export function vaultFailure(status: number): null | "denied" | "unavailable" {
  if (status >= 200 && status < 300) return null;
  if (status === 400 || status === 401 || status === 403) return "denied";
  return "unavailable";
}
