const input = document.querySelector("#csvInput");
const sampleButton = document.querySelector("#sampleButton");
const exportButton = document.querySelector("#exportButton");
const loadMoreButton = document.querySelector("#loadMoreButton");
const chartTabs = document.querySelector("#chartTabs");
const brandNameInput = document.querySelector("#brandNameInput");
const linkedinInput = document.querySelector("#linkedinInput");
const githubInput = document.querySelector("#githubInput");
const brandLinks = document.querySelector("#brandLinks");
const dropZone = document.querySelector("#dropZone");
const statusPanel = document.querySelector("#statusPanel");
const summaryGrid = document.querySelector("#summaryGrid");
const schemaGrid = document.querySelector("#schemaGrid");
const dashboardGrid = document.querySelector("#dashboardGrid");
const template = document.querySelector("#cardTemplate");
let currentProfile = null;
let activeChartFilter = "All";
let visibleChartLimit = 10;

const COLORS = [
  "#0f766e",
  "#b45309",
  "#2563eb",
  "#be123c",
  "#7c3aed",
  "#15803d",
  "#c2410c",
  "#0369a1",
  "#a21caf",
  "#4d7c0f",
];

const TYPE_LABELS = {
  number: "Number",
  date: "Date",
  commonText: "Common text",
  text: "Free text",
  boolean: "Boolean",
  url: "URL",
  email: "Email",
  empty: "Empty",
  id: "Identifier",
};

input.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (file) parseCsv(file);
});

sampleButton.addEventListener("click", () => {
  window.CsvInsight.analyzeText(SAMPLE_CSV, "sample-sales.csv");
});

exportButton.addEventListener("click", () => {
  if (currentProfile) downloadReport(currentProfile);
});

loadMoreButton.addEventListener("click", () => {
  visibleChartLimit += 10;
  renderDashboard(currentProfile.chartPlans);
});

[brandNameInput, linkedinInput, githubInput].forEach((inputEl) => {
  inputEl.addEventListener("input", renderBranding);
});

renderBranding();

["dragenter", "dragover"].forEach((name) => {
  dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    dropZone.classList.add("dragging");
  });
});

["dragleave", "drop"].forEach((name) => {
  dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragging");
  });
});

dropZone.addEventListener("drop", (event) => {
  const file = event.dataTransfer.files?.[0];
  if (file) parseCsv(file);
});

function parseCsv(file) {
  setStatus(`Reading ${file.name}...`);
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const result = parseCsvText(String(reader.result ?? ""));
      const rows = sanitizeRows(result.data);
      const headers = result.meta.fields.filter(Boolean);
      if (!rows.length || !headers.length) {
        showError("The CSV needs a header row and at least one data row.");
        return;
      }
      const profile = profileDataset(rows, headers, file.name);
      renderAll(profile);
    } catch (error) {
      showError(error.message);
    }
  };
  reader.onerror = () => showError("The file could not be read.");
  reader.readAsText(file);
}

function parseCsvText(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  row.push(field);
  rows.push(row);

  const nonEmpty = rows.filter((cells) => cells.some((cell) => String(cell ?? "").trim() !== ""));
  const headers = (nonEmpty.shift() ?? []).map((header, index) => String(header || `Column ${index + 1}`).trim());
  const data = nonEmpty.map((cells) =>
    headers.reduce((record, header, index) => {
      record[header] = cells[index] ?? "";
      return record;
    }, {}),
  );
  return { data, meta: { fields: headers } };
}

function sanitizeRows(rows) {
  return rows.filter((row) => Object.values(row).some((value) => String(value ?? "").trim() !== ""));
}

function profileDataset(rows, headers, fileName) {
  const columns = headers.map((header) => profileColumn(header, rows.map((row) => row[header]), rows.length));
  const byType = groupBy(columns, (col) => col.type);
  const numeric = columns.filter((col) => col.type === "number");
  const categorical = columns.filter((col) => ["commonText", "boolean", "email", "url"].includes(col.type));
  const dates = columns.filter((col) => col.type === "date");
  const text = columns.filter((col) => col.type === "text");
  const chartPlans = buildChartPlans(rows, { columns, numeric, categorical, dates, text });
  return { fileName, rows, headers, columns, byType, numeric, categorical, dates, text, chartPlans };
}

function profileColumn(name, values, rowCount) {
  const raw = values.map((value) => String(value ?? "").trim());
  const present = raw.filter((value) => value !== "");
  const samples = present.slice(0, 8);
  const unique = new Set(present);
  const parsedNumbers = present.map(parseNumber).filter((value) => Number.isFinite(value));
  const parsedDates = present.map(parseDate).filter(Boolean);
  const boolCount = present.filter(isBooleanLike).length;
  const urlCount = present.filter((value) => /^https?:\/\/\S+$/i.test(value)).length;
  const emailCount = present.filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)).length;
  const lowerName = name.toLowerCase();
  const completeness = rowCount ? present.length / rowCount : 0;
  const uniqueRatio = present.length ? unique.size / present.length : 0;
  const avgLength = present.length ? mean(present.map((value) => value.length)) : 0;

  let type = "empty";
  if (present.length) {
    if (parsedNumbers.length / present.length >= 0.92) type = "number";
    else if (parsedDates.length / present.length >= 0.86) type = "date";
    else if (boolCount / present.length >= 0.9) type = "boolean";
    else if (urlCount / present.length >= 0.9) type = "url";
    else if (emailCount / present.length >= 0.9) type = "email";
    else if (uniqueRatio > 0.92 && avgLength <= 36 && /(^id$|_id$| id$|uuid|code|key|ref)/i.test(lowerName)) type = "id";
    else if (uniqueRatio <= 0.4 || unique.size <= Math.min(30, Math.max(4, Math.ceil(rowCount * 0.2)))) type = "commonText";
    else type = "text";
  }

  const numbers = type === "number" ? raw.map(parseNumber) : [];
  const dates = type === "date" ? raw.map(parseDate) : [];
  const stats = type === "number" ? numericStats(numbers.filter(Number.isFinite)) : null;
  const topValues = topCounts(present, 20);
  return {
    name,
    type,
    samples,
    completeness,
    missing: rowCount - present.length,
    uniqueCount: unique.size,
    uniqueRatio,
    values: raw,
    numbers,
    dates,
    stats,
    topValues,
  };
}

