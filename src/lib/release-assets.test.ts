import { describe, expect, it } from "vitest";
import { isMetadataAsset, shortTag, softwareDownloads } from "@/lib/release-assets";

describe("release downloads count software, not metadata", () => {
  // 26-sep-2026: career-ops-v1.34.0 showed "17 release downloads"; the only
  // asset was the SBOM, fetched 17 times (scanners, not installs).
  it("does not count an SBOM as a download of the software", () => {
    expect(softwareDownloads([{ name: "career-ops-sbom.spdx.json", downloadCount: 17 }])).toBe(0);
  });

  it("counts real binaries and skips checksums, signatures and provenance", () => {
    const assets = [
      { name: "tool-darwin-arm64.tar.gz", downloadCount: 120 },
      { name: "tool_1.2.0_windows_amd64.zip", downloadCount: 30 },
      { name: "checksums.txt", downloadCount: 90 },
      { name: "tool-darwin-arm64.tar.gz.sig", downloadCount: 40 },
      { name: "SHA256SUMS", downloadCount: 5 },
      { name: "multiple.intoto.jsonl", downloadCount: 3 },
      { name: "bom.cdx.json", downloadCount: 2 },
    ];
    expect(softwareDownloads(assets)).toBe(150);
  });

  it("does not mistake a normal binary for metadata", () => {
    for (const n of ["app.dmg", "app-setup.exe", "plugin.zip", "cli-linux-x64", "app.AppImage"]) {
      expect(isMetadataAsset(n)).toBe(false);
    }
  });
});

describe("shortTag", () => {
  it("drops the repo name the column had no room for", () => {
    expect(shortTag("career-ops-v1.34.0")).toBe("v1.34.0");
    expect(shortTag("web-v0.12.0")).toBe("v0.12.0");
    expect(shortTag("v2.0.0-rc.1")).toBe("v2.0.0-rc.1");
    expect(shortTag("nightly")).toBe("nightly");
  });
});
