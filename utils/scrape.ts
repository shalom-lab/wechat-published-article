export type ArticleRow = {
  title: string;
  publishedAt: string | null;
  publishedDate: string | null;
  content_url: string;
  urlKind: string;
  is_deleted: boolean;
  private_type: number | null;
  msgid: number | string | null;
  appmsgid: number | string | null;
  itemidx: number;
  publish_type: number | null;
  publish_type_label: string;
  group_index?: number;
  position?: number;
  _key?: string;
};

export type AccountInfo = {
  /** 仓库子目录名 = 设置页「公众号ID」，如 epi-stats */
  id: string;
  /** 设置页「名称」，如 R语言与可视化 */
  nickname: string;
  /** 设置页「公众号ID」原文 */
  alias: string;
  /** 原始 ID，如 gh_ae9cddca4679 */
  raw_id: string | null;
  token: string | null;
  href: string;
  source: string;
};

export type ScrapeResult = {
  fetched_at: string;
  mode: string;
  stoppedEarly: boolean;
  pages: number;
  meta: {
    total_count?: number;
    publish_count?: number;
    masssend_count?: number;
  } | null;
  articles: ArticleRow[];
};

export function articleKey(a: Partial<ArticleRow>): string {
  if (a?.content_url && !String(a.content_url).includes("tempkey=")) {
    return `url:${a.content_url}`;
  }
  return `id:${a?.msgid ?? ""}:${a?.itemidx ?? ""}:${a?.title ?? ""}`;
}

/**
 * 在已登录后台页执行：先拉 settingpage，解析「名称 + 公众号ID」。
 * 目录唯一键 = 公众号ID（如 epi-stats）。
 */
export const DETECT_ACCOUNT_SOURCE = `async () => {
  function text(el) {
    return (el && el.textContent || "").replace(/\\s+/g, " ").trim();
  }
  function cleanAlias(s) {
    return String(s || "")
      .replace(/<!--[\\s\\S]*?-->/g, "")
      .replace(/\\s+/g, "")
      .trim();
  }
  function getToken() {
    const fromUrl = new URLSearchParams(location.search).get("token");
    if (fromUrl) return fromUrl;
    const a = document.querySelector('a[href*="token="]');
    if (a && a.href) {
      try { return new URL(a.href, location.origin).searchParams.get("token"); }
      catch (e) {}
    }
    return "";
  }
  function parseSettingHtml(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    let nickname = "";
    let alias = "";
    const items = doc.querySelectorAll(".weui-desktop-setting__item");
    items.forEach((li) => {
      const labelEl = li.querySelector(".weui-desktop-setting__item__label");
      const label = text(labelEl);
      if (!label) return;
      if (/^名称/.test(label) && !/公众号ID/.test(label)) {
        const info = li.querySelector(".weui-desktop-setting__item__info");
        const n = text(info);
        if (n) nickname = n;
      }
      if (/公众号ID/.test(label)) {
        const info =
          li.querySelector(".js_setting_alias") ||
          li.querySelector(".weui-desktop-setting__item__info");
        const a = cleanAlias(info ? info.textContent : "");
        if (a) alias = a;
      }
    });
    if (!alias) {
      const el = doc.querySelector(".js_setting_alias");
      alias = cleanAlias(el ? el.textContent : "");
    }
    const rawMatch = html.match(/原始\\s*ID\\s*[：:]\\s*(gh_[a-zA-Z0-9]+)/);
    const raw_id = rawMatch ? rawMatch[1] : "";
    return { nickname, alias, raw_id };
  }

  const token = getToken();
  if (!token) {
    throw new Error("页面缺少 token，请先打开已登录的公众号后台任意页");
  }

  const settingUrl =
    "https://mp.weixin.qq.com/cgi-bin/settingpage?t=setting/index&action=index&token=" +
    encodeURIComponent(token) +
    "&lang=zh_CN";
  const res = await fetch(settingUrl, { credentials: "include" });
  if (!res.ok) throw new Error("打开设置页失败 HTTP " + res.status);
  const html = await res.text();
  if (!html.includes("weui-desktop-setting") && !html.includes("js_setting_alias")) {
    throw new Error("设置页未返回账号信息（登录可能失效），请重新登录后台");
  }

  const parsed = parseSettingHtml(html);
  const alias = parsed.alias;
  const nickname = parsed.nickname;
  if (!alias) {
    throw new Error("设置页未解析到「公众号ID」。请打开 设置→账号设置 确认后重试");
  }
  if (!nickname) {
    throw new Error("设置页未解析到「名称」。请打开 设置→账号设置 确认后重试");
  }
  // 公众号ID 作目录名：仅允许安全字符
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(alias)) {
    throw new Error("公众号ID「" + alias + "」格式异常，拒绝作为目录名");
  }

  return {
    id: alias,
    alias,
    nickname,
    raw_id: parsed.raw_id || null,
    token,
    href: settingUrl,
    source: "settingpage",
  };
}`;

