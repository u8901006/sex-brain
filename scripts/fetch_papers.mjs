import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { XMLParser } from "fast-xml-parser";

const PUBMED_SEARCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const PUBMED_FETCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";

const JOURNALS = [
  "The Journal of Sexual Medicine",
  "Sexual Medicine Reviews",
  "Archives of Sexual Behavior",
  "The Journal of Sex Research",
  "International Journal of Sexual Health",
  "Sexual Health",
  "Sexual Medicine",
  "Sexual and Reproductive Healthcare",
  "Journal of Sex & Marital Therapy",
  "Psychology & Sexuality",
  "Sexuality Research and Social Policy",
  "Sexual and Relationship Therapy",
  "Sexologies",
  "Sexuality & Culture",
  "Sexualities",
  "Sex Education",
  "Sexuality and Disability",
  "Psychoneuroendocrinology",
  "Hormones and Behavior",
];

function buildQuery(days = 7) {
  const journalPart = JOURNALS.map((j) => `"${j}"[Journal]`).join(" OR ");
  const lookback = new Date(Date.now() - days * 86400000);
  const lb = `${lookback.getUTCFullYear()}/${String(lookback.getUTCMonth() + 1).padStart(2, "0")}/${String(lookback.getUTCDate()).padStart(2, "0")}`;
  return `(${journalPart}) AND "${lb}"[Date - Publication] : "3000"[Date - Publication]`;
}

async function searchPapers(query, retmax = 50) {
  const url = `${PUBMED_SEARCH}?db=pubmed&term=${encodeURIComponent(query)}&retmax=${retmax}&sort=date&retmode=json`;
  try {
    const resp = await fetch(url, { headers: { "User-Agent": "SexBrainBot/1.0" } });
    const data = await resp.json();
    return data?.esearchresult?.idlist ?? [];
  } catch (e) {
    console.error(`[ERROR] PubMed search failed: ${e.message}`);
    return [];
  }
}

async function fetchDetails(pmids) {
  if (!pmids.length) return [];
  const url = `${PUBMED_FETCH}?db=pubmed&id=${pmids.join(",")}&retmode=xml`;
  let xml;
  try {
    const resp = await fetch(url, { headers: { "User-Agent": "SexBrainBot/1.0" } });
    xml = await resp.text();
  } catch (e) {
    console.error(`[ERROR] PubMed fetch failed: ${e.message}`);
    return [];
  }

  const parser = new XMLParser({ ignoreAttributes: false });
  const root = parser.parse(xml);
  const articles = root?.PubmedArticleSet?.PubmedArticle ?? [];
  const list = Array.isArray(articles) ? articles : [articles];

  return list.map((article) => {
    const medline = article.MedlineCitation ?? {};
    const art = medline.Article ?? {};
    const title = art.ArticleTitle ?? "";

    let abstract = "";
    const absTexts = art.Abstract?.AbstractText;
    if (absTexts) {
      const arr = Array.isArray(absTexts) ? absTexts : [absTexts];
      abstract = arr
        .map((a) => {
          const label = a["@_Label"] ?? "";
          const text = typeof a === "string" ? a : a["#text"] ?? "";
          return label && text ? `${label}: ${text}` : text;
        })
        .join(" ")
        .slice(0, 2000);
    }

    const journal = art.Journal?.Title ?? "";
    const pd = art.Journal?.JournalIssue?.PubDate;
    const dateParts = [pd?.Year, pd?.Month, pd?.Day].filter(Boolean);
    const dateStr = dateParts.join(" ");

    const pmid = medline.PMID?.["#text"] ?? medline.PMID ?? "";
    const link = pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : "";

    const kwList = medline.KeywordList?.Keyword ?? [];
    const keywords = (Array.isArray(kwList) ? kwList : [kwList])
      .map((k) => (typeof k === "string" ? k : k["#text"] ?? ""))
      .filter(Boolean);

    return { pmid, title, journal, date: dateStr, abstract, url: link, keywords };
  });
}

function parseCli() {
  const { values } = parseArgs({
    options: {
      days: { type: "string", default: "7" },
      "max-papers": { type: "string", default: "40" },
      output: { type: "string", default: "-" },
    },
    strict: true,
  });
  return {
    days: parseInt(values.days, 10),
    maxPapers: parseInt(values["max-papers"], 10),
    output: values.output,
  };
}

function taipeiDate() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
}

async function main() {
  const { days, maxPapers, output } = parseCli();
  const query = buildQuery(days);
  console.error(`[INFO] Searching PubMed for papers from last ${days} days...`);

  const pmids = await searchPapers(query, maxPapers);
  console.error(`[INFO] Found ${pmids.length} papers`);

  if (!pmids.length) {
    console.error("NO_CONTENT");
    const empty = { date: taipeiDate(), count: 0, papers: [] };
    const str = JSON.stringify(empty, null, 2);
    if (output === "-") console.log(str);
    else writeFileSync(output, str, "utf8");
    return;
  }

  const papers = await fetchDetails(pmids);
  console.error(`[INFO] Fetched details for ${papers.length} papers`);

  const result = { date: taipeiDate(), count: papers.length, papers };
  const str = JSON.stringify(result, null, 2);

  if (output === "-") console.log(str);
  else {
    writeFileSync(output, str, "utf8");
    console.error(`[INFO] Saved to ${output}`);
  }
}

main();