function parseNumber(value) {
  if (typeof value === "number") return value;
  const cleaned = String(value ?? "")
    .trim()
    .replace(/[$,%\s,]/g, "");
  if (!cleaned || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(cleaned)) return NaN;
  return Number(cleaned);
}

function parseDate(value) {
  const text = String(value ?? "").trim();
  if (!text || /^\d+(\.\d+)?$/.test(text)) return null;
  const time = Date.parse(text);
  if (!Number.isFinite(time)) return null;
  const date = new Date(time);
  if (date.getFullYear() < 1900 || date.getFullYear() > 2200) return null;
  return date;
}

function isBooleanLike(value) {
  return /^(true|false|yes|no|y|n|0|1)$/i.test(String(value).trim());
}

function numericStats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const avg = mean(sorted);
  const variancePopulation = n ? sorted.reduce((sum, value) => sum + (value - avg) ** 2, 0) / n : 0;
  return {
    count: n,
    min: sorted[0],
    max: sorted[n - 1],
    mean: avg,
    median: quantile(sorted, 0.5),
    q1: quantile(sorted, 0.25),
    q3: quantile(sorted, 0.75),
    sum: sorted.reduce((a, b) => a + b, 0),
    stdDev: Math.sqrt(variancePopulation),
    missing: values.filter((value) => !Number.isFinite(value)).length,
  };
}

function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] === undefined ? sorted[base] : sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function topCounts(values, limit = 10) {
  const counts = new Map();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label)))
    .slice(0, limit);
}

