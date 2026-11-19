import "./style.css";
import {
  REPO_KEY,
  TOKEN_KEY,
  clearByok,
  maskToken,
  readByok,
  saveByok,
} from "../../utils/byok";
import type { SyncSummary } from "../../utils/sync";

const logEl = document.getElementById("log")!;
const linksEl = document.getElementById("links")!;
const statusEl = document.getElementById("byok-status")!;
const repoEl = document.getElementById("repo") as HTMLInputElement;
const tokenEl = document.getElementById("token") as HTMLInputElement;
const btnSync = document.getElementById("btn-sync") as HTMLButtonElement;
const btnFull = document.getElementById("btn-full") as HTMLButtonElement;
const btnSave = document.getElementById("btn-save") as HTMLButtonElement;
const btnClear = document.getElementById("btn-clear") as HTMLButtonElement;
const viewSync = document.getElementById("view-sync")!;
const viewSettings = document.getElementById("view-settings")!;
const tabSync = document.getElementById("tab-sync") as HTMLButtonElement;
const tabSettings = document.getElementById("tab-settings") as HTMLButtonElement;
const dialogRoot = document.getElementById("dialog-root")!;
const dialogTitle = document.getElementById("dialog-title")!;
const dialogBody = document.getElementById("dialog-body")!;
const dialogOk = document.getElementById("dialog-ok") as HTMLButtonElement;
const dialogCancel = document.getElementById("dialog-cancel") as HTMLButtonElement;
const toastEl = document.getElementById("toast")!;
const mpStatusEl = document.getElementById("mp-status")!;

const MP_ORIGIN = "https://mp.weixin.qq.com";

let toastTimer: number | undefined;
let dialogResolver: ((ok: boolean) => void) | null = null;

type MpContext = {
  hasMp: boolean;
  activeIsMp: boolean;
  url: string;
};

async function getMpContext(): Promise<MpContext> {
  const [active] = await browser.tabs.query({
    active: true,
    currentWindow: true,
  });
  const activeUrl = String(active?.url || "");
  const activeIsMp = activeUrl.startsWith(MP_ORIGIN);
  if (activeIsMp) {
    return { hasMp: true, activeIsMp: true, url: activeUrl };
  }
  const tabs = await browser.tabs.query({ url: [`${MP_ORIGIN}/*`] });
  const first = tabs[0];
  return {
    hasMp: Boolean(first),
    activeIsMp: false,
    url: String(first?.url || ""),
  };
}

async function refreshMpStatus(opts?: { toastIfMissing?: boolean }) {
  try {
    const ctx = await getMpContext();
    if (ctx.activeIsMp) {
      mpStatusEl.textContent = `当前前台页已是公众号后台（${MP_ORIGIN}）`;
      mpStatusEl.className = "mp-status ok";
      return ctx;
    }
    if (ctx.hasMp) {
      mpStatusEl.textContent =
        "已检测到公众号后台标签页；同步时会优先使用该页登录态（建议切到该标签）。";
      mpStatusEl.className = "mp-status ok";
      return ctx;
    }
    mpStatusEl.textContent = `未检测到 ${MP_ORIGIN}。请先打开并登录公众号后台，再同步。`;
    mpStatusEl.className = "mp-status bad";
    if (opts?.toastIfMissing) {
      showToast(`请先打开并登录 ${MP_ORIGIN}`, "bad");
    }
    return ctx;
  } catch {
    mpStatusEl.textContent = `无法检查标签页，请确认已打开并登录 ${MP_ORIGIN}`;
    mpStatusEl.className = "mp-status bad";
    return { hasMp: false, activeIsMp: false, url: "" };
  }
}

