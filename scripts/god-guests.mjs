// Lists and revokes guest keys (src/lib/guest-keys.ts). A guest key is stored
// only as god/guests/{sha256}.json; deleting that file revokes it on the next
// request (the APIs read it with useCache:false).
//
// Usage: BLOB_READ_WRITE_TOKEN=... node scripts/god-guests.mjs list
//        BLOB_READ_WRITE_TOKEN=... node scripts/god-guests.mjs revoke <name>
import { list, get, del } from "@vercel/blob";
import { GUEST_PREFIX } from "./magic-key.mjs";

const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) {
  console.error("needs BLOB_READ_WRITE_TOKEN");
  process.exit(1);
}
const [cmd, name] = process.argv.slice(2);
const { blobs } = await list({ prefix: GUEST_PREFIX, token });
const grants = [];
for (const b of blobs) {
  const r = await get(b.pathname, { access: "private", token, useCache: false });
  const g = r?.statusCode === 200 ? JSON.parse(await new Response(r.stream).text()) : null;
  grants.push({ path: b.pathname, url: b.url, g });
}
if (cmd === "list") {
  for (const { path, g } of grants) console.log(`${g?.name ?? "?"}\t${(g?.repos ?? []).join(",")}\tvault=${g?.vault}\t${g?.createdAt ?? ""}\t${path.slice(GUEST_PREFIX.length, GUEST_PREFIX.length + 12)}…`);
  if (!grants.length) console.log("no guest keys");
} else if (cmd === "revoke" && name) {
  const hit = grants.filter((x) => x.g?.name === name);
  if (!hit.length) {
    console.error(`no guest key named ${name}`);
    process.exit(1);
  }
  await del(hit.map((x) => x.url), { token });
  console.log(`revoked ${hit.length} guest key(s) for ${name}`);
} else {
  console.error("usage: list | revoke <name>");
  process.exit(1);
}
