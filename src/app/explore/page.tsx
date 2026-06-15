// The landing now lives natively at the root. Keep /explore working for old
// links and bookmarks by sending it to the canonical home (a real redirect, so
// the URL consolidates and there is no duplicate content).
import { redirect } from "next/navigation";

export default function Explore() {
  redirect("/");
}
