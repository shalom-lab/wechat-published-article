import { readByok } from "./byok";
import {
  accountDir,
  getFile,
  getJsonFile,
  putJsonFile,
  putTextFile,
  upsertIndexAccount,
} from "./github";
import { assertSameAccount, mergeCatalog, type Catalog } from "./merge";
import {
  DETECT_ACCOUNT_SOURCE,
  SCRAPE_SOURCE,
  articleKey,
  toCsv,
  type AccountInfo,
  type ScrapeResult,
} from "./scrape";

async function findMpTab() {
  const [focused] = await browser.tabs.query({
    active: true,
    currentWindow: true,
    url: ["https://mp.weixin.qq.com/*"],
  });
  if (focused) return focused;
  const tabs = await browser.tabs.query({
    url: ["https://mp.weixin.qq.com/*"],
  });
  return tabs[0] || null;
}

function waitTabComplete(tabId: number, timeoutMs = 20000) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      browser.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error("页面加载超时"));
    }, timeoutMs);
    function onUpdated(id: number, info: { status?: string }) {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timer);
        browser.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    }
    browser.tabs.onUpdated.addListener(onUpdated);
    browser.tabs.get(tabId).then((t) => {
      if (t.status === "complete") {
        clearTimeout(timer);
        browser.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    });
  });
}

function extractTokenFromTab(tab: { url?: string }) {
  const m = String(tab.url || "").match(/[?&]token=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

async function detectAccount(tabId: number): Promise<AccountInfo> {
  let lastError = "无法识别当前公众号";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const [injected] = await browser.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: async (code: string) => {
          const fn = (0, eval)(`(${code})`) as () => Promise<AccountInfo>;
          return await fn();
        },
        args: [DETECT_ACCOUNT_SOURCE],
      });
      const result = injected?.result as AccountInfo | undefined;
      if (!result?.id || !result.alias || !result.nickname) {
        throw new Error("设置页未解析到完整的「公众号ID + 名称」");
      }
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
  throw new Error(`${lastError}。请确认已登录后台后重试。`);
}

async function ensurePublishListTab(
  tab: { id?: number; url?: string },
  token: string,
) {
  if (!tab?.id) throw new Error("标签页无效");
  const url = tab.url || "";
  if (/appmsgpublish/i.test(url) && /token=/i.test(url)) return tab;

  const target =
    `https://mp.weixin.qq.com/cgi-bin/appmsgpublish?sub=list&begin=0&count=10&token=${encodeURIComponent(token)}&lang=zh_CN`;
  await browser.tabs.update(tab.id, { url: target });
  await waitTabComplete(tab.id);
  return browser.tabs.get(tab.id);
}

async function runInPage(
  tabId: number,
  source: string,
  args: Record<string, unknown>,
) {
  const [injected] = await browser.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (code: string, opts: Record<string, unknown>) => {
      const fn = (0, eval)(`(${code})`) as (
        o: Record<string, unknown>,
      ) => Promise<ScrapeResult>;
      return await fn(opts);
    },
    args: [source, args],
  });
  return injected?.result as ScrapeResult;
}

export type SyncSummary = {
  ok: true;
  mode: string;
  account: AccountInfo;
  added: number;
  updated: number;
  total: number;
  stoppedEarly: boolean;
  pages: number;
  paths: { catalogPath: string; csvPath: string; metaPath: string };
  urls: {
    catalogJson: string;
    catalogCsv: string;
    metaJson: string;
    accountDir: string;
  };
  repo: string;
};