function buildChartPlans(rows, ctx) {
  const plans = [];
  const add = (plan) => {
    if (plan && plan.data?.labels?.length) plans.push({ ...plan, id: `${plan.kind}-${plans.length}` });
  };

  ctx.numeric.forEach((num) => {
    add(histogramPlan(num));
    add(boxPlan(num));
    add(kpiPlan(num));
  });

  ctx.categorical.forEach((cat) => {
    add(categoryBarPlan(cat));
    add(categoryDoughnutPlan(cat));
    add(categoryParetoPlan(cat));
  });

  ctx.dates.forEach((dateCol) => {
    add(dateCountLinePlan(rows, dateCol));
    ctx.numeric.slice(0, 4).forEach((num) => add(dateAggregateLinePlan(rows, dateCol, num, "sum")));
    ctx.numeric.slice(0, 3).forEach((num) => add(dateAggregateLinePlan(rows, dateCol, num, "mean")));
  });

  ctx.categorical.slice(0, 6).forEach((cat) => {
    ctx.numeric.slice(0, 6).forEach((num) => {
      add(categoryAggregatePlan(rows, cat, num, "sum", "bar"));
      add(categoryAggregatePlan(rows, cat, num, "mean", "bar"));
      add(categoryAggregatePlan(rows, cat, num, "median", "bar"));
    });
  });

  for (let i = 0; i < ctx.numeric.length; i += 1) {
    for (let j = i + 1; j < ctx.numeric.length; j += 1) {
      add(scatterPlan(rows, ctx.numeric[i], ctx.numeric[j]));
      add(correlationPlan(rows, ctx.numeric[i], ctx.numeric[j]));
    }
  }

  ctx.categorical.slice(0, 4).forEach((catA) => {
    ctx.categorical.slice(0, 4).forEach((catB) => {
      if (catA.name !== catB.name) add(stackedCategoryPlan(rows, catA, catB));
    });
  });

  add(missingnessPlan(ctx.columns));
  add(typeMixPlan(ctx.columns));
  add(completenessPlan(ctx.columns));
  add(uniqueRatioPlan(ctx.columns));
  add(sampleTablePlan(rows, ctx.columns));

  return plans
    .map((plan) => ({ ...plan, score: scorePlan(plan, ctx) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 40);
}

function histogramPlan(col) {
  const values = col.numbers.filter(Number.isFinite);
  const bins = makeBins(values, Math.min(12, Math.max(5, Math.ceil(Math.sqrt(values.length)))));
  return {
    kind: "Histogram",
    title: `${col.name} distribution`,
    size: "wide",
    chartType: "bar",
    data: { labels: bins.map((b) => b.label), datasets: [{ label: "Rows", data: bins.map((b) => b.count), backgroundColor: COLORS[0] }] },
    formula: "Bin width h = (max(x) - min(x)) / k; frequency per bin = count(x_i in [lower, upper)).",
    refs: [col.name],
  };
}

function boxPlan(col) {
  const stats = col.stats;
  if (!stats) return null;
  return {
    kind: "Five-number summary",
    title: `${col.name} spread`,
    chartType: "bar",
    data: { labels: ["Min", "Q1", "Median", "Q3", "Max"], datasets: [{ label: col.name, data: [stats.min, stats.q1, stats.median, stats.q3, stats.max], backgroundColor: COLORS[2] }] },
    formula: "Qp = linearly interpolated value at position (n - 1)p in the sorted numeric sample.",
    refs: [col.name],
  };
}

function kpiPlan(col) {
  const stats = col.stats;
  if (!stats) return null;
  return {
    kind: "Metric table",
    title: `${col.name} statistics`,
    chartType: "table",
    size: "wide",
    rows: [
      ["Count", formatNumber(stats.count)],
      ["Sum", formatNumber(stats.sum)],
      ["Mean", formatNumber(stats.mean)],
      ["Median", formatNumber(stats.median)],
      ["Std. deviation", formatNumber(stats.stdDev)],
    ],
    data: { labels: ["Metric"], datasets: [{ data: [1] }] },
    formula: "Mean = sum(x_i) / n; population standard deviation = sqrt(sum((x_i - mean)^2) / n).",
    refs: [col.name],
  };
}

function categoryBarPlan(col) {
  const top = col.topValues.slice(0, 12);
  return {
    kind: "Category bar",
    title: `${col.name} top values`,
    chartType: "bar",
    data: { labels: top.map((d) => d.label), datasets: [{ label: "Rows", data: top.map((d) => d.count), backgroundColor: COLORS }] },
    formula: "Category frequency = count(rows where value equals category).",
    refs: [col.name],
  };
}

function categoryDoughnutPlan(col) {
  const top = col.topValues.slice(0, 8);
  return {
    kind: "Share chart",
    title: `${col.name} share`,
    chartType: "doughnut",
    data: { labels: top.map((d) => d.label), datasets: [{ label: "Share", data: top.map((d) => d.count), backgroundColor: COLORS }] },
    formula: "Share(category) = category count / non-empty row count.",
    refs: [col.name],
  };
}

function categoryParetoPlan(col) {
  const top = col.topValues.slice(0, 12);
  let cumulative = 0;
  const total = top.reduce((sum, d) => sum + d.count, 0);
  return {
    kind: "Pareto",
    title: `${col.name} Pareto`,
    chartType: "bar",
    size: "wide",
    data: {
      labels: top.map((d) => d.label),
      datasets: [
        { type: "bar", label: "Rows", data: top.map((d) => d.count), backgroundColor: COLORS[1], yAxisID: "y" },
        { type: "line", label: "Cumulative %", data: top.map((d) => ((cumulative += d.count) / total) * 100), borderColor: COLORS[3], yAxisID: "y1" },
      ],
    },
    options: { scales: { y1: { position: "right", min: 0, max: 100, grid: { drawOnChartArea: false } } } },
    formula: "Cumulative percent_j = 100 * sum(count_i for i<=j) / sum(count_i).",
    refs: [col.name],
  };
}

function dateCountLinePlan(rows, dateCol) {
  const series = groupDate(rows, dateCol, null, "count");
  return {
    kind: "Time series",
    title: `${dateCol.name} row volume`,
    chartType: "line",
    size: "wide",
    data: { labels: series.map((d) => d.label), datasets: [{ label: "Rows", data: series.map((d) => d.value), borderColor: COLORS[0], backgroundColor: "rgba(15,118,110,.16)", tension: 0.25, fill: true }] },
    formula: "Daily row count = count(rows whose parsed date falls on that calendar day).",
    refs: [dateCol.name],
  };
}

function dateAggregateLinePlan(rows, dateCol, numCol, op) {
  const series = groupDate(rows, dateCol, numCol, op);
  return {
    kind: `${titleCase(op)} over time`,
    title: `${titleCase(op)} ${numCol.name} by ${dateCol.name}`,
    chartType: "line",
    size: "wide",
    data: { labels: series.map((d) => d.label), datasets: [{ label: numCol.name, data: series.map((d) => d.value), borderColor: COLORS[2], backgroundColor: "rgba(37,99,235,.14)", tension: 0.25, fill: true }] },
    formula: op === "sum" ? "Sum per date = sum(x_i) for rows in the same date bucket." : "Mean per date = sum(x_i) / n for numeric rows in the same date bucket.",
    refs: [dateCol.name, numCol.name],
  };
}

function categoryAggregatePlan(rows, catCol, numCol, op, chartType) {
  const grouped = groupCategoryNumeric(rows, catCol, numCol, op).slice(0, 12);
  return {
    kind: `${titleCase(op)} by category`,
    title: `${titleCase(op)} ${numCol.name} by ${catCol.name}`,
    chartType,
    data: { labels: grouped.map((d) => d.label), datasets: [{ label: titleCase(op), data: grouped.map((d) => d.value), backgroundColor: COLORS }] },
    formula: `${titleCase(op)} by category = ${formulaForOp(op)} over rows with the same ${catCol.name}.`,
    refs: [catCol.name, numCol.name],
  };
}

function scatterPlan(rows, xCol, yCol) {
  const points = rows
    .map((row) => ({ x: parseNumber(row[xCol.name]), y: parseNumber(row[yCol.name]) }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .slice(0, 1500);
  return {
    kind: "Scatter",
    title: `${yCol.name} vs ${xCol.name}`,
    chartType: "scatter",
    size: "wide",
    data: { datasets: [{ label: `${yCol.name} vs ${xCol.name}`, data: points, backgroundColor: "rgba(15,118,110,.62)" }] },
    formula: "Each point is (x_i, y_i) after both columns are parsed as finite numbers.",
    refs: [xCol.name, yCol.name],
  };
}

function correlationPlan(rows, xCol, yCol) {
  const pairs = rows
    .map((row) => [parseNumber(row[xCol.name]), parseNumber(row[yCol.name])])
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (pairs.length < 3) return null;
  const r = pearson(pairs);
  return {
    kind: "Correlation",
    title: `${xCol.name} / ${yCol.name} correlation`,
    chartType: "bar",
    data: { labels: ["Pearson r"], datasets: [{ label: "Correlation", data: [r], backgroundColor: r >= 0 ? COLORS[0] : COLORS[3] }] },
    options: { scales: { y: { min: -1, max: 1 } } },
    formula: "Pearson r = cov(X,Y) / (std(X) * std(Y)).",
    refs: [xCol.name, yCol.name],
  };
}

function stackedCategoryPlan(rows, catA, catB) {
  const labels = catA.topValues.slice(0, 8).map((d) => d.label);
  const stacks = catB.topValues.slice(0, 5).map((d) => d.label);
  const datasets = stacks.map((stack, index) => ({
    label: stack,
    data: labels.map((label) => rows.filter((row) => String(row[catA.name] ?? "").trim() === label && String(row[catB.name] ?? "").trim() === stack).length),
    backgroundColor: COLORS[index],
  }));
  return {
    kind: "Stacked categories",
    title: `${catB.name} inside ${catA.name}`,
    chartType: "bar",
    size: "wide",
    data: { labels, datasets },
    options: { scales: { x: { stacked: true }, y: { stacked: true } } },
    formula: "Cell count = count(rows where category A equals label and category B equals stack value).",
    refs: [catA.name, catB.name],
  };
}

function missingnessPlan(columns) {
  return {
    kind: "Data quality",
    title: "Missing values by column",
    chartType: "bar",
    size: "wide",
    data: { labels: columns.map((c) => c.name), datasets: [{ label: "Missing rows", data: columns.map((c) => c.missing), backgroundColor: COLORS[3] }] },
    formula: "Missing count = total rows - non-empty values in the column.",
    refs: columns.map((c) => c.name),
  };
}

function typeMixPlan(columns) {
  const counts = topCounts(columns.map((c) => TYPE_LABELS[c.type] ?? c.type), 10);
  return {
    kind: "Schema mix",
    title: "Detected column types",
    chartType: "doughnut",
    data: { labels: counts.map((d) => d.label), datasets: [{ label: "Columns", data: counts.map((d) => d.count), backgroundColor: COLORS }] },
    formula: "Type count = number of columns assigned to each inferred semantic type.",
    refs: [],
  };
}

function completenessPlan(columns) {
  return {
    kind: "Completeness",
    title: "Column completeness",
    chartType: "bar",
    size: "wide",
    data: { labels: columns.map((c) => c.name), datasets: [{ label: "Completeness %", data: columns.map((c) => c.completeness * 100), backgroundColor: COLORS[5] }] },
    options: { scales: { y: { min: 0, max: 100 } } },
    formula: "Completeness = 100 * non-empty values / total rows.",
    refs: columns.map((c) => c.name),
  };
}

function uniqueRatioPlan(columns) {
  return {
    kind: "Cardinality",
    title: "Unique value ratio",
    chartType: "bar",
    size: "wide",
    data: { labels: columns.map((c) => c.name), datasets: [{ label: "Unique ratio", data: columns.map((c) => c.uniqueRatio), backgroundColor: COLORS[6] }] },
    options: { scales: { y: { min: 0, max: 1 } } },
    formula: "Unique ratio = distinct non-empty values / non-empty values.",
    refs: columns.map((c) => c.name),
  };
}

function sampleTablePlan(rows, columns) {
  return {
    kind: "Data preview",
    title: "First rows",
    chartType: "table",
    size: "full",
    rows: rows.slice(0, 10).map((row) => columns.slice(0, 8).map((col) => String(row[col.name] ?? ""))),
    headers: columns.slice(0, 8).map((col) => col.name),
    data: { labels: ["Preview"], datasets: [{ data: [1] }] },
    formula: "Preview uses the first 10 parsed data rows after the header row.",
    refs: columns.map((c) => c.name),
  };
}

function makeBins(values, k) {
  if (!values.length) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return [{ label: formatNumber(min), count: values.length }];
  const width = (max - min) / k;
  return Array.from({ length: k }, (_, index) => {
    const lower = min + index * width;
    const upper = index === k - 1 ? max : lower + width;
    const count = values.filter((value) => value >= lower && (index === k - 1 ? value <= upper : value < upper)).length;
    return { label: `${formatNumber(lower)} - ${formatNumber(upper)}`, count };
  });
}

function groupDate(rows, dateCol, numCol, op) {
  const groups = new Map();
  rows.forEach((row) => {
    const date = parseDate(row[dateCol.name]);
    if (!date) return;
    const key = date.toISOString().slice(0, 10);
    if (!groups.has(key)) groups.set(key, []);
    if (op === "count") groups.get(key).push(1);
    else {
      const value = parseNumber(row[numCol.name]);
      if (Number.isFinite(value)) groups.get(key).push(value);
    }
  });
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-60)
    .map(([label, values]) => ({ label, value: aggregate(values, op) }));
}

function groupCategoryNumeric(rows, catCol, numCol, op) {
  const groups = new Map();
  rows.forEach((row) => {
    const label = String(row[catCol.name] ?? "").trim();
    const value = parseNumber(row[numCol.name]);
    if (!label || !Number.isFinite(value)) return;
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(value);
  });
  return [...groups.entries()]
    .map(([label, values]) => ({ label, value: aggregate(values, op), count: values.length }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 20);
}

function aggregate(values, op) {
  if (!values.length) return 0;
  if (op === "count") return values.length;
  if (op === "sum") return values.reduce((sum, value) => sum + value, 0);
  if (op === "mean") return mean(values);
  if (op === "median") return quantile([...values].sort((a, b) => a - b), 0.5);
  return 0;
}

function pearson(pairs) {
  const xs = pairs.map(([x]) => x);
  const ys = pairs.map(([, y]) => y);
  const mx = mean(xs);
  const my = mean(ys);
  const numerator = pairs.reduce((sum, [x, y]) => sum + (x - mx) * (y - my), 0);
  const dx = Math.sqrt(xs.reduce((sum, x) => sum + (x - mx) ** 2, 0));
  const dy = Math.sqrt(ys.reduce((sum, y) => sum + (y - my) ** 2, 0));
  return dx && dy ? numerator / (dx * dy) : 0;
}

function scorePlan(plan, ctx) {
  let score = 50;
  if (plan.kind.includes("over time") && ctx.dates.length && ctx.numeric.length) score += 22;
  if (plan.kind.includes("by category") && ctx.categorical.length && ctx.numeric.length) score += 20;
  if (plan.kind === "Histogram" || plan.kind === "Category bar") score += 16;
  if (plan.kind === "Scatter" && ctx.numeric.length >= 2) score += 14;
  if (plan.kind === "Data quality" || plan.kind === "Completeness") score += 12;
  if (plan.refs?.some((name) => /sales|revenue|amount|price|cost|profit|total|score|rating|quantity|qty/i.test(name))) score += 10;
  if (plan.refs?.some((name) => /date|time|created|month|year/i.test(name))) score += 8;
  if (plan.data.labels.length > 1) score += Math.min(8, plan.data.labels.length / 2);
  return Math.round(score);
}

function renderAll(profile) {
  currentProfile = profile;
  activeChartFilter = "All";
  visibleChartLimit = 10;
  exportButton.disabled = false;
  clearCharts();
  renderStatus(profile);
  renderSummary(profile);
  renderSchema(profile);
  renderChartTabs(profile.chartPlans);
  renderDashboard(profile.chartPlans);
}

function renderStatus(profile) {
  statusPanel.innerHTML = `
    <div class="empty-state">
      <h2>${escapeHtml(profile.fileName)}</h2>
      <p>Analyzed ${formatNumber(profile.rows.length)} rows and ${formatNumber(profile.columns.length)} columns. Generated ${profile.chartPlans.length} dashboard views from numeric, categorical, date, text, and data-quality signals.</p>
    </div>
  `;
}

function renderSummary(profile) {
  const tiles = [
    ["Rows", profile.rows.length],
    ["Columns", profile.columns.length],
    ["Numeric columns", profile.numeric.length],
    ["Charts selected", profile.chartPlans.length],
  ];
  summaryGrid.innerHTML = tiles
    .map(([label, value]) => `<article class="summary-tile"><strong>${formatNumber(value)}</strong><span>${label}</span></article>`)
    .join("");
}

function renderSchema(profile) {
  schemaGrid.innerHTML = profile.columns
    .map(
      (col) => `
      <article class="schema-item">
        <strong>${escapeHtml(col.name)}</strong>
        <span>${TYPE_LABELS[col.type] ?? col.type}</span>
        <div class="badge-row">
          <span class="badge">${Math.round(col.completeness * 100)}% complete</span>
          <span class="badge">${formatNumber(col.uniqueCount)} unique</span>
          ${col.stats ? `<span class="badge">mean ${formatNumber(col.stats.mean)}</span>` : ""}
        </div>
      </article>
    `,
    )
    .join("");
}

function renderChartTabs(plans) {
  const tabs = ["All", ...new Set(plans.map(chartGroup))];
  chartTabs.innerHTML = tabs
    .map((tab) => `<button class="tab-button${tab === activeChartFilter ? " active" : ""}" type="button" data-filter="${escapeHtml(tab)}">${escapeHtml(tab)}</button>`)
    .join("");
  chartTabs.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      activeChartFilter = button.dataset.filter;
      visibleChartLimit = 10;
      renderChartTabs(currentProfile.chartPlans);
      renderDashboard(currentProfile.chartPlans);
    });
  });
}

