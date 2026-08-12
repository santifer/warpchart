// GitHub avatar URLs, from the CDN and never through the github.com redirect.
//
// `https://github.com/{login}.png` is NOT an image. It is a 302 to
// avatars.githubusercontent.com, served with `cache-control: no-cache` and
// `vary: Sec-Fetch-Site`, so every visitor re-walks the redirect on every view
// and the result depends on how that client handles a cross-site hop.
//
// On 2026-08-12 the Vital Signs contributor row rendered as seven broken-image
// placeholders on iOS while loading perfectly in headless Chromium. A browser
// split like that is the signature of a redirect failing, not of a missing
// image, and it had been shipped in eleven places because each one wrote the
// URL inline. This module exists so there is one place to be wrong.
//
// avatars.githubusercontent.com accepts the LOGIN directly - no numeric id
// lookup - and answers in one hop with `max-age=300`.
//
// `s` is what the CDN calls the size param (the github.com path used `size`).
// GitHub serves the nearest power-of-two square at or above the request, so
// asking for the DISPLAY size is enough; ask for 2x when it must stay crisp on
// a retina screen.
export const ghAvatar = (login: string, size = 48) =>
  `https://avatars.githubusercontent.com/${encodeURIComponent(login)}?s=${size}`;

// The owner half of "owner/name". Several call sites had their own inline
// split; sharing it keeps a malformed repo string from producing a URL like
// `.../undefined`.
export const ghAvatarForRepo = (repo: string, size = 48) =>
  ghAvatar(repo.split("/")[0] ?? "", size);
