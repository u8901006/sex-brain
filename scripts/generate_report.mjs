import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { parseArgs } from "node:util";
import { dirname } from "node:path";

const API_BASE = process.env.ZHIPU_API_BASE ?? "https://open.bigmodel.cn/api/coding/paas/v4";
const MODEL_NAME = process.env.ZHIPU_MODEL ?? "GLM-5-Turbo";

const SYSTEM_PROMPT = [
  "你是性學、性諮商與性神經科學領域的資深研究員與科學傳播者。你的任務是：",
  "1. 從提供的醫學文獻中，篩選出最具臨床意義與研究價值的論文",
  "2. 對每篇論文進行繁體中文摘要、分類、PICO 分析",
  "3. 評估其臨床實用性（高/中/低）",
  "4. 生成適合醫療專業人員與性諮商師閱讀的日報",
  "",
  "輸出格式要求：",
  "- 語言：繁體中文（台灣用語）",
  "- 專業但易懂",
  "- 每篇論文需包含：中文標題、一句話總結、PICO分析、臨床實用性、分類標籤",
  "- 最後提供今日精選 TOP 3（最重要/最影響臨床實踐的論文）",
  "回傳格式必須是純 JSON，不要用 markdown code block 包裹。",
].join("\n");

function taipeiDate() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function inferTags(paper) {
  const haystack = `${paper.title ?? ""} ${paper.abstract ?? ""} ${paper.journal ?? ""}`.toLowerCase();
  const rules = [
    ["勃起功能障礙", ["erectile dysfunction"]],
    ["早洩", ["premature ejaculation"]],
    ["女性性功能障礙", ["female sexual dysfunction"]],
    ["性慾低落", ["hypoactive sexual desire disorder", "low sexual desire", "libido", "sexual desire"]],
    ["性交疼痛", ["dyspareunia", "sexual pain"]],
    ["陰道痙攣", ["vaginismus"]],
    ["性諮商", ["sexual counseling", "counseling", "psychosexual"]],
    ["性治療", ["sex therapy", "psychosexual therapy"]],
    ["伴侶治療", ["couple therapy", "marital therapy", "relationship"]],
    ["性神經科學", ["sexual neuroscience", "brain", "fmri", "neuro", "reward"]],
    ["神經內分泌", ["psychoneuroendocrinology", "hormone", "neuroendocr", "estradiol", "progesterone"]],
    ["睪固酮", ["testosterone"]],
    ["催產素", ["oxytocin"]],
    ["多巴胺", ["dopamine"]],
    ["性健康", ["sexual health", "sexual medicine"]],
    ["性滿意度", ["sexual satisfaction"]],
    ["性教育", ["sex education", "sexuality education"]],
    ["LGBTQ+", ["lgbtq", "sexual minority", "gender identity", "sexual orientation", "queer", "transgender"]],
    ["性少數健康", ["sexual minority"]],
    ["性權利", ["sexual rights"]],
    ["性暴力", ["sexual violence", "sexual abuse", "assault"]],
    ["性成癮", ["sexual addiction", "compulsive sexual behavior"]],
    ["色情內容", ["pornography", "pornographic"]],
    ["跨性別健康", ["transgender"]],
    ["性慾望差異", ["desire discrepancy"]],
    ["更年期性健康", ["menopause", "genitourinary syndrome of menopause"]],
    ["性復健", ["disability", "rehabilitation", "spinal cord injury"]],
    ["身心醫學", ["psychosocial", "mental health", "psychiatry"]],
    ["公共衛生", ["public health", "policy", "implementation", "sti", "hiv", "prep"]],
  ];

  const tags = rules.filter(([, needles]) => needles.some((needle) => haystack.includes(needle))).map(([tag]) => tag);
  return tags.slice(0, 3).length ? tags.slice(0, 3) : ["性健康"];
}

