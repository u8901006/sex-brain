import { writeFileSync, readdirSync } from "node:fs";

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

const files = readdirSync("docs")
  .filter((f) => /^sex-\d{4}-\d{2}-\d{2}\.html$/.test(f))
  .sort()
  .reverse()
  .slice(0, 30);

const links = files
  .map((name) => {
    const date = name.replace("sex-", "").replace(".html", "");
    const d = new Date(date + "T00:00:00");
    const display = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
    const wd = WEEKDAYS[d.getDay()];
    return `<li><a href="${name}">📅 ${display}（週${wd}）</a></li>`;
  })
  .join("\n");

const total = files.length;

const index = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Sex Brain · 性學文獻日報</title>
<style>
  :root { --bg: #fdf4f0; --surface: #fffaf6; --line: #e8cfc4; --text: #2d1f1a; --muted: #8a6055; --accent: #c44d3f; --accent-soft: #f5d5cf; }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: radial-gradient(circle at top, #fff5f0 0, var(--bg) 55%, #f0d8cf 100%); color: var(--text); font-family: "Noto Sans TC", "PingFang TC", "Helvetica Neue", Arial, sans-serif; min-height: 100vh; }
  .container { position: relative; z-index: 1; max-width: 640px; margin: 0 auto; padding: 80px 24px; }
  .logo { font-size: 48px; text-align: center; margin-bottom: 16px; }
  h1 { text-align: center; font-size: 24px; color: var(--text); margin-bottom: 8px; }
  .subtitle { text-align: center; color: var(--accent); font-size: 14px; margin-bottom: 48px; }
  .count { text-align: center; color: var(--muted); font-size: 13px; margin-bottom: 32px; }
  ul { list-style: none; }
  li { margin-bottom: 8px; }
  a { color: var(--text); text-decoration: none; display: block; padding: 14px 20px; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; transition: all 0.2s; font-size: 15px; }
  a:hover { background: var(--accent-soft); border-color: var(--accent); transform: translateX(4px); }
  footer { margin-top: 56px; text-align: center; font-size: 12px; color: var(--muted); }
  footer a { display: inline; padding: 0; background: none; border: none; color: var(--muted); }
  footer a:hover { color: var(--accent); }
</style>
</head>
<body>
<div class="container">
  <div class="logo">🧠</div>
  <h1>Sex Brain</h1>
  <p class="subtitle">性學文獻日報 · 每日自動更新</p>
  <p class="count">共 ${total} 期日報</p>
  <ul>${links}</ul>
  <footer>
    <p>Powered by PubMed + Zhipu AI · <a href="https://github.com/u8901006/sex-brain">GitHub</a></p>
  </footer>
</div>
</body>
</html>`;

writeFileSync("docs/index.html", index, "utf8");
console.log("Index page generated");