function githubBlobUrl(repo: string, path: string, branch = "main") {
  return `https://github.com/${repo}/blob/${branch}/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

function githubTreeUrl(repo: string, path: string, branch = "main") {
  return `https://github.com/${repo}/tree/${branch}/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

export async function syncPublishCatalog(options: {
  mode?: "incremental" | "full";
  onProgress?: (msg: string) => void;
} = {}): Promise<SyncSummary> {
  const mode = options.mode === "full" ? "full" : "incremental";
  const log = options.onProgress || (() => {});

  const { repo, token: ghToken } = await readByok();
  if (!repo || !ghToken) {
    throw new Error("请先在侧栏「设置」填写 GitHub 仓库和 Token（BYOK）");
  }

  log("查找公众号后台标签页…");
  let tab = await findMpTab();
  if (!tab?.id) throw new Error("请先打开并登录 https://mp.weixin.qq.com");

  log("从设置页读取「公众号ID + 名称」…");
  const account = await detectAccount(tab.id);
  log(
    `当前账号：${account.nickname} · 公众号ID=${account.alias}` +
      (account.raw_id ? ` · 原始ID=${account.raw_id}` : "") +
      ` · 目录=accounts/${account.id}/`,
  );

  const mpToken = account.token || extractTokenFromTab(tab);
  if (!mpToken) {
    throw new Error("缺少后台 token，请打开任意带 token 的公众号后台页");
  }

  log("准备发表记录页…");
  tab = await ensurePublishListTab(tab, mpToken);
  if (!tab.id) throw new Error("标签页无效");

  const dir = accountDir(account.id);
  const catalogPath = `${dir}/catalog.json`;
  const csvPath = `${dir}/catalog.csv`;
  const metaPath = `${dir}/meta.json`;

  log(`读取仓库已有目录：${catalogPath}`);
  const existingFile = await getJsonFile<Catalog>(repo, ghToken, catalogPath);
  const existing = existingFile.data;
  assertSameAccount(existing, account);

  const knownKeys =
    mode === "full" ? [] : (existing?.articles || []).map((a) => articleKey(a));

  log(
    mode === "full"
      ? "全量抓取发表记录…"
      : `增量抓取（已有 ${knownKeys.length} 条）…`,
  );
  const scraped = await runInPage(tab.id, SCRAPE_SOURCE, {
    mode,
    knownKeys,
    count: 20,
    delayMs: 100,
    token: mpToken,
  });
  if (!scraped || !Array.isArray(scraped.articles)) {
    throw new Error("抓取结果为空，请确认发表记录页已打开后重试");
  }

  log("合并并写回 GitHub…");
  const { catalog, added, updated } = mergeCatalog(existing, scraped, account);

  await putJsonFile(
    repo,
    ghToken,
    catalogPath,
    catalog,
    `chore(wpa): sync ${account.alias} (+${added})`,
    existingFile.sha,
  );

  const csvMeta = await getFile(repo, ghToken, csvPath);
  await putTextFile(
    repo,
    ghToken,
    csvPath,
    toCsv(catalog.articles),
    `chore(wpa): csv ${account.alias}`,
    csvMeta.sha,
  );

  const metaFile = await getJsonFile(repo, ghToken, metaPath);
  const meta = {
    id: account.id,
    alias: account.alias,
    nickname: account.nickname,
    raw_id: account.raw_id,
    identity_source: account.source,
    updatedAt: catalog.updated_at,
    article_count: catalog.article_count,
    short_url_count: catalog.short_url_count,
    deleted_count: catalog.deleted_count,
    last_scrape: catalog.scrape,
  };
  await putJsonFile(
    repo,
    ghToken,
    metaPath,
    meta,
    `chore(wpa): meta ${account.alias}`,
    metaFile.sha,
  );

  await upsertIndexAccount(repo, ghToken, {
    id: account.id,
    nickname: account.nickname,
    fakeid: account.raw_id,
    updatedAt: catalog.updated_at,
    article_count: catalog.article_count,
  });

  const urls = {
    catalogJson: githubBlobUrl(repo, catalogPath),
    catalogCsv: githubBlobUrl(repo, csvPath),
    metaJson: githubBlobUrl(repo, metaPath),
    accountDir: githubTreeUrl(repo, dir),
  };

  const summary: SyncSummary = {
    ok: true,
    mode,
    account,
    added,
    updated,
    total: catalog.article_count,
    stoppedEarly: scraped.stoppedEarly,
    pages: scraped.pages,
    paths: { catalogPath, csvPath, metaPath },
    urls,
    repo,
  };
  log(
    `完成：${account.nickname}（${account.alias}）新增 ${added}，合计 ${catalog.article_count}` +
      (scraped.stoppedEarly ? "（增量早停）" : ""),
  );
  return summary;
}
