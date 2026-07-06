/* eslint-disable react/prop-types */
import { useEffect, useState } from "react";
import { useLoaderData, useNavigate, useSubmit } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  actionLabel,
  resourceLabel,
  stripHtml,
  staffNameFromMessage,
  parseTopic,
} from "../utils/activity";

const PAGE_SIZE = 15;

// Resources we expose in the filter dropdown.
const RESOURCE_OPTIONS = [
  "products",
  "collections",
  "orders",
  "draft_orders",
  "refunds",
  "customers",
  "fulfillments",
  "inventory_levels",
  "inventory_items",
  "discounts",
  "themes",
  "shop",
];

const ACTION_OPTIONS = [
  "create",
  "update",
  "delete",
  "updated",
  "cancelled",
  "fulfilled",
  "paid",
  "partially_fulfilled",
  "edited",
  "enable",
  "disable",
  "connect",
  "disconnect",
  "publish",
];

// Badge tone by action so the table reads at a glance.
function toneForAction(action) {
  if (["create", "connect"].includes(action)) return "success";
  if (["delete", "disconnect", "cancelled", "disable"].includes(action))
    return "critical";
  if (["paid", "fulfilled", "publish", "enable"].includes(action))
    return "info";
  return "neutral";
}

// Non-person actorName values stored by earlier versions — these belong in the
// Source column, not the User column.
const NON_PERSON_ACTORS = /^(system|unknown|deleted|admin user|app|.*\(app\))$/i;

