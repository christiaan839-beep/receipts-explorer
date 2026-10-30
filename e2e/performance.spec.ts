// Copyright 2026 Christiaan de Wet / Sovereign Matrix
// SPDX-License-Identifier: Apache-2.0

// Largest Contentful Paint of every page under 1.5 s on a mid-range phone
// over fast 3G: Chrome DevTools' "Fast 3G" network profile (562.5 ms
// round trip, 1.44 Mbit/s down, 675 kbit/s up) and a CPU four times slower.
import { expect, test } from "@playwright/test";

const ROUTES = ["./", "./how-it-works/", "./terms/", "./terms/inclusion-proof/"];

test.use({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true });

for (const route of ROUTES) {
  test(`LCP of ${route} is under 1.5 s on fast 3G`, async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 562.5,
      downloadThroughput: (1.44 * 1_000_000) / 8,
      uploadThroughput: (675 * 1_000) / 8,
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.goto(route, { waitUntil: "load" });
    const lcp = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          new PerformanceObserver((list) => {
            const entries = list.getEntries();
            resolve(entries[entries.length - 1]?.startTime ?? Number.POSITIVE_INFINITY);
          }).observe({ type: "largest-contentful-paint", buffered: true });
        }),
    );
    console.log(`${route}: LCP ${lcp.toFixed(0)} ms`);
    expect(lcp).toBeLessThan(1500);
  });
}
