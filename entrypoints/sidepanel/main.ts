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
  } catch (err) {
    statusEl.textContent = err instanceof Error ? err.message : String(err);
    statusEl.className = "status bad";
  } finally {
    btnSave.textContent = "保存";
    btnSave.disabled = false;
  }
}

async function onClear() {
  if (!confirm("确定清除本机保存的 GitHub 仓库和 Token？")) return;
  await clearByok();
  repoEl.value = "";
  tokenEl.value = "";
  statusEl.textContent = "未设置";
  statusEl.className = "status";
  appendLog("已清除 BYOK");
}

async function onSync(mode: "incremental" | "full") {
  const { repo, token } = await readByok();
  if (!repo || !token) {
    showView("settings");
    statusEl.textContent = "请先填写并保存 GitHub 仓库和 Token";
    statusEl.className = "status bad";
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
    appendLog(
      `完成：${s.account?.nickname || s.account?.id}（${s.account?.alias || s.account?.id}）新增 ${s.added}，合计 ${s.total}` +
        (s.stoppedEarly ? "（增量早停）" : ""),
    );
    showLinks(s);
  } catch (err) {
    appendLog(`失败：${err instanceof Error ? err.message : String(err)}`);
  } finally {
    setBusy(false);
  }
}

browser.runtime.onMessage.addListener((msg) => {
  if (!msg || typeof msg !== "object") return;
  const m = msg as {
    type?: string;
    message?: string;
    summary?: SyncSummary;
  };
  if (m.type === "wpa:progress" && m.message) appendLog(m.message);
  if (m.type === "wpa:error" && m.message) appendLog(`失败：${m.message}`);
  // 侧栏按钮同步已在 onSync 里处理结果；这里只承接快捷键触发的完成态
  if (m.type === "wpa:done" && m.summary && btnSync.disabled === false) {
    showLinks(m.summary);
  }
});

tabSync.addEventListener("click", () => showView("sync"));
tabSettings.addEventListener("click", () => showView("settings"));
btnSave.addEventListener("click", onSave);
btnClear.addEventListener("click", onClear);
btnSync.addEventListener("click", () => onSync("incremental"));
btnFull.addEventListener("click", () => {
  if (!confirm("全量会重新翻完整发表记录，可能较慢。继续？")) return;
  onSync("full");
});

hydrateByok();
showView("sync");
