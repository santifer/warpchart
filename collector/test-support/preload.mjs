// node --import this file: installs the hooks, and answers fetch() from the
// stub file's `fetch` map ({ "url substring": json }). Anything unmatched is a
// 404, so a script under test never reaches the network.
import { register } from "node:module";
import { readFileSync } from "node:fs";

register("./hooks.mjs", import.meta.url);

globalThis.fetch = async (url) => {
  const routes = JSON.parse(readFileSync(process.env.BLOB_STUB, "utf8")).fetch ?? {};
  for (const [match, body] of Object.entries(routes)) {
    if (String(url).includes(match)) return Response.json(body);
  }
  return new Response("not stubbed", { status: 404 });
};