function chartGroup(plan) {
  if (/time/i.test(plan.kind)) return "Time";
  if (/category|Pareto|Share/i.test(plan.kind)) return "Category";
  if (/Scatter|Correlation|Histogram|summary|Metric/i.test(plan.kind)) return "Numeric";
  if (/quality|Completeness|Schema|Cardinality|preview/i.test(plan.kind)) return "Quality";
  return "Other";
}

function renderDashboard(plans) {
  dashboardGrid.innerHTML = "";
  const filtered = activeChartFilter === "All" ? plans : plans.filter((plan) => chartGroup(plan) === activeChartFilter);
  const visiblePlans = filtered.slice(0, visibleChartLimit);
  visiblePlans.forEach((plan) => {
    const node = template.content.firstElementChild.cloneNode(true);
    node.classList.toggle("wide", plan.size === "wide");
    node.classList.toggle("full", plan.size === "full");
    node.classList.toggle("table-chart", plan.chartType === "table");
    node.querySelector(".chart-type").textContent = plan.kind;
    node.querySelector("h3").textContent = plan.title;
    node.querySelector(".score").textContent = `${plan.score}`;
    node.querySelector(".formula").textContent = plan.formula;
    dashboardGrid.appendChild(node);

    if (plan.chartType === "table") {
      renderTable(node.querySelector(".table-wrap"), plan);
    } else {
      const canvas = node.querySelector("canvas");
      drawChart(canvas, plan);
    }
  });
  loadMoreButton.hidden = filtered.length <= visibleChartLimit;
  loadMoreButton.textContent = `Show more charts (${Math.max(0, filtered.length - visibleChartLimit)} left)`;
}

