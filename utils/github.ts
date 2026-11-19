/** GitHub Contents API：按公众号维护 catalog */

function headers(token: string) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function encodePath(path: string) {
  return path
    .split("/")
    .map((p) => encodeURIComponent(p))
    .join("/");
}

export function accountDir(accountId: string) {
  return `accounts/${accountId}`;
}

export type FileResult<T = unknown> = {
  exists: boolean;
  text: string | null;
  data: T | null;
  sha: string | null;
};

export async function getFile(
  repo: string,
  token: string,
  path: string,
): Promise<FileResult> {
  const url = `https://api.github.com/repos/${repo}/contents/${encodePath(path)}`;
  const res = await fetch(url, { headers: headers(token) });
  if (res.status === 404) {
    return { exists: false, text: null, data: null, sha: null };
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message || `读取 ${path} 失败（${res.status}）`);
  }
  const meta = (await res.json()) as { content: string; sha: string };
  const text = decodeURIComponent(
    escape(atob(meta.content.replace(/\n/g, ""))),
  );
  return { exists: true, text, data: null, sha: meta.sha };
}

export async function getJsonFile<T = unknown>(
  repo: string,
  token: string,
  path: string,
): Promise<FileResult<T>> {
  const file = await getFile(repo, token, path);
  if (!file.exists || file.text == null) return file as FileResult<T>;
  return { ...file, data: JSON.parse(file.text) as T };
}

export async function putTextFile(
  repo: string,
  token: string,
  path: string,
  text: string,
  message: string,
  sha: string | null = null,
) {
  const url = `https://api.github.com/repos/${repo}/contents/${encodePath(path)}`;
  const body = {
    message,
    content: btoa(unescape(encodeURIComponent(text))),
    ...(sha ? { sha } : {}),
  };
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      ...headers(token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(err.message || `写入 ${path} 失败（${res.status}）`);
  }
  return res.json();
}

export async function putJsonFile(
  repo: string,
  token: string,
  path: string,
  data: unknown,
  message: string,
  sha: string | null = null,
) {
  return putTextFile(
    repo,
    token,
    path,
    `${JSON.stringify(data, null, 2)}\n`,
    message,
    sha,
  );
}

export type IndexData = {
  updatedAt: string | null;
  accounts: Array<{
    id: string;
    nickname: string;
    fakeid?: string | null;
    updatedAt?: string;
    article_count?: number | null;
  }>;
};

export async function readIndex(repo: string, token: string) {
  const file = await getJsonFile<IndexData>(repo, token, "index.json");
  if (!file.exists) {
    return {
      exists: false,
      data: { updatedAt: null, accounts: [] } as IndexData,
      sha: null,
      text: null,
    };
  }
  return file;
}

export async function upsertIndexAccount(
  repo: string,
  token: string,
  accountMeta: {
    id: string;
    nickname?: string;
    fakeid?: string | null;
    updatedAt?: string;
    article_count?: number | null;
  },
) {
  const file = await readIndex(repo, token);
  const data = file.data || { updatedAt: null, accounts: [] };
  const accounts = Array.isArray(data.accounts) ? [...data.accounts] : [];
  const i = accounts.findIndex((a) => a.id === accountMeta.id);
  const row = {
    id: accountMeta.id,
    nickname: accountMeta.nickname || "",
    fakeid: accountMeta.fakeid || null,
    updatedAt: accountMeta.updatedAt || new Date().toISOString(),
    article_count: accountMeta.article_count ?? null,
  };
  if (i >= 0) accounts[i] = { ...accounts[i], ...row };
  else accounts.push(row);
  accounts.sort((a, b) =>
    String(a.nickname || a.id).localeCompare(String(b.nickname || b.id), "zh"),
  );
  const next: IndexData = {
    updatedAt: new Date().toISOString(),
    accounts,
  };
  await putJsonFile(
    repo,
    token,
    "index.json",
    next,
    `chore(wpa): update index for ${accountMeta.id}`,
    file.sha,
  );
  return next;
}
