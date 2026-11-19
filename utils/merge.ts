import {
  articleKey,
  type AccountInfo,
  type ArticleRow,
  type ScrapeResult,
} from "./scrape";

export type Catalog = {
  updated_at: string;
  source: string;
  account: {
    id: string;
    alias: string;
    nickname: string;
    raw_id: string | null;
  };
  meta: ScrapeResult["meta"];
  scrape: {
    mode: string;
    stoppedEarly: boolean;
    pages: number;
    fetched_at: string;
  };
  article_count: number;
  short_url_count: number;
  deleted_count: number;
  articles: ArticleRow[];
};

export function assertSameAccount(
  existing: Catalog | null | undefined,
  account: AccountInfo,
) {
  if (!existing?.account) return;
  const prev = existing.account;
  if (!account.id || !account.alias) {
    throw new Error("当前账号缺少公众号ID，拒绝写入以免串台。");
  }
  if (prev.id && prev.id !== account.id) {
    throw new Error(
      `防串台：目录是「${prev.nickname}」(${prev.id})，当前是「${account.nickname}」(${account.id})。已停止。`,
    );
  }
  if (prev.alias && prev.alias !== account.alias) {
    throw new Error(
      `防串台：目录 alias=${prev.alias}，当前 alias=${account.alias}。已停止。`,
    );
  }
  if (prev.nickname && prev.nickname !== account.nickname) {
    // 同 ID 改名：允许，但打日志由上层处理；这里不阻断
  }
}

export function mergeCatalog(
  existing: Catalog | null | undefined,
  scraped: ScrapeResult | null | undefined,
  account: AccountInfo,
) {
  if (!scraped || !Array.isArray(scraped.articles)) {
    throw new Error("抓取结果为空，请确认已打开发表记录且登录有效后重试");
  }
  assertSameAccount(existing, account);

  const prevArticles = Array.isArray(existing?.articles) ? existing!.articles : [];
  const map = new Map<string, ArticleRow>();
  for (const a of prevArticles) {
    const row = { ...a };
    delete row._key;
    map.set(articleKey(row), row);
  }

  let added = 0;
  let updated = 0;
  for (const raw of scraped.articles) {
    const row = { ...raw };
    const key = row._key || articleKey(row);
    delete row._key;
    if (!map.has(key)) {
      map.set(key, row);
      added += 1;
    } else {
      const old = map.get(key)!;
      map.set(key, {
        ...old,
        ...row,
        title: row.title || old.title,
        content_url:
          row.urlKind === "short" || !old.content_url
            ? row.content_url
            : old.content_url,
      });
      updated += 1;
    }
  }

  const articles = [...map.values()].sort((a, b) => {
    const ta = String(a.publishedAt || "");
    const tb = String(b.publishedAt || "");
    if (ta !== tb) return tb.localeCompare(ta);
    return String(b.msgid || "").localeCompare(String(a.msgid || ""));
  });

  const catalog: Catalog = {
    updated_at: new Date().toISOString(),
    source: "mp.weixin.qq.com/cgi-bin/appmsgpublish?sub=list",
    account: {
      id: account.id,
      alias: account.alias,
      nickname: account.nickname,
      raw_id: account.raw_id,
    },
    meta: scraped.meta || existing?.meta || null,
    scrape: {
      mode: scraped.mode,
      stoppedEarly: !!scraped.stoppedEarly,
      pages: scraped.pages,
      fetched_at: scraped.fetched_at,
    },
    article_count: articles.length,
    short_url_count: articles.filter((a) => a.urlKind === "short").length,
    deleted_count: articles.filter((a) => a.is_deleted).length,
    articles,
  };

  return { catalog, added, updated };
}
