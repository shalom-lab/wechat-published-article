# WeChat Published Articles

<div align="center">

**登录公众号后台，把「发表记录」增量同步到你自己的 GitHub 仓库（BYOK）**

[![Chrome MV3](https://img.shields.io/badge/Chrome-MV3-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/)
[![WXT](https://img.shields.io/badge/WXT-0.21-blue)](https://wxt.dev/)
[![Release](https://img.shields.io/github/v/release/shalom-lab/wechat-published-article)](https://github.com/shalom-lab/wechat-published-article/releases/latest)
[![License](https://img.shields.io/badge/license-ISC-green.svg)](package.json)

</div>

## ✨ 功能特性

- **增量同步**：按发表记录从新到旧抓取，撞上仓库已有文章即早停
- **全量刷新**：可选整库重扫，覆盖更新目录
- **账号防串台**：同步前先请求设置页，读取 **公众号ID** + **名称**；目录只用 ID（如 `epi-stats`），中文名称不入路径
- **BYOK**：侧栏填写自己的 `owner/repo` 与 GitHub PAT，密钥留在本机插件存储
- **每账号独立目录**：`accounts/<公众号ID>/catalog.json|csv` + `meta.json`，根目录 `index.json` 索引

## 🚀 快速开始

### 从 Release 安装（推荐）

1. 打开 [Releases](https://github.com/shalom-lab/wechat-published-article/releases/latest)，下载 `wechat-published-article-*-chrome.zip`
2. 解压到任意目录
3. `chrome://extensions` → 开发者模式 → **加载已解压的扩展** → 选解压后的文件夹
4. 侧栏「设置」填写 GitHub 仓库与 Token → 登录 [公众号后台](https://mp.weixin.qq.com) → 「增量同步」

快捷键默认 `Alt+Shift+U`。

### 本地构建

```bash
npm install
npm run build        # 产出 .output/chrome-mv3
npm run zip          # 产出 .output/wechat-published-article-<ver>-chrome.zip
```

开发热重载：`npm run dev`
## 📖 账号标识

同步**开始前**会用当前后台 `token` 请求：

`https://mp.weixin.qq.com/cgi-bin/settingpage?t=setting/index&action=index&…`

从页面解析：

| 字段 | 来源 | 用途 |
|------|------|------|
| 公众号ID | `.js_setting_alias`（如 `epi-stats`） | **仓库子目录名** / 防串台主键 |
| 名称 | 设置项「名称」（如 `R语言与可视化`） | 仅写入 meta / 展示，**不做目录名** |
| 原始 ID | 气泡文案 `gh_…` | 可选元数据 |

若设置页解析失败或 ID 非法，同步直接中止，避免写错账号目录。

## 🗂 仓库目录

```text
index.json
accounts/epi-stats/
  meta.json       # 账号元信息 + 上次抓取摘要
  catalog.json    # 合并后的文章目录
  catalog.csv     # 同内容 CSV，便于表格查看
```

切换公众号后重新同步，会落到对应 `accounts/<公众号ID>/`，不会互相覆盖。

## 🔑 BYOK

| Key | 含义 |
|-----|------|
| `gh-wpa-repo` | `owner/name` |
| `gh-wpa-token` | 具备该仓库写权限的 GitHub PAT |

在侧栏「设置」填写；写入**本插件**源下的 `localStorage`（`chrome-extension://…`，不是微信网页）。保存时测连，通过才落盘；因后台 Service Worker 无 `localStorage`，会镜像到 `browser.storage.local` 供同步读取。

## 🏗 架构

| Entrypoint | 作用 |
|------------|------|
| `entrypoints/sidepanel` | 侧栏：同步 + 设置（同页切换） |
| `entrypoints/background` | 快捷键、同步编排 |
| `utils/scrape.ts` | 设置页识别账号 + 发表记录抓取 |
| `utils/merge.ts` | 目录合并与防串台校验 |
| `utils/github.ts` | Contents API 读写 |
| `utils/byok.ts` | 密钥读写 |

## ⚠️ 注意

- 需在**已登录**的公众号后台标签页环境下使用；未登录或 token 失效会失败
- 抓取依赖后台「发表记录」页面数据，不走公众平台开放 API 的 `access_token`
- 请勿把 PAT 提交进仓库；`.output/` / `node_modules/` 已在 `.gitignore`

## 🛠 脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | WXT 开发模式 |
| `npm run build` | 生产构建 → `.output/chrome-mv3` |
| `npm run zip` | 打包 zip |

## 📦 发版（CI/CD）

推送符合 `v*` 的 tag 即触发 [Release workflow](.github/workflows/release.yml)：安装依赖 → 按 tag 同步版本 → `npm run zip` → 创建 GitHub Release 并挂上 zip。

```bash
# 例：发 v1.0.0
git tag v1.0.0
git push origin v1.0.0
```

也可在 Actions 里用 `workflow_dispatch` 指定已有 tag 补发。

---

<div align="center">

**如果这个项目对您有帮助，请给个 ⭐ Star！**

Made with ❤️ for 公众号运营者

</div>
