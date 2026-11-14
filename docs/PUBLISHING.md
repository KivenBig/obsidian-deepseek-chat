# 发布指南：GitHub → Obsidian 社区插件目录

> 给维护者自己看的操作手册。依据 Obsidian 官方文档《Submit your plugin》与《Release your plugin with GitHub Actions》（2026-11 版）整理。

## 0. 发布前自查（每个版本都做）

| 检查项 | 命令 / 位置 | 通过标准 |
|---|---|---|
| 官方 ESLint 规则 | `npm run lint` | 0 errors。当前保留 2 条 warning，原因见第 6 节 |
| 类型检查 | `npm run check` | 无输出 |
| 单元测试 | `npm test` | 全部通过 |
| 构建 | `npm run build` | 生成 `main.js` |
| 真实 Key 冒烟测试 | 在**测试库**里装上插件逐项点一遍 | 见下方清单 |
| 版本号一致 | `manifest.json` 的 `version`、`versions.json`、`CHANGELOG.md` 的 `## x.y.z` | 三处一致 |

真实 Key 冒烟测试清单：思考对话、联网搜索、深度搜索（联网 + 思考）、读链接、上传 PDF、粘贴图片、朗读（流式和整段各一次）、语音输入、笔记库工具、导出会话、手机端打开一次。

### 建议补一张截图

社区目录会展示 README 的摘要，README 里的相对路径图片（例如 `./docs/images/chat.png`）也会被正确显示。截图请在**测试库**里截，避免露出私人笔记。截好后放进 `docs/images/`，在 README 的功能表格上方加一行 `![DeepSeek Chat](docs/images/chat.png)`。

## 1. 建仓库并推送（第一次）

```bash
cd ~/Dev/obsidian-deepseek-chat
git add -A
git commit -m "DeepSeek Chat 0.1.0"
gh repo create KivenBig/obsidian-deepseek-chat --public --source . --push --description "Chat with DeepSeek in Obsidian using your own API key"
```

然后在 GitHub 仓库页面：**Settings → Actions → General → Workflow permissions** 选 **Read and write permissions**，保存。没有这个权限，Release 工作流无法创建 Release。

## 2. 打 tag，自动生成 Release

tag 必须和 `manifest.json` 里的版本号**完全一致**，不带 `v`：

```bash
git tag -a 0.1.0 -m "0.1.0"
git push origin 0.1.0
```

推送后，`.github/workflows/release.yml` 会自动执行：lint → 测试 → 构建 → 校验 tag 与版本号是否一致 → 生成构建证明（attestation，官方推荐）→ 创建一个**草稿** Release，附带 `main.js`、`manifest.json`、`styles.css`，说明取自 `CHANGELOG.md` 的对应章节。

到 GitHub 的 **Releases** 页面打开这个草稿，确认三个附件都在，点 **Publish release**。

## 3. 提交到社区插件目录

官方现在的提交入口是网页，不再是给 `obsidian-releases` 提 PR：

1. 打开 <https://community.obsidian.md>，用 Obsidian 账号登录。
2. 在个人资料里**关联 GitHub 账号**（用来验证你拥有这个仓库）。
3. 点 **Add your plugin**，选择 `KivenBig/obsidian-deepseek-chat`。
4. 目录读取的是**默认分支最新提交**里的 `manifest.json`，以及和它版本号一致的 Release，所以这两样都要先准备好。
5. 之后会自动审核，页面上会给出需要修改的地方。

插件 ID `deepseek-chat` 和名称 `DeepSeek Chat` 已经在 10,355 个现有插件里核对过，没有重名。

## 4. 审核没通过时怎么改

改代码 → 在 `CHANGELOG.md` 加一个新版本章节 → 然后：

```bash
npm version patch          # 0.1.0 → 0.1.1，同时更新 manifest.json 和 versions.json
git push && git push origin 0.1.1
```

再去发布新生成的草稿 Release。审核看的是最新版本。

## 5. 以后发新版本

同第 4 节：更新 CHANGELOG → `npm version patch|minor` → 推送代码和 tag → 发布草稿 Release。用户会在 Obsidian 里收到更新提示。

如果新版本要求更高的 Obsidian 版本，先改 `manifest.json` 的 `minAppVersion` 再运行 `npm version`，`versions.json` 会自动记录对应关系。

## 6. 已知的 2 条 lint 警告

| 警告 | 为什么保留 |
|---|---|
| `no-restricted-globals`：使用了 `fetch` | 只有流式对话用 `fetch`，因为 Obsidian 的 `requestUrl` 不能逐块读取响应。其余请求（上传、语音、JSON、非流式）都已改用 `requestUrl`。README 的 Disclosures 一节已经说明。官方规则不允许用注释屏蔽这条，所以它会一直显示为 warning（不是 error）。 |
| `prefer-setting-definitions`：设置页没有实现声明式设置 API | 这是 Obsidian 1.13 的新接口，作用是让设置项出现在全局设置搜索里。插件目前最低支持 1.8.7，所以暂不迁移；以后提高最低版本时再改。 |

## 7. 合规要点对照

| 要求（官方文档） | 本插件 |
|---|---|
| 仓库根目录有 README.md、LICENSE、manifest.json | ✓ |
| `id` 只含小写字母和连字符，不含 obsidian，不以 plugin 结尾，全目录唯一 | `deepseek-chat` ✓ |
| `name` 只用基本拉丁字符，不含 Obsidian / Plugin，全目录唯一 | `DeepSeek Chat` ✓（仓库名和 README 标题可以写 Obsidian-DeepSeek Chat） |
| 版本号 x.y.z，tag 与版本一致 | `0.1.0`，工作流会自动校验 ✓ |
| Release 附带 main.js、manifest.json、styles.css | 工作流自动上传 ✓ |
| 不用 innerHTML / outerHTML / insertAdjacentHTML | ✓（ESLint 已验证） |
| 不在 JS 里写死样式 | ✓（输入框高度用 `setCssProps` 设 CSS 变量） |
| 用 `this.app`，不用全局 `app` | ✓ |
| 卸载时清理；不在 onunload 里 detach 视图 | ✓ |
| 命令不设默认快捷键；命令名不重复插件名 | ✓ |
| 设置页：首组无标题、用 `setHeading()`、标题不含 settings、句子式大小写 | ✓ |
| 用 Vault API 而不是 `vault.adapter`；后台文件用 `process`；路径过 `normalizePath` | ✓ |
| 不保存自定义视图的引用 | ✓ |
| 移动端不用 Node / Electron API；`isDesktopOnly: false` | ✓ |
| 披露：需要付费账户、网络用途、无遥测 | README → Disclosures ✓ |

唯一用到的非公开接口是「打开本插件的设置页」（`app.setting`），Obsidian 没有提供公开 API。代码里先检查它存不存在，不存在时只弹提示，不会报错。

> 注：官方《Developer policies》《Submission requirements》两页在整理时无法打开（链接已迁移）。README 里的披露内容是按惯例要求写的。提交前建议在 community.obsidian.md 的提交页上再核对一遍最新条款。
