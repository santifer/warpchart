// Interval polling that stops while the tab is hidden. A background tab kept
// hitting /api/live/* every minute for nobody (and re-rendering the whole
// console on each answer). Hidden: every interval is cleared. Visible again:
// every task runs at once (the numbers on screen are caught up before anyone
// reads them) and the intervals restart from there.

export interface PollTask {
  run: () => void;
  everyMs: number;
}

type VisibilitySource = Pick<Document, "hidden" | "addEventListener" | "removeEventListener">;

// Starts polling (immediately, if the page is visible) and returns the stop
// function for an effect cleanup.
export function pollWhileVisible(tasks: PollTask[], doc: VisibilitySource = document): () => void {
  let timers: ReturnType<typeof setInterval>[] = [];
  const pause = () => {
    for (const t of timers) clearInterval(t);
    timers = [];
  };
  const resume = () => {
    pause();
    for (const task of tasks) {
      task.run();
      timers.push(setInterval(task.run, task.everyMs));
    }
  };
  const onChange = () => (doc.hidden ? pause() : resume());
  doc.addEventListener("visibilitychange", onChange);
  if (!doc.hidden) resume();
  return () => {
    doc.removeEventListener("visibilitychange", onChange);
    pause();
  };
}
