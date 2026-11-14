# Security

## Reporting a vulnerability

Please report security issues privately through GitHub: **Security → Report a vulnerability** in this repository. Do not open a public issue, and never include your API key in a report.

## How the plugin handles your data

- Your DeepSeek API key is stored in `.obsidian/plugins/deepseek-chat/data.json` in plain text, like all Obsidian plugin settings. It is sent only to the API base URL you configure.
- Messages, attached notes and files are sent only to the DeepSeek API. The plugin has no telemetry and contacts no other server.
- Model-generated content is rendered with Obsidian's Markdown renderer; the plugin does not use `innerHTML`.
- Vault tools are read-only. The plugin writes only chat files in your chosen chat folder and notes you explicitly export or save.