// Backfill older rows logged before parsing/attribution fixes existed:
//  - re-parse the stored topic into resource/action (early rows stored the raw
//    enum topic as the resource and "event" as the action)
//  - extract a staff person's name from the summary into actorName
//  - move non-person actorName values (System / app names) into sourceLabel
// Runs cheaply on load and is idempotent.
async function backfillLogs(shop) {
  const candidates = await db.activityLog.findMany({
    where: {
      shop,
      OR: [
        { action: "event" },
        { sourceLabel: null },
        { actorName: null }, // maybe the summary names a person
      ],
    },
    select: {
      id: true,
      topic: true,
      summary: true,
      action: true,
      actorName: true,
      sourceType: true,
      sourceLabel: true,
    },
    take: 1000,
  });

  const updates = [];
  for (const row of candidates) {
    const data = {};

    // 1. Re-parse topic if action was never resolved.
    if (row.action === "event") {
      const { resource, action } = parseTopic(row.topic);
      if (action !== "event") {
        data.resource = resource;
        data.action = action;
      }
    }

    // 2. If the summary names a staff member, that person IS the user.
    if (!row.actorName) {
      const named = staffNameFromMessage(row.summary);
      if (named) {
        data.actorName = named;
        data.sourceType = "user";
        if (row.sourceLabel == null) data.sourceLabel = "Shopify admin";
      }
    }

    // 3. Resolve the source label for rows that never had one.
    if (row.sourceLabel == null && data.sourceLabel == null) {
      if (row.actorName && NON_PERSON_ACTORS.test(row.actorName)) {
        // Old non-person value → move to Source, clear User.
        const label = /\(app\)$/i.test(row.actorName)
          ? row.actorName.replace(/\s*\(app\)$/i, "")
          : row.actorName === "Admin user"
            ? "Shopify admin"
            : row.actorName;
        data.actorName = null;
        data.sourceLabel = label;
        data.sourceType = row.actorName === "Admin user" ? "user" : "system";
      } else if (row.actorName) {
        data.sourceLabel = "Shopify admin";
        data.sourceType = "user";
      } else {
        data.sourceLabel = "System";
      }
    }

    if (Object.keys(data).length) {
      updates.push(db.activityLog.update({ where: { id: row.id }, data }));
    }
  }
  if (updates.length) await db.$transaction(updates);
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // Backfill older rows (re-parse topic, extract staff name). Idempotent.
  await backfillLogs(shop);

  const url = new URL(request.url);
  const params = url.searchParams;

  const q = params.get("q")?.trim() || "";
  const resource = params.get("resource") || "";
  const action = params.get("action") || "";
  const actor = params.get("actor")?.trim() || "";
  const from = params.get("from") || "";
  const to = params.get("to") || "";
  const page = Math.max(1, parseInt(params.get("page") || "1", 10) || 1);

  // Build the Prisma where clause from the active filters.
  const where = { shop };

  if (resource) where.resource = resource;
  if (action) where.action = action;

  if (actor) {
    where.OR = [
      { actorEmail: { contains: actor, mode: "insensitive" } },
      { actorName: { contains: actor, mode: "insensitive" } },
    ];
  }

  if (q) {
    // Free-text search across the human-readable fields + resource id.
    const contains = { contains: q, mode: "insensitive" };
    where.AND = [
      {
        OR: [
          { title: contains },
          { summary: contains },
          { resourceId: contains },
          { actorEmail: contains },
          { actorName: contains },
          { topic: contains },
        ],
      },
    ];
  }

  if (from || to) {
    where.occurredAt = {};
    if (from) where.occurredAt.gte = new Date(`${from}T00:00:00.000Z`);
    if (to) where.occurredAt.lte = new Date(`${to}T23:59:59.999Z`);
  }

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);

  const [logs, total, totalAll, todayCount, yesterdayCount, resourceGroups] =
    await Promise.all([
      db.activityLog.findMany({
        where,
        orderBy: { occurredAt: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      db.activityLog.count({ where }),
      db.activityLog.count({ where: { shop } }),
      db.activityLog.count({ where: { shop, occurredAt: { gte: startOfToday } } }),
      db.activityLog.count({
        where: {
          shop,
          occurredAt: { gte: startOfYesterday, lt: startOfToday },
        },
      }),
      db.activityLog.groupBy({
        by: ["resource"],
        where: { shop },
        _count: { resource: true },
        orderBy: { _count: { resource: "desc" } },
        take: 1,
      }),
    ]);

  const topResource = resourceGroups[0]?.resource
    ? resourceLabel(resourceGroups[0].resource)
    : "—";

  // The "vs yesterday" trend is only meaningful with more than a day of
  // history. Check whether any activity exists before yesterday started.
  const olderThanYesterday = await db.activityLog.count({
    where: { shop, occurredAt: { lt: startOfYesterday } },
  });
  const hasMultiDayData = olderThanYesterday > 0;

  // Distinct "sources" of activity — a staff email when we have one, otherwise
  // the derived attribution (e.g. "Admin user", an app name, "System").
  const distinctActors = await db.activityLog.findMany({
    where: {
      shop,
      OR: [{ actorEmail: { not: null } }, { actorName: { not: null } }],
    },
    select: { actorEmail: true, actorName: true },
  });
  const distinctSources = new Set(
    distinctActors.map((a) => a.actorEmail || a.actorName),
  );

  return {
    logs: logs.map((l) => ({
      id: l.id,
      topic: l.topic,
      resource: l.resource,
      action: l.action,
      resourceId: l.resourceId,
      title: l.title,
      summary: l.summary,
      actorName: l.actorName,
      actorEmail: l.actorEmail,
      sourceType: l.sourceType,
      sourceLabel: l.sourceLabel,
      occurredAt: l.occurredAt.toISOString(),
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
    filters: { q, resource, action, actor, from, to },
    stats: {
      totalAll,
      todayCount,
      yesterdayCount,
      hasMultiDayData,
      topResource,
      activeUsers: distinctSources.size,
    },
  };
};

// Percent change of today vs yesterday, e.g. { dir: "up", pct: 20 }.
// Returns null when there's no yesterday baseline to compare against.
function trendVsYesterday(today, yesterday) {
  if (!yesterday) return null;
  const diff = today - yesterday;
  if (diff === 0) return { dir: "flat", pct: 0 };
  return {
    dir: diff > 0 ? "up" : "down",
    pct: Math.round((Math.abs(diff) / yesterday) * 100),
  };
}

// Split a timestamp into a date line and a time line (rendered on two rows so
// the Time column stays narrow).
function formatDateParts(iso) {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    time: d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
}

// Clean an event summary for the table: strip HTML and cap length.
function cleanSummary(text, max = 55) {
  const clean = stripHtml(text) || "";
  return clean.length > max ? `${clean.slice(0, max).trimEnd()}…` : clean;
}

// Native date input styled to match Polaris fields, full-width (fills its
// grid column, unlike the compact s-date-field). Submits the form on change.
function DateField({ label, name, value, onChange, min, max }) {
  return (
    <label style={{ display: "block", width: "100%" }}>
      <span
        style={{
          display: "block",
          fontSize: "13px",
          lineHeight: "20px",
          marginBottom: "4px",
          color: "#303030",
          fontFamily: "inherit",
        }}
      >
        {label}
      </span>
      <input
        type="date"
        name={name}
        key={value || "empty"}
        defaultValue={value}
        min={min}
        max={max}
        onChange={onChange}
        onClick={(e) => e.currentTarget.showPicker?.()}
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: "0 10px",
          border: "1px solid #A6A6A6",
          borderRadius: "8px",
          fontSize: "13px",
          fontFamily: "inherit",
          height: "32px",
          background: "#fff",
          color: "#303030",
          cursor: "pointer",
        }}
      />
    </label>
  );
}

// Per-tile accent colors (icon color + tinted chip + sparkline).
const TILE_ACCENTS = {
  blue: { fg: "#2C6ECB", bg: "rgba(44,110,203,0.12)" },
  green: { fg: "#29845A", bg: "rgba(41,132,90,0.12)" },
  amber: { fg: "#B98900", bg: "rgba(185,137,0,0.14)" },
  violet: { fg: "#6B47B8", bg: "rgba(107,71,184,0.12)" },
};

// Simple inline SVG icons keyed by name (24x24, currentColor).
const TILE_ICONS = {
  events: "M4 13h4l2 5 4-12 2 7h4",
  calendar:
    "M7 3v3M17 3v3M4 8h16M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z",
  resource:
    "M4 8l8-4 8 4-8 4-8-4Zm0 4l8 4 8-4M4 16l8 4 8-4",
  users:
    "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7 0a3 3 0 1 0 0-6M3 20a6 6 0 0 1 12 0M15 14a6 6 0 0 1 6 6",
};

// A tiny decorative sparkline with a soft gradient area fill, in the tile's
// accent color. `id` must be unique per tile so the gradient defs don't clash.

// Build a smooth (bezier) line + area path from data points. The lowest point
// sits on the bottom edge (y=h) so the curve anchors to the card border; `pad`
// is top headroom only.
function smoothSparkPath(data, w, h, pad) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => [
    i * step,
    h - ((v - min) / range) * (h - pad),
  ]);
  let line = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const cx = (x0 + x1) / 2;
    line += ` C ${cx} ${y0} ${cx} ${y1} ${x1} ${y1}`;
  }
  const area = `${line} L ${w} ${h} L 0 ${h} Z`;
  return { line, area };
}

