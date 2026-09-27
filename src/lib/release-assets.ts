// What a "release download" is. GitHub counts downloads per release ASSET, and
// many repos attach files that are not the software: an SBOM, checksums,
// signatures, provenance. career-ops-v1.34.0 showed "17 release downloads"
// that were 17 fetches of career-ops-sbom.spdx.json, most likely by security
// scanners, not people installing anything (26-sep-2026). Only software counts.
// (GitHub's auto-generated "Source code" zip/tar.gz is not an asset and has no
// count at all: it can never appear here.)
const METADATA = [
  /\.spdx(\.json)?$/i, // SBOM (SPDX)
  /\.cdx(\.json|\.xml)?$/i, // SBOM (CycloneDX)
  /sbom/i,
  /\.(sig|asc|pem|crt|cert|minisig)$/i, // signatures, certificates
  /\.intoto\.jsonl$/i, // provenance / attestations
  /provenance/i,
  /(^|[._-])(checksums?|sha(1|256|512)?sums?)([._-]|$)/i,
  /\.(sha1|sha256|sha512|md5)$/i,
];

export const isMetadataAsset = (name: string) => METADATA.some((re) => re.test(name));

export function softwareDownloads(assets: { name?: string | null; downloadCount: number }[]): number {
  return assets.reduce((sum, a) => (a.name && isMetadataAsset(a.name) ? sum : sum + a.downloadCount), 0);
}

// "career-ops-v1.34.0" -> "v1.34.0": the repo name repeated in every tag eats
// the narrow column and the version got cut off. Full tag stays in the tooltip.
export function shortTag(tag: string): string {
  const m = tag.match(/v?\d+(\.\d+)+[\w.+-]*$/);
  return m ? m[0] : tag;
}
