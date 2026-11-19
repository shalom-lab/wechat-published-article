import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "WeChat Published Articles",
    description: "登录公众号后台后，增量同步发表记录到 GitHub（BYOK）",
    permissions: [
      "storage",
      "sidePanel",
      "scripting",
      "tabs",
      "commands",
      "activeTab",
    ],
    host_permissions: [
      "https://mp.weixin.qq.com/*",
      "https://api.github.com/*",
    ],
    icons: {
      16: "icon/16.png",
      48: "icon/48.png",
      128: "icon/128.png",
    },
    action: {
      default_title: "同步发表记录",
      default_icon: {
        16: "icon/16.png",
        48: "icon/48.png",
        128: "icon/128.png",
      },
    },
    commands: {
      "sync-publish-catalog": {
        suggested_key: {
          default: "Alt+Shift+U",
          mac: "Alt+Shift+U",
        },
        description: "增量同步当前公众号发表记录到 GitHub",
      },
    },
  },
});
