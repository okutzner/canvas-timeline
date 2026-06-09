require("dotenv").config();
const express = require("express");
const fetch = require("node-fetch");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const CANVAS_URL = process.env.CANVAS_URL || "https://curtin.instructure.com";
const CANVAS_TOKEN = process.env.CANVAS_TOKEN;
const ACCOUNT_IDS = (process.env.ACCOUNT_IDS || "229,121,123,114,224,226")
  .split(",")
  .map((id) => id.trim());
const CACHE_MINUTES = parseInt(process.env.CACHE_MINUTES || "15", 10);

if (!CANVAS_TOKEN) {
  console.error("ERROR: CANVAS_TOKEN is not set. Add it to your .env file.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------
let cache = { data: null, timestamp: 0 };

async function fetchAllPages(url) {
  const results = [];
  let nextUrl = url;

  while (nextUrl) {
    const res = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${CANVAS_TOKEN}` },
    });

    if (!res.ok) {
      console.error(`Canvas API error ${res.status} for ${nextUrl}`);
      break;
    }

    const data = await res.json();
    results.push(...data);

    // Parse Link header for pagination
    const link = res.headers.get("link") || "";
    const nextMatch = link.match(/<([^>]+)>;\s*rel="next"/);
    nextUrl = nextMatch ? nextMatch[1] : null;
  }

  return results;
}

async function fetchCourses() {
  const now = Date.now();
  if (cache.data && now - cache.timestamp < CACHE_MINUTES * 60 * 1000) {
    return cache.data;
  }

  console.log(`[${new Date().toISOString()}] Fetching courses from Canvas...`);

  const allCourses = [];

  for (const accountId of ACCOUNT_IDS) {
    try {
      const url = `${CANVAS_URL}/api/v1/accounts/${accountId}/courses?per_page=100`;
      const courses = await fetchAllPages(url);
      console.log(`  Account ${accountId}: ${courses.length} courses`);
      allCourses.push(...courses);
    } catch (err) {
      console.error(`  Account ${accountId} failed: ${err.message}`);
    }
  }

  // Deduplicate by course id
  const seen = new Set();
  const unique = allCourses.filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });

  // Map account IDs to friendly names
  const accountNames = {};
  try {
    const res = await fetch(`${CANVAS_URL}/api/v1/accounts`, {
      headers: { Authorization: `Bearer ${CANVAS_TOKEN}` },
    });
    if (res.ok) {
      const accounts = await res.json();
      accounts.forEach((a) => (accountNames[a.id] = a.name));
    }
  } catch (e) {
    /* use IDs as fallback */
  }

  // Transform to lightweight format
  const processed = unique.map((c) => ({
    id: c.id,
    name: c.name,
    start: c.start_at,
    end: c.end_at,
    status: c.workflow_state,
    account: accountNames[c.account_id] || `Account ${c.account_id}`,
    accountId: c.account_id,
    sisId: c.sis_course_id,
    created: c.created_at,
    restrictDates: c.restrict_enrollments_to_course_dates,
  }));

  cache = { data: processed, timestamp: now };
  console.log(`  Total: ${processed.length} unique courses cached.`);
  return processed;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/courses", async (req, res) => {
  try {
    const courses = await fetchCourses();
    res.json({
      courses,
      cached: Date.now() - cache.timestamp < 1000,
      cacheAge: Math.round((Date.now() - cache.timestamp) / 1000),
      cacheMaxAge: CACHE_MINUTES * 60,
    });
  } catch (err) {
    console.error("Error fetching courses:", err);
    res.status(500).json({ error: "Failed to fetch courses from Canvas" });
  }
});

app.get("/api/refresh", async (req, res) => {
  cache = { data: null, timestamp: 0 };
  try {
    const courses = await fetchCourses();
    res.json({ message: "Cache refreshed", count: courses.length });
  } catch (err) {
    res.status(500).json({ error: "Refresh failed" });
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Canvas Timeline running at http://localhost:${PORT}`);
  console.log(`Canvas URL: ${CANVAS_URL}`);
  console.log(`Accounts: ${ACCOUNT_IDS.join(", ")}`);
  console.log(`Cache TTL: ${CACHE_MINUTES} minutes`);
  // Pre-warm cache
  fetchCourses().catch(console.error);
});
