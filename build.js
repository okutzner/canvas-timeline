/**
 * build.js
 * Fetches course data from Canvas API and generates a static HTML dashboard.
 * Run manually or via GitHub Actions on a schedule.
 */

const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

const CANVAS_URL = process.env.CANVAS_URL || "https://curtin.instructure.com";
const CANVAS_TOKEN = process.env.CANVAS_TOKEN;
const ACCOUNT_IDS = (process.env.ACCOUNT_IDS || "229,121,123,114,224,226")
  .split(",")
  .map((id) => id.trim());

if (!CANVAS_TOKEN) {
  console.error("ERROR: CANVAS_TOKEN environment variable is required.");
  process.exit(1);
}

// ── Fetch helpers ──────────────────────────────────────────────────────────

async function fetchAllPages(url) {
  const results = [];
  let nextUrl = url;
  while (nextUrl) {
    const res = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${CANVAS_TOKEN}` },
    });
    if (!res.ok) {
      console.error(`  ✗ ${res.status} for ${nextUrl}`);
      break;
    }
    results.push(...(await res.json()));
    const link = res.headers.get("link") || "";
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    nextUrl = m ? m[1] : null;
  }
  return results;
}

async function fetchAccountNames() {
  try {
    const res = await fetch(`${CANVAS_URL}/api/v1/accounts`, {
      headers: { Authorization: `Bearer ${CANVAS_TOKEN}` },
    });
    if (!res.ok) return {};
    const accounts = await res.json();
    const map = {};
    accounts.forEach((a) => (map[a.id] = a.name));
    return map;
  } catch {
    return {};
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("Canvas Course Timeline — Build\n");

  const accountNames = await fetchAccountNames();
  const allCourses = [];

  for (const id of ACCOUNT_IDS) {
    const url = `${CANVAS_URL}/api/v1/accounts/${id}/courses?per_page=100`;
    console.log(`Fetching account ${id} (${accountNames[id] || "?"})...`);
    const courses = await fetchAllPages(url);
    console.log(`  ✓ ${courses.length} courses`);
    allCourses.push(...courses);
  }

  // Deduplicate
  const seen = new Set();
  const unique = allCourses.filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });

  // Transform
  const processed = unique.map((c) => ({
    id: c.id,
    n: c.name,
    s: c.start_at ? c.start_at.split("T")[0] : null,
    e: c.end_at ? c.end_at.split("T")[0] : null,
    st: c.workflow_state,
    ac: accountNames[c.account_id] || `Account ${c.account_id}`,
    sis: c.sis_course_id || null,
  }));

  console.log(`\nTotal unique courses: ${processed.length}`);

  // Separate EOIs, skip sandbox/template, keep dated courses
  const eoiRe = /\bEOI\b|\*EOI\*|expression of interest/i;
  const skipRe =
    /sandbox|template|blueprint|back-?up|mock-?up|\bdev\b|sample|\bcopy\b$|\bold\b |archived|test\b/i;

  const eois = processed.filter((c) => eoiRe.test(c.n) && !skipRe.test(c.n));
  const dated = processed.filter(
    (c) => c.s && !eoiRe.test(c.n) && !skipRe.test(c.n)
  );

  dated.sort((a, b) => a.s.localeCompare(b.s));

  console.log(`Dated courses (non-EOI, non-skip): ${dated.length}`);
  console.log(`EOIs: ${eois.length}`);

  // Build family keys for EOIs
  function familyKey(name) {
    return name
      .replace(
        /\bEOI\b|\*EOI\*|\d{4}[-–]\d|\d{4}|run \d|\bcopy\b|\[.*?\]|—/gi,
        ""
      )
      .replace(/[^a-zA-Z ]/g, "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  const eoiData = eois.map((e) => ({
    ...e,
    family: familyKey(e.n),
  }));

  // Read the HTML template and inject data
  const template = fs.readFileSync(
    path.join(__dirname, "template.html"),
    "utf8"
  );
  const timestamp = new Date().toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Australia/Perth",
  });

  const html = template
    .replace("__COURSES_DATA__", JSON.stringify(dated))
    .replace("__EOIS_DATA__", JSON.stringify(eoiData))
    .replace("__BUILD_TIME__", timestamp)
    .replace("__COURSE_COUNT__", String(processed.length));

  // Write output
  const outDir = path.join(__dirname, "dist");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
  fs.writeFileSync(path.join(outDir, "index.html"), html);

  console.log(`\n✓ Built dist/index.html (${(html.length / 1024).toFixed(0)} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
