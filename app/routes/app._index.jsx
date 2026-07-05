/* eslint-disable react/prop-types */
import { Form, useLoaderData, useNavigation, useSubmit } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { actionLabel, resourceLabel } from "../utils/activity";

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

  const [logs, total, totalAll, todayCount, resourceGroups] = await Promise.all([
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
  ]);

  const topResource = resourceGroups[0]?.resource
    ? resourceLabel(resourceGroups[0].resource)
    : "—";

  const distinctActors = await db.activityLog.findMany({
    where: { shop, actorEmail: { not: null } },
    select: { actorEmail: true },
    distinct: ["actorEmail"],
  });

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
      occurredAt: l.occurredAt.toISOString(),
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
    filters: { q, resource, action, actor, from, to },
    stats: {
      totalAll,
      todayCount,
      topResource,
      activeUsers: distinctActors.length,
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
  const { logs, total, page, pageSize, filters, stats } = useLoaderData();
  const navigation = useNavigation();
  const submit = useSubmit();
  const isLoading = navigation.state === "loading";

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

  const goToPage = (nextPage) => {
    const p = new URLSearchParams();
    if (filters.q) p.set("q", filters.q);
    if (filters.resource) p.set("resource", filters.resource);
    if (filters.action) p.set("action", filters.action);
    if (filters.actor) p.set("actor", filters.actor);
    if (filters.from) p.set("from", filters.from);
    if (filters.to) p.set("to", filters.to);
    p.set("page", String(nextPage));
    submit(p, { method: "get" });
  };

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
          <StatTile label="Active users" value={stats.activeUsers} />
        </s-grid>
      </s-section>

      {/* Filters */}
      <s-section heading="Search & filter">
        <Form method="get">
          {/* reset page whenever filters change */}
          <input type="hidden" name="page" value="1" />
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
                <s-table-header>User</s-table-header>
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
                      {log.summary || log.title || log.topic}
                    </s-table-cell>
                    <s-table-cell>
                      {log.actorName || log.actorEmail || "—"}
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
