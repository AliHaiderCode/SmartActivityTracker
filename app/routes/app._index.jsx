/* eslint-disable react/prop-types */
import { Form, useLoaderData, useNavigation, useSubmit } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { actionLabel, resourceLabel, stripHtml } from "../utils/activity";

const PAGE_SIZE = 25;

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

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const params = url.searchParams;

  const q = params.get("q")?.trim() || "";
  const resource = params.get("resource") || "";
  const action = params.get("action") || "";
  const actor = params.get("actor")?.trim() || "";
  const from = params.get("from") || "";
  const to = params.get("to") || "";
  // Source tab: "" (all) | "user" (people) | "app" (apps & automation)
  const source = params.get("source") || "";
  const page = Math.max(1, parseInt(params.get("page") || "1", 10) || 1);

  // Build the Prisma where clause from the active filters.
  const where = { shop };

  if (resource) where.resource = resource;
  if (action) where.action = action;
  if (source === "user") where.sourceType = "user";
  // "Apps & automation" groups app-triggered and system/unattributed events.
  if (source === "app") where.sourceType = { in: ["app", "system"] };

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

  const [logs, total, totalAll, todayCount, resourceGroups, userCount, appCount] =
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
      db.activityLog.groupBy({
        by: ["resource"],
        where: { shop },
        _count: { resource: true },
        orderBy: { _count: { resource: "desc" } },
        take: 1,
      }),
      db.activityLog.count({ where: { shop, sourceType: "user" } }),
      db.activityLog.count({ where: { shop, sourceType: { in: ["app", "system"] } } }),
    ]);

  const topResource = resourceGroups[0]?.resource
    ? resourceLabel(resourceGroups[0].resource)
    : "—";

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
      occurredAt: l.occurredAt.toISOString(),
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
    filters: { q, resource, action, actor, from, to, source },
    counts: { all: totalAll, user: userCount, app: appCount },
    stats: {
      totalAll,
      todayCount,
      topResource,
      activeUsers: distinctSources.size,
    },
  };
};

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Clean an event summary for the table: strip HTML and cap length.
function cleanSummary(text, max = 90) {
  const clean = stripHtml(text) || "";
  return clean.length > max ? `${clean.slice(0, max).trimEnd()}…` : clean;
}

function StatTile({ label, value }) {
  return (
    <s-box
      padding="base"
      borderWidth="base"
      borderRadius="base"
      background="subdued"
    >
      <s-stack direction="block" gap="small-200">
        <s-text color="subdued">{label}</s-text>
        <s-heading>{value}</s-heading>
      </s-stack>
    </s-box>
  );
}