function pickEmoji(tags) {
  const emojiMap = {
    "勃起功能障礙": "🩺",
    "早洩": "⏱️",
    "女性性功能障礙": "🌸",
    "性慾低落": "💭",
    "性交疼痛": "🫧",
    "性諮商": "🗣️",
    "性治療": "🛋️",
    "伴侶治療": "💞",
    "性神經科學": "🧠",
    "神經內分泌": "🧬",
    "睪固酮": "🧪",
    "催產素": "💗",
    "多巴胺": "⚡",
    "LGBTQ+": "🏳️‍🌈",
    "性教育": "📘",
    "性暴力": "🚨",
    "跨性別健康": "⚧️",
    "公共衛生": "🌍",
  };
  return tags.map((tag) => emojiMap[tag]).find(Boolean) ?? "📄";
}

function summarizePaper(paper) {
  const abstract = (paper.abstract ?? "").replace(/\s+/g, " ").trim();
  if (!abstract) return "本篇文獻提供最新研究更新，建議直接閱讀原文摘要與全文以掌握研究設計與臨床意義。";

  const firstSentence = abstract.split(/(?<=[.!?])\s+/)[0]?.trim() ?? abstract;
  return firstSentence.length <= 120 ? firstSentence : `${firstSentence.slice(0, 117)}...`;
}

function buildFallbackAnalysis(papersData, reason) {
  const papers = papersData.papers ?? [];
  const enriched = papers.map((paper, index) => {
    const tags = inferTags(paper);
    return {
      rank: index + 1,
      title_zh: paper.title ?? "",
      title_en: paper.title ?? "",
      journal: paper.journal ?? "",
      summary: summarizePaper(paper),
      pico: {
        population: "請見原文摘要",
        intervention: "請見原文摘要",
        comparison: "請見原文摘要",
        outcome: "請見原文摘要",
      },
      clinical_utility: index < 5 ? "中" : "低",
      utility_reason: "AI 分析暫時不可用，請以原文內容為準。",
      tags,
      url: paper.url ?? "",
      emoji: pickEmoji(tags),
    };
  });

  const topPicks = enriched.slice(0, Math.min(5, enriched.length)).map((paper, index) => ({
    ...paper,
    rank: index + 1,
  }));
  const allPapers = enriched.slice(topPicks.length).map(({ rank, pico, utility_reason, ...paper }) => paper);

  const topicDistribution = {};
  for (const paper of enriched) {
    for (const tag of paper.tags) {
      topicDistribution[tag] = (topicDistribution[tag] ?? 0) + 1;
    }
  }

  const keywords = [...new Set(enriched.flatMap((paper) => paper.tags))].slice(0, 12);

  return {
    date: papersData.date ?? taipeiDate(),
    market_summary: `本頁由系統自動 fallback 產生。原因：${reason}。今日共整理 ${papers.length} 篇近 7 天尚未收錄的文獻，內容以 PubMed 原始標題與摘要為主。`,
    top_picks: topPicks,
    all_papers: allPapers,
    keywords,
    topic_distribution: topicDistribution,
  };
}

function buildDeterministicPaper(paper, index, utility = "低") {
  const tags = inferTags(paper);
  return {
    pmid: paper.pmid ?? "",
    title_zh: paper.title ?? "",
    title_en: paper.title ?? "",
    journal: paper.journal ?? "",
    summary: summarizePaper(paper),
    clinical_utility: utility,
    tags,
    url: paper.url ?? "",
    emoji: pickEmoji(tags),
  };
}

function prepareAiCandidates(papers, limit = 12) {
  return papers.slice(0, limit).map((paper) => ({
    pmid: paper.pmid ?? "",
    title: paper.title ?? "",
    journal: paper.journal ?? "",
    date: paper.date ?? "",
    abstract: (paper.abstract ?? "").replace(/\s+/g, " ").trim().slice(0, 700),
    keywords: (paper.keywords ?? []).slice(0, 8),
    url: paper.url ?? "",
  }));
}