function renderTable(container, plan) {
  const headers = plan.headers ?? ["Metric", "Value"];
  const bodyRows = plan.rows ?? [];
  container.innerHTML = `
    <table>
      <thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>
      <tbody>${bodyRows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>
  `;
}

function drawChart(canvas, plan) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(320, Math.floor(rect.width * dpr));
  canvas.height = Math.max(260, Math.floor(rect.height * dpr));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  ctx.clearRect(0, 0, width, height);
  ctx.font = "12px Inter, system-ui, sans-serif";
  ctx.fillStyle = "#17202a";

  if (plan.chartType === "doughnut") drawDoughnut(ctx, plan, width, height);
  else if (plan.chartType === "line") drawLine(ctx, plan, width, height);
  else if (plan.chartType === "scatter") drawScatter(ctx, plan, width, height);
  else drawBar(ctx, plan, width, height);
}

function chartArea(width, height) {
  return { left: 52, right: width - 18, top: 18, bottom: height - 54, width: width - 70, height: height - 72 };
}

function drawAxes(ctx, area, min, max, labels) {
  ctx.strokeStyle = "#d8e0e8";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(area.left, area.top);
  ctx.lineTo(area.left, area.bottom);
  ctx.lineTo(area.right, area.bottom);
  ctx.stroke();

  const range = max - min || 1;
  ctx.fillStyle = "#647181";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= 4; i += 1) {
    const value = min + (range * i) / 4;
    const y = area.bottom - ((value - min) / range) * area.height;
    ctx.strokeStyle = "#edf1f5";
    ctx.beginPath();
    ctx.moveTo(area.left, y);
    ctx.lineTo(area.right, y);
    ctx.stroke();
    ctx.fillText(formatCompact(value), area.left - 8, y);
  }

  const step = Math.max(1, Math.ceil(labels.length / 8));
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  labels.forEach((label, index) => {
    if (index % step !== 0) return;
    const x = area.left + (labels.length === 1 ? area.width / 2 : (index / (labels.length - 1)) * area.width);
    ctx.save();
    ctx.translate(x, area.bottom + 10);
    ctx.rotate(labels.length > 5 ? -Math.PI / 9 : 0);
    ctx.fillText(truncate(label, 16), 0, 0);
    ctx.restore();
  });
}