// A small corner sparkline (reference style): a soft wavy line that anchors to
// the bottom edge and trends upward, with a gradient area fill.
const SPARK_DATA = [0, 2, 6, 5, 7, 12, 10, 14, 20];
const SPARK_W = 200;
const SPARK_H = 100;

function Sparkline({ color, id }) {
  const { line, area } = smoothSparkPath(SPARK_DATA, SPARK_W, SPARK_H, 12);
  return (
    <svg
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      preserveAspectRatio="none"
      fill="none"
      style={{
        position: "absolute",
        right: 0,
        bottom: 0,
        width: "42%",
        height: "48%",
        borderBottomRightRadius: "16px",
      }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#spark-${id})`} />
      <path
        d={line}
        stroke={color}
        strokeOpacity="0.7"
        strokeWidth="0.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// Circular arrow pagination button (native button for reliable clicks).
function PagerButton({ label, disabled, onClick, dir }) {
  const d = dir === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6";
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "34px",
        height: "34px",
        borderRadius: "50%",
        border: "1px solid #D0D0D0",
        background: "#fff",
        color: disabled ? "#C4C4C4" : "#303030",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        padding: 0,
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <path
          d={d}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

function StatTile({ label, value, icon, accent = "blue", trend }) {
  const a = TILE_ACCENTS[accent] || TILE_ACCENTS.blue;
  const trendColor =
    trend?.dir === "up"
      ? "#29845A"
      : trend?.dir === "down"
        ? "#C0362C"
        : "#6D7175";
  const arrow = trend?.dir === "up" ? "↑" : trend?.dir === "down" ? "↓" : "→";

  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        background: "var(--tile-bg, #fff)",
        border: "1px solid var(--tile-border, #E3E3E3)",
        borderRadius: "16px",
        padding: "18px",
      }}
    >
      <div style={{ position: "relative", zIndex: 1 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            marginBottom: "14px",
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "44px",
              height: "44px",
              borderRadius: "50%",
              background: a.bg,
              color: a.fg,
              flexShrink: 0,
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path
                d={TILE_ICONS[icon] || TILE_ICONS.events}
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span
            style={{ fontSize: "13px", fontWeight: 600, color: "#616161" }}
          >
            {label}
          </span>
        </div>

        <div
          style={{
            fontSize: "30px",
            fontWeight: 700,
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
            color: "var(--tile-value, #1A1A1A)",
            marginBottom: trend ? "10px" : 0,
          }}
        >
          {value}
        </div>

        {trend ? (
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "3px",
                fontSize: "12px",
                fontWeight: 600,
                color: trendColor,
                background: `${trendColor}1A`,
                padding: "2px 8px",
                borderRadius: "999px",
              }}
            >
              {arrow} {trend.pct}%
            </span>
            <span style={{ fontSize: "12px", color: "#8C9196" }}>
              vs yesterday
            </span>
          </div>
        ) : null}
      </div>

      <Sparkline color={a.fg} id={accent} />
    </div>
  );
}

export default function Dashboard() {
  const { logs, total, page, pageSize, filters, stats } = useLoaderData();
  const navigate = useNavigate();
  const submit = useSubmit();

  // Today (YYYY-MM-DD) — used to block future dates in the date filters.
  const today = new Date().toISOString().slice(0, 10);

  // Draft filter state. Polaris web components don't reliably participate in
  // native <form> submission, so we track values in React and submit the URL
  // params ourselves. Initialized from (and reset by) the loader's filters.
  const [draft, setDraft] = useState({
    q: filters.q,
    resource: filters.resource,
    action: filters.action,
    actor: filters.actor,
    from: filters.from,
    to: filters.to,
  });
  // Read a value from a Polaris web-component event (currentTarget can be null
  // in React's synthetic layer; fall back to target / detail).
  const readValue = (event) => {
    const t = event?.currentTarget ?? event?.target;
    if (t && "value" in t) return t.value ?? "";
    if (typeof event?.detail?.value === "string") return event.detail.value;
    return "";
  };
  const setField = (name) => (event) => {
    let value = readValue(event);
    // "All resources"/"All actions" are the empty option; if the select ever
    // reports the label instead of "", normalize unknown values back to empty.
    if (name === "resource" && value && !RESOURCE_OPTIONS.includes(value)) {
      value = "";
    }
    if (name === "action" && value && !ACTION_OPTIONS.includes(value)) {
      value = "";
    }
    setDraft((d) => ({ ...d, [name]: value }));
  };

  // Keep the draft in sync when the applied filters change (e.g. after Clear or
  // when landing on a filtered URL), so the inputs reflect the active filters.
  const filtersKey = [
    filters.q,
    filters.resource,
    filters.action,
    filters.actor,
    filters.from,
    filters.to,
  ].join("|");
  useEffect(() => {
    setDraft({
      q: filters.q,
      resource: filters.resource,
      action: filters.action,
      actor: filters.actor,
      from: filters.from,
      to: filters.to,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey]);

  const applyFilters = () =>
    submit(buildParams({ ...draft, page: 1 }), { method: "get" });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasFilters =
    filters.q ||
    filters.resource ||
    filters.action ||
    filters.actor ||
    filters.from ||
    filters.to;

  // Build URL params from current filters, with optional overrides.
  const buildParams = (overrides = {}) => {
    const merged = { ...filters, ...overrides };
    const p = new URLSearchParams();
    if (merged.q) p.set("q", merged.q);
    if (merged.resource) p.set("resource", merged.resource);
    if (merged.action) p.set("action", merged.action);
    if (merged.actor) p.set("actor", merged.actor);
    if (merged.from) p.set("from", merged.from);
    if (merged.to) p.set("to", merged.to);
    if (merged.page) p.set("page", String(merged.page));
    return p;
  };

  const goToPage = (nextPage) =>
    submit(buildParams({ page: nextPage }), { method: "get" });

  return (
    <s-page heading="Activity Dashboard">
      <style>{`
        .sat-tiles { --tile-bg: #fff; --tile-border: #E3E3E3; --tile-value: #1A1A1A; }
        @media (prefers-color-scheme: dark) {
          .sat-tiles { --tile-bg: #1A1A1A; --tile-border: #333; --tile-value: #F6F6F6; }
        }
        :root[data-theme="dark"] .sat-tiles { --tile-bg: #1A1A1A; --tile-border: #333; --tile-value: #F6F6F6; }
        :root[data-theme="light"] .sat-tiles { --tile-bg: #fff; --tile-border: #E3E3E3; --tile-value: #1A1A1A; }
      `}</style>
      {/* Summary stats */}
      <s-section heading="Overview">
        <s-grid
          class="sat-tiles"
          gridTemplateColumns="1fr 1fr 1fr 1fr"
          gap="base"
        >
          <StatTile
            label="Total events"
            value={stats.totalAll}
            icon="events"
            accent="blue"
            trend={
              stats.hasMultiDayData
                ? trendVsYesterday(stats.todayCount, stats.yesterdayCount)
                : null
            }
          />
          <StatTile
            label="Events today"
            value={stats.todayCount}
            icon="calendar"
            accent="green"
            trend={
              stats.hasMultiDayData
                ? trendVsYesterday(stats.todayCount, stats.yesterdayCount)
                : null
            }
          />
          <StatTile
            label="Top resource"
            value={stats.topResource}
            icon="resource"
            accent="amber"
          />
          <StatTile
            label="Sources"
            value={stats.activeUsers}
            icon="users"
            accent="violet"
          />
        </s-grid>
      </s-section>

      {/* Filters — collapsed by default, opens when clicked or when a filter is active */}
      <s-section>
        <details open={Boolean(hasFilters)}>
          <summary
            style={{
              cursor: "pointer",
              listStyle: "none",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontWeight: 600,
              fontSize: "14px",
              userSelect: "none",
            }}
          >
            <s-icon type="filter" size="base"></s-icon>
            Search &amp; filter
            {hasFilters ? (
              <s-badge tone="info">Active</s-badge>
            ) : null}
          </summary>
          <div style={{ marginTop: "16px" }}>
            <s-stack direction="block" gap="base">
              <s-search-field
                label="Search"
                name="q"
                value={draft.q}
                placeholder="Search summary, user, topic, or ID…"
                onInput={setField("q")}
                onChange={setField("q")}
              ></s-search-field>

              <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                <s-select
                  label="Resource"
                  name="resource"
                  value={draft.resource}
                  onChange={setField("resource")}
                >
                  <s-option value="">All resources</s-option>
                  {RESOURCE_OPTIONS.map((r) => (
                    <s-option key={r} value={r}>
                      {resourceLabel(r)}
                    </s-option>
                  ))}
                </s-select>

                <s-select
                  label="Action"
                  name="action"
                  value={draft.action}
                  onChange={setField("action")}
                >
                  <s-option value="">All actions</s-option>
                  {ACTION_OPTIONS.map((a) => (
                    <s-option key={a} value={a}>
                      {actionLabel(a)}
                    </s-option>
                  ))}
                </s-select>
              </s-grid>

              <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="base">
                <s-text-field
                  label="User (name or email)"
                  name="actor"
                  value={draft.actor}
                  placeholder="e.g. jane@store.com"
                  onInput={setField("actor")}
                  onChange={setField("actor")}
                ></s-text-field>
                <DateField
                  label="From"
                  name="from"
                  value={draft.from}
                  max={draft.to || today}
                  onChange={setField("from")}
                />
                <DateField
                  label="To"
                  name="to"
                  value={draft.to}
                  min={draft.from || undefined}
                  max={today}
                  onChange={setField("to")}
                />
              </s-grid>

              <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                <button
                  type="button"
                  onClick={applyFilters}
                  style={{
                    background: "#303030",
                    color: "#fff",
                    border: "none",
                    borderRadius: "8px",
                    padding: "8px 16px",
                    fontSize: "14px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Apply filters
                </button>
                {hasFilters ? (
                  <button
                    type="button"
                    onClick={() => navigate("/app")}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#616161",
                      fontSize: "14px",
                      cursor: "pointer",
                    }}
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            </s-stack>
          </div>
        </details>
      </s-section>

      {/* Results */}
      <s-section heading={`Activity logs`}>
        {logs.length === 0 ? (
          <s-box
            padding="large"
            borderRadius="base"
            background="subdued"
          >
            <s-stack direction="block" gap="small-200" alignItems="center">
              <s-heading>No activity yet</s-heading>
              <s-paragraph color="subdued">
                {hasFilters
                  ? "No events match these filters. Try clearing them."
                  : "Changes made in your store will appear here as they happen."}
              </s-paragraph>
            </s-stack>
          </s-box>
        ) : (
          <s-stack direction="block" gap="base">
            <s-table variant="auto">
              <s-table-header-row>
                <s-table-header>Time</s-table-header>
                <s-table-header>Resource</s-table-header>
                <s-table-header>Action</s-table-header>
                <s-table-header listSlot="primary">Summary</s-table-header>
                <s-table-header>User</s-table-header>
                <s-table-header>Source</s-table-header>
                <s-table-header></s-table-header>
              </s-table-header-row>
              <s-table-body>
                {logs.map((log) => {
                  const { date, time } = formatDateParts(log.occurredAt);
                  return (
                  <s-table-row key={log.id}>
                    <s-table-cell>
                      <div style={{ whiteSpace: "nowrap", lineHeight: 1.3 }}>
                        <div>{date}</div>
                        <div style={{ color: "#616161", fontSize: "12px" }}>
                          {time}
                        </div>
                      </div>
                    </s-table-cell>
                    <s-table-cell>
                      <div style={{ whiteSpace: "nowrap" }}>
                        {resourceLabel(log.resource)}
                      </div>
                    </s-table-cell>
                    <s-table-cell>
                      <s-badge tone={toneForAction(log.action)}>
                        {actionLabel(log.action)}
                      </s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      <s-box maxInlineSize="340px">
                        <s-text>
                          {cleanSummary(log.summary || log.title || log.topic)}
                        </s-text>
                      </s-box>
                    </s-table-cell>
                    <s-table-cell>
                      {log.actorName || log.actorEmail ? (
                        <div style={{ lineHeight: 1.3 }}>
                          <div>{log.actorName || log.actorEmail}</div>
                          {log.actorName && log.actorEmail ? (
                            <div style={{ color: "#616161", fontSize: "12px" }}>
                              {log.actorEmail}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        "—"
                      )}
                    </s-table-cell>
                    <s-table-cell>{log.sourceLabel || "—"}</s-table-cell>
                    <s-table-cell>
                      <button
                        type="button"
                        onClick={() => navigate(`/app/logs/${log.id}`)}
                        style={{
                          background: "none",
                          border: "none",
                          padding: 0,
                          color: "#2C6ECB",
                          fontSize: "14px",
                          cursor: "pointer",
                        }}
                      >
                        View
                      </button>
                    </s-table-cell>
                  </s-table-row>
                  );
                })}
              </s-table-body>
            </s-table>

            {/* Pagination — centered, arrow buttons */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "12px",
                paddingTop: "8px",
              }}
            >
              <PagerButton
                label="Previous page"
                disabled={page <= 1}
                onClick={() => goToPage(page - 1)}
                dir="left"
              />
              <span style={{ fontSize: "13px", color: "#6D7175" }}>
                Page {page} of {totalPages}
              </span>
              <PagerButton
                label="Next page"
                disabled={page >= totalPages}
                onClick={() => goToPage(page + 1)}
                dir="right"
              />
            </div>
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