export const SCRAPE_SOURCE = `async (opts = {}) => {
  const mode = opts.mode === "full" ? "full" : "incremental";
  const knownKeys = new Set(opts.knownKeys || []);
  const count = Number(opts.count) || 20;
  const delayMs = Number(opts.delayMs) || 100;

  function extractPublishPage(html) {
    const marker = "publish_page = ";
    const i = html.indexOf(marker);
    if (i < 0) throw new Error("publish_page not found（请打开「发表记录」或重新登录）");
    let j = i + marker.length, depth = 0, inStr = false, esc = false, end = -1;
    for (let k = j; k < html.length; k++) {
      const c = html[k];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) { end = k + 1; break; }
      }
    }
    if (end < 0) throw new Error("unterminated publish_page");
    return (new Function("return (" + html.slice(j, end) + ")"))();
  }
  function decodeHtml(s) {
    return String(s || "")
      .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'");
  }
  function normalizeUrl(url) {
    let u = decodeHtml(url).trim();
    if (!u) return "";
    u = u.replace(/^http:\\/\\//, "https://");
    const short = u.match(/^(https:\\/\\/mp\\.weixin\\.qq\\.com\\/s\\/[A-Za-z0-9_-]+)(?:[?#].*)?$/);
    if (short) return short[1];
    try {
      const p = new URL(u);
      if (p.pathname === "/s" || p.pathname === "/s/") {
        const biz = p.searchParams.get("__biz"), mid = p.searchParams.get("mid");
        const idx = p.searchParams.get("idx"), sn = p.searchParams.get("sn");
        if (biz && mid && idx && sn) {
          return "https://mp.weixin.qq.com/s?__biz=" + biz + "&mid=" + mid + "&idx=" + idx + "&sn=" + sn;
        }
      }
    } catch (e) {}
    return u.split("#")[0];
  }
  function urlKindOf(url) {
    if (!url) return "missing";
    if (/^https:\\/\\/mp\\.weixin\\.qq\\.com\\/s\\/[A-Za-z0-9_-]+$/.test(url)) return "short";
    if (/tempkey=/.test(url)) return "tempkey";
    return "long";
  }
  function publishTypeLabel(t) {
    if (t === 1) return "发布";
    if (t === 101) return "群发";
    return t == null ? "" : String(t);
  }
  function toIso(ts) {
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return null;
    return new Date(n * 1000).toISOString();
  }
  function toDateCn(ts) {
    const iso = toIso(ts);
    if (!iso) return null;
    const d = new Date(iso);
    return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
  }
  function parseInfo(item) {
    let info = item.publish_info;
    if (typeof info === "string") info = JSON.parse(decodeHtml(info));
    return info;
  }
  function articleKey(a) {
    if (a && a.content_url && !String(a.content_url).includes("tempkey=")) return "url:" + a.content_url;
    return "id:" + (a && a.msgid != null ? a.msgid : "") + ":" + (a && a.itemidx != null ? a.itemidx : "") + ":" + (a && a.title ? a.title : "");
  }

  let token = new URLSearchParams(location.search).get("token") || (opts.token || "");
  if (!token) {
    const a = document.querySelector('a[href*="token="]');
    if (a) token = new URL(a.href, location.origin).searchParams.get("token");
  }
  if (!token) throw new Error("页面缺少 token，请先打开公众号后台任意带 token 的页面");

  const articles = [];
  let meta = null, begin = 0, pages = 0, stoppedEarly = false;

  while (true) {
    const url = "https://mp.weixin.qq.com/cgi-bin/appmsgpublish?sub=list&begin=" + begin
      + "&count=" + count + "&token=" + encodeURIComponent(token) + "&lang=zh_CN";
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) throw new Error("HTTP " + res.status + " at begin=" + begin);
    const html = await res.text();
    if (!html.includes("publish_page")) throw new Error("登录态失效或无发表记录权限");
    const page = extractPublishPage(html);
    if (!meta) {
      meta = {
        total_count: page.total_count,
        publish_count: page.publish_count,
        masssend_count: page.masssend_count,
      };
    }
    const list = page.publish_list || [];
    if (!list.length) break;

    let newOnPage = 0;
    list.forEach((item, groupOffset) => {
      const info = parseInfo(item);
      const publishType = item.publish_type ?? info.publish_type ?? null;
      const groupTime = info?.sent_info?.time || info?.publish_info?.create_time || null;
      (info?.appmsg_info || []).forEach((a, pos) => {
        const content_url = normalizeUrl(a.content_url || "");
        const ts = a?.line_info?.send_time || groupTime || info?.publish_info?.create_time || null;
        const row = {
          title: decodeHtml(a.title || "").trim(),
          publishedAt: toIso(ts),
          publishedDate: toDateCn(ts),
          content_url,
          urlKind: urlKindOf(content_url),
          is_deleted: !!a.is_deleted,
          private_type: a?.private_info?.private_type ?? null,
          msgid: info.msgid ?? null,
          appmsgid: a.appmsgid ?? null,
          itemidx: a.itemidx ?? pos + 1,
          publish_type: publishType,
          publish_type_label: publishTypeLabel(publishType),
          group_index: begin + groupOffset,
          position: pos,
        };
        row._key = articleKey(row);
        articles.push(row);
        if (!knownKeys.has(row._key)) newOnPage += 1;
      });
    });

    pages += 1;
    begin += list.length;

    if (mode === "incremental" && knownKeys.size > 0 && newOnPage === 0) {
      stoppedEarly = true;
      break;
    }
    if (begin >= (page.total_count || 0)) break;
    if (pages > 300) throw new Error("too many pages");
    await new Promise((r) => setTimeout(r, delayMs));
  }

  return {
    fetched_at: new Date().toISOString(),
    mode,
    stoppedEarly,
    pages,
    meta,
    articles,
  };
}`;

export function csvEscape(v: unknown) {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(articles: ArticleRow[]) {
  const header = [
    "title",
    "publishedDate",
    "publishedAt",
    "content_url",
    "urlKind",
    "publish_type",
    "publish_type_label",
    "is_deleted",
    "private_type",
    "msgid",
    "appmsgid",
    "itemidx",
  ];
  const lines = [header.join(",")];
  for (const a of articles) {
    lines.push(
      [
        a.title,
        a.publishedDate,
        a.publishedAt,
        a.content_url,
        a.urlKind,
        a.publish_type,
        a.publish_type_label,
        a.is_deleted,
        a.private_type,
        a.msgid,
        a.appmsgid,
        a.itemidx,
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  return `\uFEFF${lines.join("\n")}\n`;
}