export default function Dashboard() {
  const { logs, total, page, pageSize, filters, stats, counts } =
    useLoaderData();
  const navigation = useNavigation();
  const submit = useSubmit();
  const isLoading = navigation.state === "loading";

  // Source tabs: All / People / Apps & automation.
  const SOURCE_TABS = [
    { key: "", label: "All", count: counts.all },
    { key: "user", label: "People", count: counts.user },
    { key: "app", label: "Apps & automation", count: counts.app },
  ];

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasFilters =
    filters.q ||
    filters.resource ||
    filters.action ||
    filters.actor ||
    filters.from ||
    filters.to;

  // Submit the filter form as the user changes selects/dates (GET → URL params).
  const autoSubmit = (event) => submit(event.currentTarget.form, { method: "get" });

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
    if (merged.source) p.set("source", merged.source);
    if (merged.page) p.set("page", String(merged.page));
    return p;
  };

  const goToPage = (nextPage) =>
    submit(buildParams({ page: nextPage }), { method: "get" });

  // Switch source tab (resets to page 1, keeps other filters).
  const switchSource = (nextSource) =>
    submit(buildParams({ source: nextSource, page: 1 }), { method: "get" });

  return (
    <s-page heading="Activity dashboard">
      {/* Summary stats */}
      <s-section heading="Overview">
        <s-grid
          gridTemplateColumns="1fr 1fr 1fr 1fr"
          gap="base"
        >
          <StatTile label="Total events" value={stats.totalAll} />
          <StatTile label="Events today" value={stats.todayCount} />
          <StatTile label="Top resource" value={stats.topResource} />
          <StatTile label="Sources" value={stats.activeUsers} />
        </s-grid>
      </s-section>

      {/* Filters */}
      <s-section heading="Search & filter">
        <Form method="get">
          {/* reset page whenever filters change; keep the active source tab */}
          <input type="hidden" name="page" value="1" />
          <input type="hidden" name="source" value={filters.source} />
          <s-stack direction="block" gap="base">
            <s-search-field
              label="Search"
              name="q"
              value={filters.q}
              placeholder="Search summary, user, topic, or ID…"
            ></s-search-field>

            <s-grid gridTemplateColumns="1fr 1fr" gap="base">
              <s-select
                label="Resource"
                name="resource"
                value={filters.resource}
                onChange={autoSubmit}
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
                value={filters.action}
                onChange={autoSubmit}
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
                value={filters.actor}
                placeholder="e.g. jane@store.com"
              ></s-text-field>
              <s-date-field
                label="From"
                name="from"
                value={filters.from}
                onChange={autoSubmit}
              ></s-date-field>
              <s-date-field
                label="To"
                name="to"
                value={filters.to}
                onChange={autoSubmit}
              ></s-date-field>
            </s-grid>

            <s-stack direction="inline" gap="base">
              <s-button variant="primary" type="submit">
                Apply filters
              </s-button>
              {hasFilters ? (
                <s-button variant="tertiary" href="/app">
                  Clear
                </s-button>
              ) : null}
            </s-stack>
          </s-stack>
        </Form>
      </s-section>

      {/* Results */}
      <s-section
        heading={`Activity log${total ? ` (${total})` : ""}`}
      >
        {/* Source tabs: separate people-made changes from apps/automation */}
        <s-stack direction="inline" gap="small-200">
          {SOURCE_TABS.map((tab) => (
            <s-button
              key={tab.key || "all"}
              variant={filters.source === tab.key ? "primary" : "tertiary"}
              onClick={() => switchSource(tab.key)}
            >
              {`${tab.label} (${tab.count})`}
            </s-button>
          ))}
        </s-stack>
        <s-box paddingBlockStart="base"></s-box>

        {isLoading ? (
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-spinner size="base" accessibilityLabel="Loading"></s-spinner>
            <s-text color="subdued">Loading…</s-text>
          </s-stack>
        ) : logs.length === 0 ? (
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
                <s-table-header>User / source</s-table-header>
                <s-table-header></s-table-header>
              </s-table-header-row>
              <s-table-body>
                {logs.map((log) => (
                  <s-table-row key={log.id}>
                    <s-table-cell>{formatDate(log.occurredAt)}</s-table-cell>
                    <s-table-cell>{resourceLabel(log.resource)}</s-table-cell>
                    <s-table-cell>
                      <s-badge tone={toneForAction(log.action)}>
                        {actionLabel(log.action)}
                      </s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      {cleanSummary(log.summary || log.title || log.topic)}
                    </s-table-cell>
                    <s-table-cell>
                      {log.actorName && log.actorEmail ? (
                        <s-stack direction="block" gap="small-500">
                          <s-text>{log.actorName}</s-text>
                          <s-text color="subdued">{log.actorEmail}</s-text>
                        </s-stack>
                      ) : (
                        log.actorName || log.actorEmail || "—"
                      )}
                    </s-table-cell>
                    <s-table-cell>
                      <s-link href={`/app/logs/${log.id}`}>View</s-link>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>

            {/* Pagination */}
            <s-stack
              direction="inline"
              gap="base"
              alignItems="center"
            >
              <s-button
                variant="secondary"
                disabled={page <= 1}
                onClick={() => goToPage(page - 1)}
              >
                Previous
              </s-button>
              <s-text color="subdued">
                Page {page} of {totalPages}
              </s-text>
              <s-button
                variant="secondary"
                disabled={page >= totalPages}
                onClick={() => goToPage(page + 1)}
              >
                Next
              </s-button>
            </s-stack>
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