function mergeAiAnalysis(aiResult, papersData) {
  const allRawPapers = papersData.papers ?? [];
  const paperByPmid = new Map(allRawPapers.map((paper) => [paper.pmid, paper]));
  const topPicks = (aiResult.top_picks ?? []).map((pick, index) => {
    const paper = paperByPmid.get(pick.pmid) ?? {};
    const tags = pick.tags?.length ? pick.tags : inferTags(paper);
    return {
      rank: index + 1,
      pmid: pick.pmid ?? paper.pmid ?? "",
      title_zh: pick.title_zh ?? paper.title ?? "",
      title_en: pick.title_en ?? paper.title ?? "",
      journal: pick.journal ?? paper.journal ?? "",
      summary: pick.summary ?? summarizePaper(paper),
      pico: pick.pico ?? {
        population: "請見原文摘要",
        intervention: "請見原文摘要",
        comparison: "請見原文摘要",
        outcome: "請見原文摘要",
      },
      clinical_utility: pick.clinical_utility ?? "中",
      utility_reason: pick.utility_reason ?? "",
      tags,
      url: pick.url ?? paper.url ?? "",
      emoji: pick.emoji ?? pickEmoji(tags),
    };
  });

  const topPmids = new Set(topPicks.map((paper) => paper.pmid).filter(Boolean));
  const allPapers = allRawPapers
    .filter((paper) => !topPmids.has(paper.pmid))
    .map((paper, index) => buildDeterministicPaper(paper, index, index < 8 ? "中" : "低"));

  return {
    date: aiResult.date ?? papersData.date ?? taipeiDate(),
    market_summary:
      aiResult.market_summary ??
      `今日共整理 ${allRawPapers.length} 篇近 7 天尚未收錄的文獻，重點已由 AI 篩出精選論文，其餘文獻採系統摘要整理。`,
    top_picks: topPicks,
    all_papers: allPapers,
    keywords: aiResult.keywords ?? [...new Set(topPicks.flatMap((paper) => paper.tags ?? []))].slice(0, 12),
    topic_distribution: aiResult.topic_distribution ?? {},
  };
}