async function confirmMpBeforeSync(mode: "incremental" | "full") {
  const ctx = await refreshMpStatus();
  const pageLine = ctx.activeIsMp
    ? "当前前台页已是公众号后台。"
    : ctx.hasMp
      ? "已找到公众号后台标签页（不一定是当前前台页）。"
      : `尚未检测到 ${MP_ORIGIN} 标签页。`;
  const ok = await askConfirm({
    title: mode === "full" ? "开始全量刷新？" : "开始增量同步？",
    body:
      `${pageLine}\n\n` +
      `请确认已在浏览器打开并登录 ${MP_ORIGIN}（公众号后台）。` +
      (mode === "full"
        ? "\n全量会重新翻完整发表记录，可能较慢。"
        : "\n增量会按发表记录往前翻，遇到已同步内容可早停。"),
    okText: mode === "full" ? "开始全量" : "开始同步",
    danger: !ctx.hasMp,
  });
  return ok;
}

function appendLog(line: string) {
  const t = new Date().toLocaleTimeString();
  logEl.textContent += `[${t}] ${line}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function setBusy(busy: boolean) {
  btnSync.disabled = busy;
  btnFull.disabled = busy;
  btnSync.textContent = busy ? "同步中…" : "增量同步";
}

function showView(name: "sync" | "settings") {
  const isSync = name === "sync";
  viewSync.hidden = !isSync;
  viewSettings.hidden = isSync;
  tabSync.classList.toggle("active", isSync);
  tabSettings.classList.toggle("active", !isSync);
}

function showToast(message: string, kind: "ok" | "bad" | "" = "") {
  toastEl.hidden = false;
  toastEl.textContent = message;
  toastEl.className = `toast${kind ? ` ${kind}` : ""}`;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.hidden = true;
  }, 3200);
}

function closeDialog(ok: boolean) {
  dialogRoot.hidden = true;
  const resolve = dialogResolver;
  dialogResolver = null;
  resolve?.(ok);
}

function askConfirm(options: {
  title: string;
  body: string;
  okText?: string;
  cancelText?: string;
  danger?: boolean;
}) {
  dialogTitle.textContent = options.title;
  dialogBody.textContent = options.body;
  dialogOk.textContent = options.okText || "继续";
  dialogCancel.textContent = options.cancelText || "取消";
  dialogOk.className = options.danger ? "danger ghost" : "primary";
  dialogRoot.hidden = false;
  dialogOk.focus();
  return new Promise<boolean>((resolve) => {
    dialogResolver = resolve;
  });
}

function showLinks(summary: SyncSummary) {
  const { urls, account, paths } = summary;
  linksEl.hidden = false;
  linksEl.innerHTML = `
    <div class="links-title">仓库文件（可点击）</div>
    <div class="links-meta">${account.nickname} · 公众号ID=${account.alias || account.id}</div>
    <a href="${urls.catalogJson}" target="_blank" rel="noreferrer">catalog.json</a>
    <a href="${urls.catalogCsv}" target="_blank" rel="noreferrer">catalog.csv</a>
    <a href="${urls.metaJson}" target="_blank" rel="noreferrer">meta.json</a>
    <a href="${urls.accountDir}" target="_blank" rel="noreferrer">打开目录</a>
    <div class="links-path">${paths.catalogPath}</div>
  `;
}

async function hydrateByok() {
  const localRepo = localStorage.getItem(REPO_KEY) || "";
  const localToken = localStorage.getItem(TOKEN_KEY) || "";
  const { repo, token } = await readByok();
  repoEl.value = repo || localRepo;
  tokenEl.value = token || localToken;
  if (repo && token) {
    statusEl.textContent = `已保存：${repo} / ${maskToken(token)}`;
    statusEl.className = "status ok";
  } else {
    statusEl.textContent = "未设置";
    statusEl.className = "status";
  }
}

async function onSave() {
  btnSave.textContent = "保存中…";
  btnSave.disabled = true;
  try {
    const saved = await saveByok({
      repo: repoEl.value,
      token: tokenEl.value,
    });
    statusEl.textContent = `已保存：${saved.repo} / ${maskToken(saved.token)}`;
    statusEl.className = "status ok";
    appendLog("GitHub 配置已写入插件 localStorage");
    showToast("GitHub 配置已保存", "ok");
  } catch (err) {
    statusEl.textContent = err instanceof Error ? err.message : String(err);
    statusEl.className = "status bad";
    showToast(err instanceof Error ? err.message : String(err), "bad");
  } finally {
    btnSave.textContent = "保存";
    btnSave.disabled = false;
  }
}

async function onClear() {
  const ok = await askConfirm({
    title: "清除本机密钥？",
    body: "将删除插件里保存的 GitHub 仓库与 Token，不影响远端仓库数据。",
    okText: "清除",
    danger: true,
  });
  if (!ok) return;
  await clearByok();
  repoEl.value = "";
  tokenEl.value = "";
  statusEl.textContent = "未设置";
  statusEl.className = "status";
  appendLog("已清除 BYOK");
  showToast("已清除本机密钥", "ok");
}

async function onSync(mode: "incremental" | "full") {
  const { repo, token } = await readByok();
  if (!repo || !token) {
    showView("settings");
    statusEl.textContent = "请先填写并保存 GitHub 仓库和 Token";
    statusEl.className = "status bad";
    showToast("请先在设置里保存 GitHub 配置", "bad");
    return;
  }

  setBusy(true);
  linksEl.hidden = true;
  linksEl.innerHTML = "";
  appendLog(mode === "full" ? "开始全量刷新…" : "开始增量同步…");
  try {
    const res = (await browser.runtime.sendMessage({
      type: "wpa:sync",
      mode,
    })) as
      | { ok: true; summary: SyncSummary }
      | { ok: false; error: string };
    if (!res?.ok) throw new Error(("error" in res && res.error) || "同步失败");
    const s = res.summary;
    const doneLine =
      `完成：${s.account?.nickname || s.account?.id}（${s.account?.alias || s.account?.id}）新增 ${s.added}，合计 ${s.total}` +
      (s.stoppedEarly ? "（增量早停）" : "");
    appendLog(doneLine);
    showLinks(s);
    showToast(
      mode === "full"
        ? `全量完成 · ${s.account.alias || s.account.id} · 合计 ${s.total}`
        : `增量完成 · 新增 ${s.added} · 合计 ${s.total}`,
      "ok",
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    appendLog(`失败：${msg}`);
    showToast(msg, "bad");
  } finally {
    setBusy(false);
  }
}

dialogCancel.addEventListener("click", () => closeDialog(false));
dialogOk.addEventListener("click", () => closeDialog(true));
dialogRoot.addEventListener("click", (e) => {
  const t = e.target as HTMLElement | null;
  if (t?.hasAttribute("data-dialog-dismiss")) closeDialog(false);
});
document.addEventListener("keydown", (e) => {
  if (dialogRoot.hidden) return;
  if (e.key === "Escape") {
    e.preventDefault();
    closeDialog(false);
  }
});

browser.runtime.onMessage.addListener((msg) => {
  if (!msg || typeof msg !== "object") return;
  const m = msg as {
    type?: string;
    message?: string;
    summary?: SyncSummary;
  };
  if (m.type === "wpa:progress" && m.message) appendLog(m.message);
  if (m.type === "wpa:error" && m.message) {
    appendLog(`失败：${m.message}`);
    showToast(m.message, "bad");
  }
  if (m.type === "wpa:done" && m.summary && btnSync.disabled === false) {
    showLinks(m.summary);
    showToast(
      `同步完成 · 新增 ${m.summary.added} · 合计 ${m.summary.total}`,
      "ok",
    );
  }
});

tabSync.addEventListener("click", () => showView("sync"));
tabSettings.addEventListener("click", () => showView("settings"));
btnSave.addEventListener("click", onSave);
btnClear.addEventListener("click", onClear);
btnSync.addEventListener("click", async () => {
  if (!(await confirmMpBeforeSync("incremental"))) return;
  onSync("incremental");
});
btnFull.addEventListener("click", async () => {
  if (!(await confirmMpBeforeSync("full"))) return;
  onSync("full");
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshMpStatus();
});
window.addEventListener("focus", () => {
  refreshMpStatus();
});

hydrateByok();
showView("sync");
refreshMpStatus({ toastIfMissing: true });
