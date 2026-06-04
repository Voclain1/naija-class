import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import puppeteer, { type Browser, type Page } from "puppeteer";

// ---------------------------------------------------------------------------
// BrowserPool (Phase 2 / Slice 5 cp2) — the memory-budget control for PDF
// rendering. This is the single most failure-prone piece of the slice: a
// headless Chromium process inside the API container under the fly.io memory
// ceiling. Every design choice here is about bounding memory, not throughput.
//
// The controls, and WHY each one exists:
//
//   1. ONE browser process, lazily launched, reused across jobs. Launching
//      Chromium per card would spike RSS (each launch ~50-80MB of process
//      overhead before a single page). The queue runs concurrency 1
//      (REPORT_CARDS_QUEUE registration), so one browser is sufficient and
//      one is the maximum we will ever hold.
//
//   2. Page recycling. A long-lived Chromium leaks: each page accretes
//      renderer memory that close() does not always fully reclaim under load.
//      After PAGE_RECYCLE_LIMIT pages we tear the WHOLE browser down and
//      relaunch on the next acquire. This caps the high-water mark instead of
//      letting it climb monotonically across a 40-card batch.
//
//   3. Hard per-page timeout. withPage() races the caller's work against
//      PAGE_HARD_TIMEOUT_MS. A wedged render (a hung image fetch, a runaway
//      layout) must not pin a renderer forever — we kill the page and, to be
//      safe about renderer state, the browser too.
//
//   4. Crash isolation. If a page throws (renderer crash, protocol error) we
//      do NOT trust the browser afterwards: we relaunch. A half-dead browser
//      is worse than a cold start.
//
// The pool exposes withPage(fn): it hands a fresh Page to `fn`, guarantees the
// page is closed afterwards (success or failure), enforces the timeout, and
// recycles/relaunches per the rules above. Callers never touch Browser/Page
// lifecycle directly.
// ---------------------------------------------------------------------------

const PAGE_RECYCLE_LIMIT = 20; // relaunch the browser after this many pages
const PAGE_HARD_TIMEOUT_MS = 30_000; // kill any single render that exceeds this

// Chromium flags for a constrained container. --no-sandbox is required because
// the API container runs as a non-root user without the SUID sandbox helper;
// the renderer is fed only our own trusted, esc()-escaped HTML (no remote
// navigation), so the sandbox's threat model does not apply here. The
// --disable-dev-shm-usage flag forces Chromium off /dev/shm (64MB by default
// in containers) onto /tmp, the classic fix for "Target closed" crashes under
// memory pressure.
//
// NOT used: --single-process / --no-zygote. They shave a little RSS but make
// page.pdf() crash the renderer (empty-message protocol error) — confirmed on
// Windows dev and a known cross-platform footgun for PDF printing. Stability of
// the render wins; the page-recycle + concurrency-1 controls bound memory
// without them (see the 40-card memory gate measurement).
const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
];

export class PageTimeoutError extends Error {
  constructor(ms: number) {
    super(`report-card render exceeded hard page timeout of ${ms}ms`);
    this.name = "PageTimeoutError";
  }
}

@Injectable()
export class BrowserPool implements OnModuleDestroy {
  private readonly logger = new Logger(BrowserPool.name);
  private browser: Browser | null = null;
  private pagesRendered = 0;
  // Serialises acquisition so two concurrent callers can never race the
  // launch/relaunch logic (defensive — the queue is concurrency 1 today, but
  // the pool must not assume that).
  private launching: Promise<Browser> | null = null;

  // Run `fn` with a fresh page. The page is ALWAYS closed afterwards. On any
  // failure (including timeout) the browser is relaunched so the next job
  // starts from known-good state.
  async withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
    const browser = await this.acquireBrowser();
    let page: Page | null = null;
    try {
      page = await browser.newPage();
      this.pagesRendered += 1;
      return await this.withTimeout(fn(page), PAGE_HARD_TIMEOUT_MS);
    } catch (err) {
      // Page-level failure → distrust the whole browser. Tear it down; the
      // next acquireBrowser() cold-starts a clean one.
      await this.teardown("page failure");
      throw err;
    } finally {
      if (page) {
        await page.close().catch((e) => this.logger.warn(`page close failed: ${msg(e)}`));
      }
      // Recycle the browser once we've crossed the page budget. Done here (not
      // in the catch) so a clean run still recycles on schedule.
      if (this.browser && this.pagesRendered >= PAGE_RECYCLE_LIMIT) {
        this.logger.log(`recycling browser after ${this.pagesRendered} pages`);
        await this.teardown("recycle limit");
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.teardown("module destroy");
  }

  // ---------------------------------------------------------------------

  private async acquireBrowser(): Promise<Browser> {
    if (this.browser && this.browser.connected) return this.browser;
    if (this.launching) return this.launching;

    this.launching = (async () => {
      this.logger.log("launching headless Chromium");
      const browser = await puppeteer.launch({ headless: true, args: LAUNCH_ARGS });
      this.browser = browser;
      this.pagesRendered = 0;
      // If Chromium dies out from under us, drop our handle so the next
      // acquire relaunches rather than reusing a dead browser.
      browser.on("disconnected", () => {
        if (this.browser === browser) {
          this.browser = null;
          this.logger.warn("Chromium disconnected; will relaunch on next render");
        }
      });
      return browser;
    })();

    try {
      return await this.launching;
    } finally {
      this.launching = null;
    }
  }

  private async teardown(reason: string): Promise<void> {
    const browser = this.browser;
    this.browser = null;
    this.pagesRendered = 0;
    if (!browser) return;
    try {
      await browser.close();
    } catch (e) {
      this.logger.warn(`browser close failed (${reason}): ${msg(e)}`);
    }
  }

  private async withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new PageTimeoutError(ms)), ms);
    });
    try {
      return await Promise.race([work, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