async function analyzePapers(apiKey, papersData) {
  const dateStr = papersData.date ?? taipeiDate();
  const paperCount = papersData.count ?? 0;
  const candidatePapers = prepareAiCandidates(papersData.papers ?? []);
  const papersText = JSON.stringify(candidatePapers, null, 2);

  const prompt = `以下是 ${dateStr} 從 PubMed 抓取的最新性學、性諮商與性神經科學文獻。系統已先選出 ${candidatePapers.length} 篇候選文獻供 AI 精選，完整日報總數為 ${paperCount} 篇。

請只針對這 ${candidatePapers.length} 篇候選文獻做精選分析，並以 JSON 格式回傳（不要用 markdown code block）：

{
  "date": "${dateStr}",
  "market_summary": "1-2句話總結今天文獻的整體趨勢與亮點",
  "top_picks": [
    {
      "rank": 1,
      "pmid": "PubMed ID",
      "title_zh": "中文標題",
      "title_en": "English Title",
      "journal": "期刊名",
      "summary": "一句話總結（繁體中文，點出核心發現與臨床意義）",
      "pico": { "population": "研究對象", "intervention": "介入措施", "comparison": "對照組", "outcome": "主要結果" },
      "clinical_utility": "高/中/低",
      "utility_reason": "為什麼實用的一句話說明",
      "tags": ["標籤1", "標籤2"],
      "url": "原文連結",
      "emoji": "相關emoji"
    }
  ],
  "keywords": ["關鍵字1", "關鍵字2"],
  "topic_distribution": { "性功能障礙": 3, "性諮商": 2 }
}

原始文獻資料：
${papersText}

請從候選文獻中篩選出最重要的 TOP 5-8 篇論文放入 top_picks（按重要性排序）。
每篇 paper 的 tags 請從以下選擇：性功能障礙、勃起功能障礙、早洩、女性性功能障礙、性慾低落、性交疼痛、性諮商、性治療、伴侶治療、性神經科學、神經內分泌、睪固酮、催產素、多巴胺、性健康、性滿意度、性教育、LGBTQ+、性少數健康、性權利、性暴力、性成癮、色情內容、跨性別健康、性慾望差異、陰道痙攣、更年期性健康、性復健、身心醫學、公共衛生。
記住：回傳純 JSON，不要用 \`\`\`json\`\`\` 包裹。`;

  const modelsToTry = [MODEL_NAME, "GLM-4.7", "GLM-4.7-Flash"];

  for (const model of modelsToTry) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        console.error(`[INFO] Trying ${model} (attempt ${attempt + 1})...`);
        const resp = await fetch(`${API_BASE}/chat/completions`, {
          method: "POST",
          signal: AbortSignal.timeout(120000),
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: prompt },
            ],
            temperature: 0.3,
            top_p: 0.9,
            max_tokens: 4096,
          }),
        });

        if (resp.status === 429) {
          const wait = 60000 * (attempt + 1);
          console.error(`[WARN] Rate limited, waiting ${wait / 1000}s...`);
          await sleep(wait);
          continue;
        }

        if (!resp.ok) {
          const body = await resp.text();
          console.error(`[ERROR] HTTP ${resp.status}: ${body.slice(0, 200)}`);
          if (resp.status === 429) {
            await sleep(60000 * (attempt + 1));
            continue;
          }
          break;
        }

        const data = await resp.json();
        let text = data.choices[0].message.content.trim();
        if (text.startsWith("```")) {
          text = text.includes("\n") ? text.split("\n").slice(1).join("\n") : text.slice(3);
          text = text.replace(/`+$/, "").trim();
        }

        const result = JSON.parse(text);
        console.error(
          `[INFO] Analysis complete: ${result.top_picks?.length ?? 0} top picks, ${result.all_papers?.length ?? 0} total`,
        );
        return mergeAiAnalysis(result, papersData);
      } catch (e) {
        if (e instanceof SyntaxError) {
          console.error(`[WARN] JSON parse failed on attempt ${attempt + 1}: ${e.message}`);
          if (attempt < 2) await sleep(5000);
          continue;
        }
        console.error(`[ERROR] ${model} failed: ${e.message}`);
        break;
      }
    }
  }

  console.error("[ERROR] All models and attempts failed");
  return null;
}

function generateHtml(analysis) {
  const dateStr = analysis.date ?? taipeiDate();
  const parts = dateStr.split("-");
  const dateDisplay = parts.length === 3 ? `${parts[0]}年${parseInt(parts[1])}月${parseInt(parts[2])}日` : dateStr;

  const summary = analysis.market_summary ?? "";
  const topPicks = analysis.top_picks ?? [];
  const allPapers = analysis.all_papers ?? [];
  const keywords = analysis.keywords ?? [];
  const topicDist = analysis.topic_distribution ?? {};

  const renderTags = (tags) => tags.map((t) => `<span class="tag">${t}</span>`).join("");

  const utilityClass = (u) => {
    if (u === "高") return "utility-high";
    if (u === "中") return "utility-mid";
    return "utility-low";
  };

  const topPicksHtml = topPicks
    .map((p) => {
      const uc = utilityClass(p.clinical_utility ?? "中");
      const picoHtml = p.pico
        ? `<div class="pico-grid">
  <div class="pico-item"><span class="pico-label">P</span><span class="pico-text">${p.pico.population ?? "-"}</span></div>
  <div class="pico-item"><span class="pico-label">I</span><span class="pico-text">${p.pico.intervention ?? "-"}</span></div>
  <div class="pico-item"><span class="pico-label">C</span><span class="pico-text">${p.pico.comparison ?? "-"}</span></div>
  <div class="pico-item"><span class="pico-label">O</span><span class="pico-text">${p.pico.outcome ?? "-"}</span></div>
</div>`
        : "";
      return `<div class="news-card featured">
  <div class="card-header">
    <span class="rank-badge">#${p.rank ?? ""}</span>
    <span class="emoji-icon">${p.emoji ?? "📄"}</span>
    <span class="${uc}">${p.clinical_utility ?? "中"}實用性</span>
  </div>
  <h3>${p.title_zh ?? p.title_en ?? ""}</h3>
  <p class="journal-source">${p.journal ?? ""} · ${p.title_en ?? ""}</p>
  <p>${p.summary ?? ""}</p>
  ${picoHtml}
  <div class="card-footer">
    ${renderTags(p.tags ?? [])}
    <a href="${p.url ?? "#"}" target="_blank">閱讀原文 →</a>
  </div>
</div>`;
    })
    .join("\n");

  const allPapersHtml = allPapers
    .map((p) => {
      const uc = utilityClass(p.clinical_utility ?? "中");
      return `<div class="news-card">
  <div class="card-header-row">
    <span class="emoji-sm">${p.emoji ?? "📄"}</span>
    <span class="${uc} utility-sm">${p.clinical_utility ?? "中"}</span>
  </div>
  <h3>${p.title_zh ?? p.title_en ?? ""}</h3>
  <p class="journal-source">${p.journal ?? ""}</p>
  <p>${p.summary ?? ""}</p>
  <div class="card-footer">
    ${renderTags(p.tags ?? [])}
    <a href="${p.url ?? "#"}" target="_blank">PubMed →</a>
  </div>
</div>`;
    })
    .join("\n");

  const keywordsHtml = keywords.map((k) => `<span class="keyword">${k}</span>`).join("");

  const maxCount = topicDist ? Math.max(...Object.values(topicDist), 1) : 1;
  const topicBarsHtml = Object.entries(topicDist)
    .map(
      ([topic, count]) => `<div class="topic-row">
  <span class="topic-name">${topic}</span>
  <div class="topic-bar-bg"><div class="topic-bar" style="width:${Math.round((count / maxCount) * 100)}%"></div></div>
  <span class="topic-count">${count}</span>
</div>`,
    )
    .join("\n");

  const totalCount = topPicks.length + allPapers.length;

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Sex Brain · 性學文獻日報 · ${dateDisplay}</title>
<meta name="description" content="${dateDisplay} 性學、性諮商、性神經科學文獻日報，由 AI 自動彙整 PubMed 最新論文"/>
<style>
  :root { --bg: #fdf4f0; --surface: #fffaf6; --line: #e8cfc4; --text: #2d1f1a; --muted: #8a6055; --accent: #c44d3f; --accent-soft: #f5d5cf; --card-bg: color-mix(in srgb, var(--surface) 92%, white); }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: radial-gradient(circle at top, #fff5f0 0, var(--bg) 55%, #f0d8cf 100%); color: var(--text); font-family: "Noto Sans TC", "PingFang TC", "Helvetica Neue", Arial, sans-serif; min-height: 100vh; overflow-x: hidden; }
  .container { position: relative; z-index: 1; max-width: 880px; margin: 0 auto; padding: 60px 32px 80px; }
  header { display: flex; align-items: center; gap: 16px; margin-bottom: 52px; animation: fadeDown 0.6s ease both; }
  .logo { width: 48px; height: 48px; border-radius: 14px; background: var(--accent); display: flex; align-items: center; justify-content: center; font-size: 22px; flex-shrink: 0; box-shadow: 0 4px 20px rgba(196,77,63,0.25); }
  .header-text h1 { font-size: 22px; font-weight: 700; color: var(--text); letter-spacing: -0.3px; }
  .header-meta { display: flex; gap: 8px; margin-top: 6px; flex-wrap: wrap; align-items: center; }
  .badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 11px; letter-spacing: 0.3px; }
  .badge-date { background: var(--accent-soft); border: 1px solid var(--line); color: var(--accent); }
  .badge-count { background: rgba(196,77,63,0.06); border: 1px solid var(--line); color: var(--muted); }
  .badge-source { background: transparent; color: var(--muted); font-size: 11px; padding: 0 4px; }
  .summary-card { background: var(--card-bg); border: 1px solid var(--line); border-radius: 24px; padding: 28px 32px; margin-bottom: 32px; box-shadow: 0 20px 60px rgba(80,30,20,0.06); animation: fadeUp 0.5s ease 0.1s both; }
  .summary-card h2 { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.6px; color: var(--accent); margin-bottom: 16px; }
  .summary-text { font-size: 15px; line-height: 1.8; color: var(--text); }
  .section { margin-bottom: 36px; animation: fadeUp 0.5s ease both; }
  .section-title { display: flex; align-items: center; gap: 10px; font-size: 17px; font-weight: 700; color: var(--text); margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--line); }
  .section-icon { width: 28px; height: 28px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 14px; flex-shrink: 0; background: var(--accent-soft); }
  .news-card { background: var(--card-bg); border: 1px solid var(--line); border-radius: 24px; padding: 22px 26px; margin-bottom: 12px; box-shadow: 0 8px 30px rgba(80,30,20,0.04); transition: background 0.2s, border-color 0.2s, transform 0.2s; }
  .news-card:hover { transform: translateY(-2px); box-shadow: 0 12px 40px rgba(80,30,20,0.08); }
  .news-card.featured { border-left: 3px solid var(--accent); }
  .news-card.featured:hover { border-color: var(--accent); }
  .card-header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
  .rank-badge { background: var(--accent); color: #fff5f0; font-weight: 700; font-size: 12px; padding: 2px 8px; border-radius: 6px; }
  .emoji-icon { font-size: 18px; }
  .card-header-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .emoji-sm { font-size: 14px; }
  .news-card h3 { font-size: 15px; font-weight: 600; color: var(--text); margin-bottom: 8px; line-height: 1.5; }
  .journal-source { font-size: 12px; color: var(--accent); margin-bottom: 8px; opacity: 0.8; }
  .news-card p { font-size: 13.5px; line-height: 1.75; color: var(--muted); }
  .card-footer { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .tag { padding: 2px 9px; background: var(--accent-soft); border-radius: 999px; font-size: 11px; color: var(--accent); }
  .news-card a { font-size: 12px; color: var(--accent); text-decoration: none; opacity: 0.7; margin-left: auto; }
  .news-card a:hover { opacity: 1; }
  .utility-high { color: #5a7a3a; font-size: 11px; font-weight: 600; padding: 2px 8px; background: rgba(90,122,58,0.1); border-radius: 4px; }
  .utility-mid { color: #9f7a2e; font-size: 11px; font-weight: 600; padding: 2px 8px; background: rgba(159,122,46,0.1); border-radius: 4px; }
  .utility-low { color: var(--muted); font-size: 11px; font-weight: 600; padding: 2px 8px; background: rgba(138,96,85,0.08); border-radius: 4px; }
  .utility-sm { font-size: 10px; }
  .pico-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; padding: 12px; background: rgba(255,253,249,0.8); border-radius: 14px; border: 1px solid var(--line); }
  .pico-item { display: flex; gap: 8px; align-items: baseline; }
  .pico-label { font-size: 10px; font-weight: 700; color: #fff5f0; background: var(--accent); padding: 2px 6px; border-radius: 4px; flex-shrink: 0; }
  .pico-text { font-size: 12px; color: var(--muted); line-height: 1.4; }
  .keywords-section { margin-bottom: 36px; }
  .keywords { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  .keyword { padding: 5px 14px; background: var(--accent-soft); border: 1px solid var(--line); border-radius: 20px; font-size: 12px; color: var(--accent); cursor: default; transition: background 0.2s; }
  .keyword:hover { background: rgba(196,77,63,0.18); }
  .topic-section { margin-bottom: 36px; }
  .topic-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .topic-name { font-size: 13px; color: var(--muted); width: 100px; flex-shrink: 0; text-align: right; }
  .topic-bar-bg { flex: 1; height: 8px; background: var(--line); border-radius: 4px; overflow: hidden; }
  .topic-bar { height: 100%; background: linear-gradient(90deg, var(--accent), #e07060); border-radius: 4px; transition: width 0.6s ease; }
  .topic-count { font-size: 12px; color: var(--accent); width: 24px; }
  .links-banner { margin-top: 36px; display: flex; flex-direction: column; gap: 12px; animation: fadeUp 0.5s ease 0.4s both; }
  .banner-link { display: flex; align-items: center; gap: 14px; padding: 18px 24px; background: var(--card-bg); border: 1px solid var(--line); border-radius: 24px; text-decoration: none; color: var(--text); transition: all 0.2s; box-shadow: 0 8px 30px rgba(80,30,20,0.04); }
  .banner-link:hover { border-color: var(--accent); transform: translateY(-2px); box-shadow: 0 12px 40px rgba(80,30,20,0.08); }
  .banner-icon { font-size: 28px; flex-shrink: 0; }
  .banner-name { font-size: 15px; font-weight: 700; color: var(--text); flex: 1; }
  .banner-arrow { font-size: 18px; color: var(--accent); font-weight: 700; }
  footer { margin-top: 32px; padding-top: 22px; border-top: 1px solid var(--line); font-size: 11.5px; color: var(--muted); display: flex; justify-content: space-between; animation: fadeUp 0.5s ease 0.5s both; }
  footer a { color: var(--muted); text-decoration: none; }
  footer a:hover { color: var(--accent); }
  @keyframes fadeDown { from { opacity: 0; transform: translateY(-16px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes fadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
  @media (max-width: 600px) { .container { padding: 36px 18px 60px; } .summary-card, .news-card { padding: 20px 18px; } .pico-grid { grid-template-columns: 1fr; } footer { flex-direction: column; gap: 6px; text-align: center; } .topic-name { width: 70px; font-size: 11px; } }
</style>
</head>
<body>
<div class="container">
  <header>
    <div class="logo">🧠</div>
    <div class="header-text">
      <h1>Sex Brain · 性學文獻日報</h1>
      <div class="header-meta">
        <span class="badge badge-date">📅 ${dateDisplay}</span>
        <span class="badge badge-count">📊 ${totalCount} 篇文獻</span>
        <span class="badge badge-source">Powered by PubMed + Zhipu AI</span>
      </div>
    </div>
  </header>

  <div class="summary-card">
    <h2>📋 今日文獻趨勢</h2>
    <p class="summary-text">${summary}</p>
  </div>

  ${topPicksHtml ? `<div class="section"><div class="section-title"><span class="section-icon">⭐</span>今日精選 TOP Picks</div>${topPicksHtml}</div>` : ""}

  ${allPapersHtml ? `<div class="section"><div class="section-title"><span class="section-icon">📚</span>其他值得關注的文獻</div>${allPapersHtml}</div>` : ""}

  ${topicBarsHtml ? `<div class="topic-section section"><div class="section-title"><span class="section-icon">📊</span>主題分佈</div>${topicBarsHtml}</div>` : ""}

  ${keywordsHtml ? `<div class="keywords-section section"><div class="section-title"><span class="section-icon">🏷️</span>關鍵字</div><div class="keywords">${keywordsHtml}</div></div>` : ""}

  <div class="links-banner">
    <a href="https://www.leepsyclinic.com/" class="banner-link" target="_blank">
      <span class="banner-icon">🏥</span>
      <span class="banner-name">李政洋身心診所首頁</span>
      <span class="banner-arrow">→</span>
    </a>
    <a href="https://blog.leepsyclinic.com/" class="banner-link" target="_blank">
      <span class="banner-icon">📨</span>
      <span class="banner-name">訂閱電子報</span>
      <span class="banner-arrow">→</span>
    </a>
  </div>

  <footer>
    <span>資料來源：PubMed · 分析模型：${MODEL_NAME}</span>
    <span><a href="https://github.com/u8901006/sex-brain">GitHub</a></span>
  </footer>
</div>
</body>
</html>`;
}

async function main() {
  const { values } = parseArgs({
    options: {
      input: { type: "string" },
      output: { type: "string" },
      "api-key": { type: "string", default: process.env.ZHIPU_API_KEY ?? "" },
    },
    strict: true,
  });

  const input = values.input;
  const output = values.output;
  const apiKey = values["api-key"];

  if (!apiKey) {
    console.error("[ERROR] No API key provided. Set ZHIPU_API_KEY env var or use --api-key");
    process.exit(1);
  }

  const papersData = JSON.parse(readFileSync(input, "utf8"));

  let analysis;
  if (!papersData?.papers?.length) {
    console.error("[WARN] No papers found, generating empty report");
    analysis = {
      date: taipeiDate(),
      market_summary: "今日 PubMed 暫無新的性學文獻更新。請明天再查看。",
      top_picks: [],
      all_papers: [],
      keywords: [],
      topic_distribution: {},
    };
  } else {
    analysis = await analyzePapers(apiKey, papersData);
    if (!analysis) {
      console.error("[WARN] AI analysis failed, generating fallback report instead");
      analysis = buildFallbackAnalysis(
        papersData,
        "Zhipu API 失敗、被限流、內容過濾，或回傳非合法 JSON",
      );
    }
  }

  const html = generateHtml(analysis);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, html, "utf8");
  console.error(`[INFO] Report saved to ${output}`);
}

main();
