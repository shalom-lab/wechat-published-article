/**
 * BYOK: gh-wpa-repo / gh-wpa-token
 * 主存：插件自身 localStorage（侧栏 chrome-extension:// 源，不是 mp.weixin.qq.com）
 * 镜像：browser.storage.local（给 service worker 读，SW 没有 localStorage）
 */

export const APP = "wpa";
export const REPO_KEY = `gh-${APP}-repo`;
export const TOKEN_KEY = `gh-${APP}-token`;

export type ByokConfig = {
  repo: string;
  token: string;
};

export function readByokFromLocalStorage(): ByokConfig {
  return {
    repo: localStorage.getItem(REPO_KEY) || "",
    token: localStorage.getItem(TOKEN_KEY) || "",
  };
}

export async function readByok(): Promise<ByokConfig> {
  const local =
    typeof localStorage !== "undefined"
      ? readByokFromLocalStorage()
      : { repo: "", token: "" };
  if (local.repo && local.token) return local;
  try {
    const stored = await browser.storage.local.get([REPO_KEY, TOKEN_KEY]);
    return {
      repo: (stored[REPO_KEY] as string) || local.repo || "",
      token: (stored[TOKEN_KEY] as string) || local.token || "",
    };
  } catch {
    return local;
  }
}

export async function saveByok(input: ByokConfig): Promise<ByokConfig> {
  const next = {
    repo: String(input.repo || "").trim(),
    token: String(input.token || "").trim(),
  };
  if (!next.repo || !next.token) {
    throw new Error("请填写 GitHub 仓库（owner/name）和 Token");
  }
  if (!/^[^/\s]+\/[^/\s]+$/.test(next.repo)) {
    throw new Error("仓库格式应为 owner/name");
  }
  const res = await fetch(`https://api.github.com/repos/${next.repo}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${next.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(
      body.message ||
        (res.status === 401 || res.status === 403
          ? "Token 无效或权限不足，请检查 repo scope"
          : `GitHub 连接失败（${res.status}）`),
    );
  }
  localStorage.setItem(REPO_KEY, next.repo);
  localStorage.setItem(TOKEN_KEY, next.token);
  await browser.storage.local.set({
    [REPO_KEY]: next.repo,
    [TOKEN_KEY]: next.token,
  });
  return next;
}

export async function clearByok(): Promise<void> {
  localStorage.removeItem(REPO_KEY);
  localStorage.removeItem(TOKEN_KEY);
  await browser.storage.local.remove([REPO_KEY, TOKEN_KEY]);
}

export function maskToken(token: string): string {
  const t = String(token || "");
  if (!t) return "";
  if (t.length <= 8) return "********";
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
}