function drawBar(ctx, plan, width, height) {
  const labels = plan.data.labels;
  const datasets = plan.data.datasets.filter((dataset) => dataset.type !== "line");
  const lineSets = plan.data.datasets.filter((dataset) => dataset.type === "line");
  const stacked = Boolean(plan.options?.scales?.x?.stacked);
  const area = chartArea(width, height);
  const values = stacked
    ? labels.map((_, index) => datasets.reduce((sum, set) => sum + Number(set.data[index] || 0), 0))
    : datasets.flatMap((set) => set.data.map(Number));
  const min = Math.min(0, ...values);
  const max = Math.max(...values, 1);
  drawAxes(ctx, area, min, max, labels);

  const groupWidth = area.width / labels.length;
  const barGap = Math.min(12, groupWidth * 0.18);
  labels.forEach((_, labelIndex) => {
    let stackBase = 0;
    datasets.forEach((dataset, setIndex) => {
      const raw = Number(dataset.data[labelIndex] || 0);
      const color = Array.isArray(dataset.backgroundColor) ? dataset.backgroundColor[labelIndex % dataset.backgroundColor.length] : dataset.backgroundColor || COLORS[setIndex % COLORS.length];
      const barWidth = stacked ? groupWidth - barGap : (groupWidth - barGap) / datasets.length;
      const x = area.left + labelIndex * groupWidth + barGap / 2 + (stacked ? 0 : setIndex * barWidth);
      const y0 = valueToY(stackBase, min, max, area);
      const y1 = valueToY(stackBase + raw, min, max, area);
      ctx.fillStyle = color;
      ctx.fillRect(x, Math.min(y0, y1), Math.max(2, barWidth - 2), Math.max(1, Math.abs(y0 - y1)));
      stackBase += stacked ? raw : 0;
    });
  });

  lineSets.forEach((dataset, index) => drawLineDataset(ctx, dataset, labels, area, 0, 100, dataset.borderColor || COLORS[index]));
  drawLegend(ctx, plan, width, height);
}

function drawLine(ctx, plan, width, height) {
  const labels = plan.data.labels;
  const area = chartArea(width, height);
  const values = plan.data.datasets.flatMap((set) => set.data.map(Number));
  const min = Math.min(0, ...values);
  const max = Math.max(...values, 1);
  drawAxes(ctx, area, min, max, labels);
  plan.data.datasets.forEach((dataset, index) => drawLineDataset(ctx, dataset, labels, area, min, max, dataset.borderColor || COLORS[index]));
  drawLegend(ctx, plan, width, height);
}

