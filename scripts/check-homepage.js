const { chromium } = require("playwright-core");

const base = process.env.BASE_URL || "http://127.0.0.1:3000";

(async () => {
  console.log("Launching browser");
  const browser = await chromium.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: true,
  });
  console.log("Browser launched");
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(15000);
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return route.continue();
    return route.abort();
  });
  await page.route("**/api/btc-price", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ amount: 100000, currency: "USD", source: "Coinbase", updatedAt: new Date().toISOString() }),
  }));
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("net::ERR_FAILED")) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  const viewports = [
    { name: "desktop", width: 1440, height: 1000 },
    { name: "mobile", width: 390, height: 844 },
    { name: "narrow", width: 320, height: 720 },
  ].filter((viewport) => !process.env.CHECK_VIEWPORT || viewport.name === process.env.CHECK_VIEWPORT);
  for (const viewport of viewports) {
    console.log(`Checking ${viewport.name}`);
    await page.setViewportSize(viewport);
    await page.goto(`${base}/index.html`, { waitUntil: "domcontentloaded" });
    console.log(`${viewport.name} loaded`);
    await page.waitForTimeout(700);
    if (viewport.name === "mobile") {
      await page.waitForTimeout(1100);
      await page.locator(".hero").screenshot({ path: "data/vanguardprime-hero-fire-mobile.png" });
    }

    await page.locator(".strategy-section").scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);

    let menuOpens = true;
    if (viewport.name !== "desktop") {
      await page.locator("[data-menu-button]").click();
      menuOpens = await page.locator("[data-menu]").evaluate((element) => getComputedStyle(element).display !== "none");
      await page.locator("[data-menu-button]").click();
    }

    let chatWorks = true;
    if (viewport.name === "desktop" || viewport.name === "mobile") {
      await page.locator("[data-chat-launcher]").click();
      chatWorks = await page.locator("[data-chat-panel]").evaluate((element) => !element.hidden && element.classList.contains("open"));
      if (viewport.name === "mobile") await page.screenshot({ path: "data/vanguardprime-home-chat-mobile.png" });
      await page.locator("[data-chat-close]").click();
    }

    const result = await page.evaluate(() => ({
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      overflowingElements: [...document.querySelectorAll("body *")].filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.right > innerWidth + 1 || rect.left < -1;
      }).slice(0, 8).map((element) => `${element.tagName.toLowerCase()}.${element.className}`),
      brokenImages: [...document.images].filter((image) => !image.complete || image.naturalWidth === 0).map((image) => image.src),
      sections: document.querySelectorAll("main > section").length,
      teamRemoved: !document.querySelector(".team-section"),
      calculatorRemoved: !document.querySelector("[data-calculator]") && !document.querySelector("[data-btc]"),
      firstStrategyValue: document.querySelector("[data-count]")?.textContent,
      activityVisible: document.querySelector("[data-activity-toast]")?.classList.contains("show"),
      partnerCentered: Math.abs(document.querySelector(".partner-row").getBoundingClientRect().x + document.querySelector(".partner-row").getBoundingClientRect().width / 2 - innerWidth / 2) < 2,
      heroContained: document.querySelector(".hero-content").getBoundingClientRect().left >= 0 && document.querySelector(".hero-content").getBoundingClientRect().right <= innerWidth,
      animatedBull: getComputedStyle(document.querySelector(".hero-media")).backgroundImage.includes("hero-bull-v2.png") && getComputedStyle(document.querySelector(".hero-media")).animationName === "bullBreath",
      fireEffect: getComputedStyle(document.querySelector(".hero-fire i")).animationName === "fireBreath",
      menuVisible: getComputedStyle(document.querySelector("[data-menu]")).display !== "none",
      loginTarget: document.querySelector('a[href="login.html"]')?.getAttribute("href"),
      registerTarget: document.querySelector('a[href="register.html"]')?.getAttribute("href"),
    }));
    result.menuOpens = menuOpens;
    result.chatWorks = chatWorks;
    console.log(viewport.name, result);
    await page.screenshot({ path: `data/vanguardprime-home-${viewport.name}.png`, fullPage: true });

    if (result.horizontalOverflow || result.brokenImages.length || !result.loginTarget || !result.registerTarget || !result.teamRemoved || !result.calculatorRemoved || result.firstStrategyValue !== "1,000.86" || !result.partnerCentered || !result.heroContained || !result.animatedBull || !result.fireEffect || !result.menuOpens || !result.chatWorks) {
      process.exitCode = 1;
    }
  }

  if (!process.env.FAST_CHECK) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/index.html`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(14500);
    const ctaVisible = await page.locator("[data-cta-modal]").evaluate((element) => !element.hidden && element.classList.contains("open"));
    console.log("timedCtaVisible", ctaVisible);
    await page.screenshot({ path: "data/vanguardprime-home-cta-mobile.png" });
    if (!ctaVisible) process.exitCode = 1;
  }

  if (errors.length) {
    console.error("Browser errors:", errors);
    process.exitCode = 1;
  }
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
