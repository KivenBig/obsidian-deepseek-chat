# Obsidian-DeepSeek Chat

Chat with DeepSeek in an Obsidian sidebar using your own API key. Every capability from DeepSeek's official *Build a Chatbot* guide is built in: web search, deep search, reading links, file input, safety check, auto titles, text-to-speech and speech input. Works on desktop and mobile.

> **Unofficial.** This is an independent open-source project and is not affiliated with or endorsed by DeepSeek.

[中文说明](#中文说明)

## Features

Every feature can be turned on or off in the plugin settings.

| Feature | What you get |
|---|---|
| Chat | Streaming replies, stop, regenerate, edit and resend |
| Thinking | Toggle and effort (low / high / max); reasoning is shown collapsed |
| Web search | Search queries, result cards, inline citations and a source list |
| Deep search | With Web and Think both on, every step (search → open page → find in page) is shown |
| Read links | Paste links in your message; DeepSeek reads them server-side |
| File input | PDF, Word, PowerPoint, images, Excel, ebooks, and plain text or code; pick from the vault, drag in or paste |
| Image understanding | Paste a screenshot and ask about it (`deepseek-flash` only) |
| Safety check | Optional moderation with a custom refusal message |
| User context | Date, weekday, location and language are sent with each turn |
| Auto titles | Generated during the first turn at no extra cost |
| Read aloud | Two voices, streaming playback, optional auto-play |
| Voice input | Record up to 120 seconds and transcribe into the input box |
| Continue | Resume a reply that was cut off by the length limit |
| Usage and cost | Cache hit / miss, output, searches and an estimated cost for every reply |
| Vault tools | Optional read-only tools that let the model search and read your notes |
| Obsidian integration | Include the current note, ask about selected text, insert a reply into a note, save as a note, export a whole chat, clickable `[[links]]` with hover preview |
| JSON extraction | A command that extracts structured data from the current note (JSON output mode) |

## Installation

**From Community plugins** (after approval): Settings → Community plugins → Browse → search for "DeepSeek Chat".

**With BRAT** (beta builds): install [BRAT](https://github.com/TfTHacker/obsidian42-brat), choose *Add beta plugin*, and enter `KivenBig/obsidian-deepseek-chat`.

**Manually**: download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/KivenBig/obsidian-deepseek-chat/releases/latest) into `<your vault>/.obsidian/plugins/deepseek-chat/`, then reload Obsidian and enable the plugin.

## Getting started

1. Create an API key at [platform.deepseek.com](https://platform.deepseek.com) and top up your balance.
2. Open **Settings → DeepSeek Chat**, paste the key and click **Test**.
3. Click the chat icon in the left ribbon, or run **DeepSeek Chat: Open chat** from the command palette.

Chats are saved as JSON files in `DeepSeek Chats/` in your vault (configurable), so they sync with whatever sync method you already use. Use **Export as note** to get a readable Markdown copy.

## Disclosures

- **Account and payment required.** The plugin needs a DeepSeek API key. Using it is billed by DeepSeek to your own DeepSeek account at their published prices; web search, link reading, document parsing, text-to-speech and speech input are billed separately by DeepSeek. The plugin itself is free.
- **Network use.** The plugin connects only to the DeepSeek API (`https://api.deepseek.com` by default, or the base URL you set). It sends your messages, any notes or files you attach, and — when you enable vault tools — note content the model asks to read. Web search and link reading are performed by DeepSeek's servers. Streaming replies use `fetch` because Obsidian's `requestUrl` cannot read a response incrementally; every other request uses `requestUrl`.
- **No telemetry, no ads.** The plugin collects no analytics and sends nothing to the author.
- **Files.** The plugin only reads and writes inside your vault: chat files in the chat folder you choose, and notes you export or save. Vault tools are read-only.
- **Listing vault files.** The plugin lists files in your vault to (1) let you pick a vault file to attach, (2) find your saved chats in the chat folder, and (3) run the `search_notes` vault tool when you have turned vault tools on. File paths and content stay on your device unless the model reads a note through a tool you enabled.
- **Clipboard.** The plugin only *writes* to the clipboard when you click **Copy**. It never reads your clipboard; pasting into the chat box is handled by the input field itself.
- **API key storage.** Your key is stored in plain text in `.obsidian/plugins/deepseek-chat/data.json`, like all plugin settings. If you sync your vault with Git or share it, exclude that file.

## Cost estimate

Each reply shows an estimated cost based on a price table you can edit in settings (DeepSeek may change prices). Peak hours are weekdays 09:00–12:00 and 14:00–18:00 Beijing time; all other times use the off-peak price. Public holidays are not detected. The estimate is for reference; your DeepSeek bill is authoritative.

## Development

```bash
npm install
npm run dev     # watch build
npm run build   # type-check and production build
npm run lint    # Obsidian's official ESLint rules
npm test        # unit tests
```

See [CONTRIBUTING.md](CONTRIBUTING.md). The original feature design is in [docs/DESIGN.md](docs/DESIGN.md).

## License

[MIT](LICENSE)

---

## 中文说明

在 Obsidian 侧栏里使用 DeepSeek 官方「构建 Chatbot」指南中的全部能力：联网搜索、深度思考搜索、阅读链接、文件输入、内容安全、会话标题、朗读、语音输入。填入你自己的 API Key 即可使用，桌面端和手机端都支持。

> **非官方开源项目**，与 DeepSeek 无关联。

### 功能

每一项都可以在插件设置里单独开关：多轮对话与流式输出、深度思考（可调强度）、联网搜索（带引用和来源）、深度思考搜索、阅读链接、文件输入（PDF / Word / PPT / 图片 / Excel / 电子书 / 纯文本）、图片理解、内容安全审核、用户元信息、自动会话标题、朗读回答、语音输入、续写、用量与费用估算、只读笔记库工具，以及附带当前笔记、选中文字提问、插入或另存为笔记、导出会话、`[[双链]]` 点击打开与悬停预览、JSON 提取。

### 安装

- **社区插件市场**（审核通过后）：设置 → 第三方插件 → 浏览 → 搜索「DeepSeek Chat」。
- **BRAT 测试版**：安装 [BRAT](https://github.com/TfTHacker/obsidian42-brat)，Add beta plugin，填入 `KivenBig/obsidian-deepseek-chat`。
- **手动安装**：从 [最新 Release](https://github.com/KivenBig/obsidian-deepseek-chat/releases/latest) 下载 `main.js`、`manifest.json`、`styles.css`，放进 `<你的库>/.obsidian/plugins/deepseek-chat/`。

### 开始使用

1. 在 [DeepSeek 开放平台](https://platform.deepseek.com) 创建 API Key 并充值。
2. 打开「设置 → DeepSeek Chat」，填入 Key，点「测试」。
3. 点左侧边栏的对话图标，或在命令面板运行「DeepSeek Chat: 打开对话」。

### 说明与披露

- **需要账户并付费**：使用 DeepSeek API 会按官方价格从你自己的 DeepSeek 账户扣费；联网搜索、读链接、文档解析、朗读、语音识别由 DeepSeek 另行计费。插件本身免费。
- **网络使用**：插件只连接 DeepSeek 接口（默认 `https://api.deepseek.com`，或你设置的地址），发送你的消息、你附带的笔记和文件，以及开启笔记库工具后模型要求读取的笔记内容。联网搜索和读链接由 DeepSeek 服务端执行。流式回答使用 `fetch`（Obsidian 的 `requestUrl` 不支持逐块读取），其余请求都使用 `requestUrl`。
- **没有遥测、没有广告**：不收集任何使用数据，不向作者发送任何内容。
- **文件**：只在你的库内读写，即会话文件夹里的会话文件，以及你导出或另存的笔记。笔记库工具只读。
- **列出库中文件**：插件会列出库里的文件，用于三件事：从库中选择附件、在会话文件夹里找到你保存的会话、在你开启笔记库工具后执行「搜索笔记」。文件路径和内容只留在你的设备上，除非模型通过你开启的工具读取了某篇笔记。
- **剪贴板**：只在你点「复制」时**写入**剪贴板，从不读取剪贴板；往对话框里粘贴是输入框本身的功能。
- **API Key 存储**：和所有插件设置一样，以明文保存在 `.obsidian/plugins/deepseek-chat/data.json`。如果你用 Git 同步或分享整个库，请排除这个文件。

### 费用估算

每条回答显示的费用按设置里可编辑的价格表估算。高峰时段为北京时间工作日 9:00–12:00、14:00–18:00，其余为低谷价，不识别法定节假日。估算仅供参考，以 DeepSeek 账单为准。
