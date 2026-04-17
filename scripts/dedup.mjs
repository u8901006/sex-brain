import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";

const PMID_RE = /pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/g;

function extractPmidsFromHtml(dir) {
  const pmids = new Set();
  const today = new Date();
  const cutoff = new Date(today.getTime() - 7 * 86400000);

  let files;
  try {
    files = readdirSync(dir).filter((f) => /^sex-\d{4}-\d{2}-\d{2}\.html$/.test(f));
  } catch {
    return pmids;
  }

  for (const name of files) {
    const dateStr = name.replace("sex-", "").replace(".html", "");
    const fileDate = new Date(dateStr + "T00:00:00");
    if (fileDate < cutoff) continue;

    try {
      const html = readFileSync(`${dir}/${name}`, "utf8");
      let match;
      while ((match = PMID_RE.exec(html)) !== null) {
        pmids.add(match[1]);
      }
    } catch {}
  }

  return pmids;
}

function main() {
  const papersPath = "papers.json";
  if (!existsSync(papersPath)) {
    console.error("[INFO] No papers.json, skipping dedup");
    return;
  }

  const data = JSON.parse(readFileSync(papersPath, "utf8"));
  const before = data.papers?.length ?? 0;
  if (!before) {
    console.error("[INFO] No papers to dedup");
    return;
  }

  const seen = extractPmidsFromHtml("docs");
  console.error(`[INFO] Found ${seen.size} PMIDs in previous 7-day reports`);

  const filtered = data.papers.filter((p) => !seen.has(p.pmid));
  const removed = before - filtered.length;

  data.papers = filtered;
  data.count = filtered.length;

  writeFileSync(papersPath, JSON.stringify(data, null, 2), "utf8");
  console.error(`[INFO] Dedup: ${before} → ${filtered.length} (removed ${removed} duplicates)`);
}

main();
