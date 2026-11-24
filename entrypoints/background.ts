import { syncPublishCatalog } from "../utils/sync";

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    if (browser.sidePanel?.setPanelBehavior) {
      browser.sidePanel
        .setPanelBehavior({ openPanelOnActionClick: true })
        .catch(() => {});
    }
  });

  async function runSync(mode: "incremental" | "full" = "incremental") {
    const logs: string[] = [];
    browser.runtime
      .sendMessage({ type: "wpa:start", mode })
      .catch(() => {});
    try {
      const summary = await syncPublishCatalog({
        mode,
        onProgress: (msg) => {
          logs.push(msg);
          browser.runtime
            .sendMessage({ type: "wpa:progress", message: msg })
            .catch(() => {});
        },
      });
      browser.runtime.sendMessage({ type: "wpa:done", summary }).catch(() => {});
      return { ok: true as const, summary, logs };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      browser.runtime
        .sendMessage({ type: "wpa:error", message })
        .catch(() => {});
      return { ok: false as const, error: message, logs };
    }
  }

  browser.commands.onCommand.addListener(async (command) => {
    if (command !== "sync-publish-catalog") return;
    try {
      const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tab?.windowId != null) {
        await browser.sidePanel.open({ windowId: tab.windowId });
      }
    } catch {
      /* ignore */
    }
    await runSync("incremental");
  });

  browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg !== "object") return undefined;
    const m = msg as { type?: string; mode?: string };
    if (m.type === "wpa:sync") {
      runSync(m.mode === "full" ? "full" : "incremental").then(sendResponse);
      return true;
    }
    return undefined;
  });
});
