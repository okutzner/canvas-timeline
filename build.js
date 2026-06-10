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

async function fetchAllPages(url) {
  const results = [];
  let nextUrl = url;
  while (nextUrl) {
    const res = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${CANVAS_TOKEN}` },
    });
    if (!res.ok) {
      console.error("  Error " + res.status + " for " + nextUrl);
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
  const map = {};
  try {
    var res = await fetch(CANVAS_URL + "/api/v1/accounts", {
      headers: { Authorization: "Bearer " + CANVAS_TOKEN },
    });
    if (res.ok) {
      var accounts = await res.json();
      accounts.forEach(function (a) { map[a.id] = a.name; });
    }
    for (var i = 0; i < ACCOUNT_IDS.length; i++) {
      try {
        var subRes = await fetch(
          CANVAS_URL + "/api/v1/accounts/" + ACCOUNT_IDS[i] + "/sub_accounts?per_page=100",
          { headers: { Authorization: "Bearer " + CANVAS_TOKEN } }
        );
        if (subRes.ok) {
          var subs = await subRes.json();
          subs.forEach(function (a) { map[a.id] = a.name; });
        }
      } catch (e) {}
    }
  } catch (e) {}
  return map;
}

async function main() {
  console.log("Canvas Course Timeline Build\n");

  var accountNames = await fetchAccountNames();
  var allCourses = [];

  for (var i = 0; i < ACCOUNT_IDS.length; i++) {
    var id = ACCOUNT_IDS[i];
    var url = CANVAS_URL + "/api/v1/accounts/" + id + "/courses?per_page=100";
    console.log("Fetching account " + id + " (" + (accountNames[id] || "?") + ")...");
    var courses = await fetchAllPages(url);
    console.log("  Found " + courses.length + " courses");
    allCourses.push.apply(allCourses, courses);
  }

  var seen = {};
  var unique = allCourses.filter(function (c) {
    if (seen[c.id]) return false;
    seen[c.id] = true;
    return true;
  });

  var processed = unique.map(function (c) {
    return {
      id: c.id,
      n: c.name,
      s: c.start_at ? c.start_at.split("T")[0] : null,
      e: c.end_at ? c.end_at.split("T")[0] : null,
      st: c.workflow_state,
      ac: accountNames[c.account_id] || ("Account " + c.account_id),
      sis: c.sis_course_id || null,
    };
  });

  console.log("\nTotal unique courses: " + processed.length);

  var eoiRe = /\bEOI\b|\*EOI\*|expression of interest/i;
  var skipRe = /sandbox|template|blueprint|back-?up|mock-?up|\bdev\b|sample|\bcopy\b$|\bold\b |archived|\btest\b/i;

  var eois = processed.filter(function (c) { return eoiRe.test(c.n) && !skipRe.test(c.n); });
  var dated = processed.filter(function (c) { return c.s && !eoiRe.test(c.n) && !skipRe.test(c.n); });

  dated.sort(function (a, b) { return a.s.localeCompare(b.s); });

  console.log("Dated courses: " + dated.length);
  console.log("EOIs: " + eois.length);

  function familyKey(name) {
    return name
      .replace(/\bEOI\b|\*EOI\*|\d{4}[-–]\d|\d{4}|run \d|\bcopy\b|\[.*?\]|—/gi, "")
      .replace(/[^a-zA-Z ]/g, "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  var eoiData = eois.map(function (e) {
    return { n: e.n, s: e.s, e: e.e, st: e.st, ac: e.ac, sis: e.sis, family: familyKey(e.n) };
  });

  var template = fs.readFileSync(path.join(__dirname, "template.html"), "utf8");

  var timestamp = new Date().toLocaleString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Australia/Perth",
  });

  var html = template
    .replace("__COURSES_DATA__", JSON.stringify(dated))
    .replace("__EOIS_DATA__", JSON.stringify(eoiData))
    .replace("__BUILD_TIME__", timestamp)
    .replace("__COURSE_COUNT__", String(processed.length));

  var outDir = path.join(__dirname, "dist");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
  fs.writeFileSync(path.join(outDir, "index.html"), html);

  console.log("\nBuilt dist/index.html (" + Math.round(html.length / 1024) + " KB)");
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