function drawLineDataset(ctx, dataset, labels, area, min, max, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  dataset.data.forEach((raw, index) => {
    const x = area.left + (labels.length === 1 ? area.width / 2 : (index / (labels.length - 1)) * area.width);
    const y = valueToY(Number(raw), min, max, area);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.fillStyle = color;
  dataset.data.forEach((raw, index) => {
    const x = area.left + (labels.length === 1 ? area.width / 2 : (index / (labels.length - 1)) * area.width);
    const y = valueToY(Number(raw), min, max, area);
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawScatter(ctx, plan, width, height) {
  const points = plan.data.datasets[0].data;
  const area = chartArea(width, height);
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(0, ...ys);
  const maxY = Math.max(...ys, 1);
  drawAxes(ctx, area, minY, maxY, ["", "", "", "", ""]);
  ctx.fillStyle = "#647181";
  ctx.textAlign = "left";
  ctx.fillText(formatCompact(minX), area.left, area.bottom + 34);
  ctx.textAlign = "right";
  ctx.fillText(formatCompact(maxX), area.right, area.bottom + 34);
  ctx.fillStyle = plan.data.datasets[0].backgroundColor || COLORS[0];
  points.forEach((point) => {
    const x = area.left + ((point.x - minX) / (maxX - minX || 1)) * area.width;
    const y = valueToY(point.y, minY, maxY, area);
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawDoughnut(ctx, plan, width, height) {
  const values = plan.data.datasets[0].data.map(Number);
  const total = values.reduce((sum, value) => sum + value, 0) || 1;
  const cx = width * 0.42;
  const cy = height * 0.48;
  const radius = Math.min(width, height) * 0.32;
  let start = -Math.PI / 2;
  values.forEach((value, index) => {
    const end = start + (value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, start, end);
    ctx.closePath();
    ctx.fillStyle = COLORS[index % COLORS.length];
    ctx.fill();
    start = end;
  });
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.56, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#17202a";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "700 20px Inter, system-ui, sans-serif";
  ctx.fillText(formatCompact(total), cx, cy);
  ctx.font = "12px Inter, system-ui, sans-serif";
  drawLegend(ctx, plan, width, height, width * 0.68, 36);
}

function drawLegend(ctx, plan, width, height, x = 18, y = height - 22) {
  const items = plan.data.datasets.length > 1 ? plan.data.datasets.map((set, index) => ({ label: set.label, color: set.backgroundColor || set.borderColor || COLORS[index] })) : plan.data.labels.slice(0, 6).map((label, index) => ({ label, color: COLORS[index] }));
  ctx.font = "12px Inter, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  let cursorX = x;
  let cursorY = y;
  items.slice(0, 8).forEach((item) => {
    const color = Array.isArray(item.color) ? item.color[0] : item.color;
    const label = truncate(item.label, 18);
    const itemWidth = Math.min(160, ctx.measureText(label).width + 24);
    if (cursorX + itemWidth > width - 12) {
      cursorX = x;
      cursorY += 18;
    }
    ctx.fillStyle = color;
    ctx.fillRect(cursorX, cursorY - 5, 10, 10);
    ctx.fillStyle = "#647181";
    ctx.fillText(label, cursorX + 15, cursorY);
    cursorX += itemWidth + 8;
  });
}

function valueToY(value, min, max, area) {
  return area.bottom - ((value - min) / (max - min || 1)) * area.height;
}

function clearCharts() {
  dashboardGrid.querySelectorAll("canvas").forEach((canvas) => {
    const ctx = canvas.getContext("2d");
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
  });
}

function setStatus(message) {
  statusPanel.innerHTML = `<div class="empty-state"><h2>${escapeHtml(message)}</h2></div>`;
}

function showError(message) {
  statusPanel.innerHTML = `<div class="empty-state"><h2 class="error">Could not analyze CSV</h2><p>${escapeHtml(message)}</p></div>`;
}

function groupBy(items, getKey) {
  return items.reduce((acc, item) => {
    const key = getKey(item);
    acc[key] = acc[key] ?? [];
    acc[key].push(item);
    return acc;
  }, {});
}

function formulaForOp(op) {
  if (op === "sum") return "sum(x_i)";
  if (op === "mean") return "sum(x_i) / n";
  if (op === "median") return "Q0.5";
  return "count";
}

function titleCase(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatNumber(value) {
  if (!Number.isFinite(Number(value))) return String(value ?? "");
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number(value));
}

function formatCompact(value) {
  if (!Number.isFinite(Number(value))) return "";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(Number(value));
}

function truncate(value, length) {
  const text = String(value ?? "");
  return text.length > length ? `${text.slice(0, Math.max(1, length - 1))}...` : text;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

function renderBranding() {
  const name = brandNameInput.value.trim() || "Atharva Raut";
  document.querySelector(".brand-block strong").textContent = "Atharva Analytics";
  document.querySelector(".brand-block span").textContent = `by ${name}`;

  const links = [
    ["LinkedIn", linkedinInput.value.trim()],
    ["GitHub / Portfolio", githubInput.value.trim()],
  ].filter(([, url]) => /^https?:\/\/\S+$/i.test(url));

  brandLinks.innerHTML = links.length
    ? links.map(([label, url]) => `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`).join("")
    : `<span>Paste your links to show them here.</span>`;
}

function downloadReport(profile) {
  const brandName = brandNameInput.value.trim() || "Atharva Raut";
  const topCharts = profile.chartPlans.slice(0, 12);
  const schemaRows = profile.columns
    .map(
      (col) => `
        <tr>
          <td>${escapeHtml(col.name)}</td>
          <td>${escapeHtml(TYPE_LABELS[col.type] ?? col.type)}</td>
          <td>${Math.round(col.completeness * 100)}%</td>
          <td>${formatNumber(col.uniqueCount)}</td>
        </tr>
      `,
    )
    .join("");
  const chartRows = topCharts
    .map(
      (plan) => `
        <tr>
          <td>${escapeHtml(plan.title)}</td>
          <td>${escapeHtml(plan.kind)}</td>
          <td>${escapeHtml(chartGroup(plan))}</td>
          <td>${formatNumber(plan.score)}</td>
          <td>${escapeHtml(plan.formula)}</td>
        </tr>
      `,
    )
    .join("");
  const report = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(profile.fileName)} Report</title>
  <style>
    body { margin: 40px; color: #15202b; font-family: Arial, sans-serif; }
    h1 { margin-bottom: 4px; }
    p { color: #64748b; }
    table { width: 100%; margin-top: 22px; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 10px; border-bottom: 1px solid #d7e1e8; text-align: left; vertical-align: top; }
    th { color: #0e7490; }
    .tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 24px 0; }
    .tile { padding: 16px; border: 1px solid #d7e1e8; border-radius: 8px; }
    .tile strong { display: block; font-size: 28px; }
  </style>
</head>
<body>
  <h1>${escapeHtml(profile.fileName)} dashboard report</h1>
  <p>Generated by Atharva Analytics, by ${escapeHtml(brandName)}.</p>
  <div class="tiles">
    <div class="tile"><strong>${formatNumber(profile.rows.length)}</strong>Rows</div>
    <div class="tile"><strong>${formatNumber(profile.columns.length)}</strong>Columns</div>
    <div class="tile"><strong>${formatNumber(profile.numeric.length)}</strong>Numeric columns</div>
    <div class="tile"><strong>${formatNumber(profile.chartPlans.length)}</strong>Recommended charts</div>
  </div>
  <h2>Detected schema</h2>
  <table><thead><tr><th>Column</th><th>Type</th><th>Completeness</th><th>Unique values</th></tr></thead><tbody>${schemaRows}</tbody></table>
  <h2>Top recommended charts</h2>
  <table><thead><tr><th>Title</th><th>Type</th><th>Group</th><th>Score</th><th>Formula</th></tr></thead><tbody>${chartRows}</tbody></table>
</body>
</html>`;

  const blob = new Blob([report], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${profile.fileName.replace(/\.[^.]+$/, "") || "csv-dashboard"}-report.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

window.CsvInsight = {
  analyzeText(text, fileName = "pasted.csv") {
    const result = parseCsvText(text);
    const rows = sanitizeRows(result.data);
    const headers = result.meta.fields.filter(Boolean);
    const profile = profileDataset(rows, headers, fileName);
    renderAll(profile);
    return profile;
  },
};

const SAMPLE_CSV = `Order ID,Order Date,Region,Category,Product,Sales,Profit,Quantity,Discount,Customer Email,Returned,Notes
1001,2026-01-03,West,Technology,Laptop,1299.99,210.50,1,0,jordan@example.com,no,Priority buyer
1002,2026-01-04,East,Furniture,Chair,249.50,42.30,2,0.1,avery@example.com,no,Office refresh
1003,2026-01-05,South,Office Supplies,Paper,39.99,8.50,5,0.05,riley@example.com,yes,Delayed shipment
1004,2026-01-05,North,Technology,Monitor,399.00,75.20,1,0,casey@example.com,no,Bundle request
1005,2026-01-07,West,Furniture,Desk,699.25,120.00,1,0.15,morgan@example.com,no,Assembly required
1006,2026-01-08,East,Technology,Keyboard,89.90,19.10,3,0,quinn@example.com,no,
1007,2026-01-09,South,Office Supplies,Ink,62.40,11.70,4,0.05,taylor@example.com,yes,Repeat return
1008,2026-01-10,North,Furniture,Shelf,310.00,55.80,2,0.2,drew@example.com,no,Backordered
1009,2026-01-11,West,Technology,Mouse,44.95,9.20,6,0,jules@example.com,no,
1010,2026-01-13,East,Office Supplies,Notebook,24.75,5.10,8,0.1,skyler@example.com,no,School order
1011,2026-01-14,South,Furniture,Chair,279.00,38.40,2,0.05,blair@example.com,no,
1012,2026-01-15,North,Technology,Tablet,559.00,101.40,1,0.1,remy@example.com,yes,Screen issue
1013,2026-01-16,West,Office Supplies,Stapler,18.25,4.00,10,0,devon@example.com,no,
1014,2026-01-18,East,Furniture,Desk,749.00,132.60,1,0.12,harper@example.com,no,Executive desk
1015,2026-01-19,South,Technology,Laptop,1499.00,260.10,1,0.08,logan@example.com,no,Expedited
1016,2026-01-20,North,Office Supplies,Paper,42.30,7.90,7,0,peyton@example.com,no,
1017,2026-01-22,West,Furniture,Sofa,980.00,144.00,1,0.18,sage@example.com,yes,Fabric damage
1018,2026-01-23,East,Technology,Monitor,429.95,88.20,2,0.05,river@example.com,no,
1019,2026-01-25,South,Office Supplies,Ink,58.00,10.25,5,0.1,finley@example.com,no,
1020,2026-01-27,North,Technology,Camera,799.00,150.30,1,0.05,kai@example.com,no,Gift packaging`;
