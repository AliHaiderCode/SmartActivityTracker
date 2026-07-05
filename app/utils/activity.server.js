/**
 * Helpers for turning a raw Shopify webhook (topic + payload) into a
 * structured, human-readable ActivityLog entry.
 *
 * Note on "user"/actor data: most Shopify webhook payloads do NOT include which
 * staff member performed the change. We extract actor info opportunistically
 * (orders carry `user_id`; some payloads carry `email`/name fields) and fall
 * back to the shop/system otherwise. See README for the full explanation.
 */

import {
  parseTopic,
  resourceLabel,
  actionLabel,
  staffNameFromMessage,
} from "./activity";

// Generic: latest event on any HasEvents resource (products, collections,
// discounts, customers, etc.). The event `message` names the staff on Plus.
const LATEST_EVENT_QUERY = `#graphql
  query ActivityLatestEvent($id: ID!) {
    node(id: $id) {
      ... on HasEvents {
        events(first: 1, reverse: true, sortKey: CREATED_AT) {
          edges {
            node {
              message
              attributeToUser
              attributeToApp
              appTitle
            }
          }
        }
      }
    }
  }`;

// Order-specific: with read_users, Order.staffMember gives the exact staff
// member who created the order — the strongest attribution we can get.
const ORDER_STAFF_QUERY = `#graphql
  query ActivityOrderStaff($id: ID!) {
    order(id: $id) {
      staffMember {
        name
        email
      }
      events(first: 1, reverse: true, sortKey: CREATED_AT) {
        edges {
          node {
            message
            attributeToUser
            attributeToApp
            appTitle
          }
        }
      }
    }
  }`;

// Classify an event into { actorName, sourceType }.
//  sourceType: "user" (a staff member), "app" (an app/automation), "system".
function classifyEvent(event) {
  if (!event) return { actorName: null, sourceType: "system" };

  // If the message names a person, that person did it — strongest signal,
  // even when Shopify attributes the action to the "Shopify Web" app.
  const named = staffNameFromMessage(event.message);
  if (named) {
    return { actorName: named, sourceType: "user" };
  }

  if (event.attributeToApp) {
    return {
      actorName: event.appTitle ? `${event.appTitle} (app)` : "App",
      sourceType: "app",
    };
  }
  if (event.attributeToUser) {
    return { actorName: "Admin user", sourceType: "user" };
  }
  return { actorName: "System", sourceType: "system" };
}

/**
 * Enrich a log with "who did it" and classify its source.
 *
 * Attribution sources (best → fallback), verified against Shopify docs:
 *  1. Order.staffMember → real staff name + email (needs read_users; Plus only).
 *  2. attributeToApp/appTitle → the app/automation that made the change.
 *  3. attributeToUser → a staff member ("Admin user"; name hidden without a
 *     per-resource staffMember field — only orders expose one).
 *
 * Returns { actorName, actorEmail, sourceType, eventMessage } — never throws.
 */
export async function enrichActor(admin, resourceGid, resource) {
  const empty = {
    actorName: null,
    actorEmail: null,
    sourceType: "system",
    eventMessage: null,
  };
  if (!admin || !resourceGid || !String(resourceGid).startsWith("gid://")) {
    return empty;
  }

  try {
    // Orders: prefer the exact staff member.
    if (resource === "orders") {
      const res = await admin.graphql(ORDER_STAFF_QUERY, {
        variables: { id: resourceGid },
      });
      const order = (await res.json())?.data?.order;
      const staff = order?.staffMember;
      const event = order?.events?.edges?.[0]?.node;
      const eventMessage = event?.message || null;

      // A named staff member means a person did it.
      if (staff?.name || staff?.email) {
        return {
          actorName: staff.name || null,
          actorEmail: staff.email || null,
          sourceType: "user",
          eventMessage,
        };
      }
      const classified = classifyEvent(event);
      return { ...classified, actorEmail: null, eventMessage };
    }

    // Everything else: latest event on the resource.
    const response = await admin.graphql(LATEST_EVENT_QUERY, {
      variables: { id: resourceGid },
    });
    const event = (await response.json())?.data?.node?.events?.edges?.[0]?.node;
    if (!event) return empty;

    const classified = classifyEvent(event);
    return {
      ...classified,
      actorEmail: null,
      eventMessage: event.message || null,
    };
  } catch (error) {
    console.error("enrichActor failed", error);
    return empty;
  }
}

function money(amount, currency) {
  if (amount == null) return null;
  const value = Number(amount);
  if (Number.isNaN(value)) return `${amount}`;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
    }).format(value);
  } catch {
    return `${value} ${currency || ""}`.trim();
  }
}

// Pull the affected object's id from the payload (varies by resource).
function extractResourceId(resource, payload) {
  if (!payload || typeof payload !== "object") return null;
  const id =
    payload.id ??
    payload.admin_graphql_api_id ??
    payload.inventory_item_id ??
    payload.order_id ??
    null;
  return id != null ? String(id) : null;
}

// Best-effort extraction of the staff member behind the change.
function extractActor(payload) {
  const actor = { actorId: null, actorName: null, actorEmail: null };
  if (!payload || typeof payload !== "object") return actor;

  if (payload.user_id != null) actor.actorId = String(payload.user_id);

  // Customer-shaped payloads carry email + name of the *customer*, not staff,
  // but for customers/* events that IS the subject we care about.
  if (payload.email) actor.actorEmail = String(payload.email);

  const first = payload.first_name;
  const last = payload.last_name;
  if (first || last) {
    actor.actorName = [first, last].filter(Boolean).join(" ").trim();
  }

  return actor;
}

/**
 * Build a { title, summary, resourceId, actor } record for a webhook.
 * `title` is a short label for the affected object; `summary` is a full
 * human sentence describing what happened.
 */
export function summarize(topic, payload) {
  const { resource, action } = parseTopic(topic);
  const label = resourceLabel(resource);
  const resourceId = extractResourceId(resource, payload);
  const actor = extractActor(payload);
  const p = payload && typeof payload === "object" ? payload : {};

  let title = null;
  let summary = null;

  switch (resource) {
    case "products": {
      title = p.title || (resourceId ? `Product ${resourceId}` : "Product");
      summary = `Product "${title}" was ${actionLabel(action).toLowerCase()}`;
      if (p.status) summary += ` (status: ${p.status})`;
      break;
    }
    case "collections": {
      title = p.title || (resourceId ? `Collection ${resourceId}` : "Collection");
      summary = `Collection "${title}" was ${actionLabel(action).toLowerCase()}`;
      break;
    }
    case "orders": {
      const name = p.name || (p.order_number ? `#${p.order_number}` : null);
      title = name || (resourceId ? `Order ${resourceId}` : "Order");
      const total = money(p.total_price, p.currency);
      summary = `Order ${title} was ${actionLabel(action).toLowerCase()}`;
      if (total) summary += ` — ${total}`;
      if (p.email) actor.actorEmail = actor.actorEmail || String(p.email);
      break;
    }
    case "draft_orders": {
      const name = p.name || (resourceId ? `Draft order ${resourceId}` : "Draft order");
      title = name;
      const total = money(p.total_price, p.currency);
      summary = `Draft order ${title} was ${actionLabel(action).toLowerCase()}`;
      if (total) summary += ` — ${total}`;
      break;
    }
    case "refunds": {
      const orderId = p.order_id != null ? `#${p.order_id}` : "";
      title = resourceId ? `Refund ${resourceId}` : "Refund";
      summary = `A refund was created${orderId ? ` on order ${orderId}` : ""}`;
      break;
    }
    case "customers": {
      const name =
        [p.first_name, p.last_name].filter(Boolean).join(" ").trim() ||
        p.email ||
        (resourceId ? `Customer ${resourceId}` : "Customer");
      title = name;
      summary = `Customer "${name}" was ${actionLabel(action).toLowerCase()}`;
      break;
    }
    case "fulfillments": {
      title = resourceId ? `Fulfillment ${resourceId}` : "Fulfillment";
      const orderId = p.order_id != null ? ` for order #${p.order_id}` : "";
      summary = `Fulfillment${orderId} was ${actionLabel(action).toLowerCase()}`;
      if (p.tracking_number) summary += ` (tracking: ${p.tracking_number})`;
      break;
    }
    case "inventory_levels": {
      title = p.inventory_item_id
        ? `Inventory item ${p.inventory_item_id}`
        : "Inventory level";
      const qty = p.available != null ? `, available: ${p.available}` : "";
      summary = `Inventory level ${actionLabel(action).toLowerCase()}${qty}`;
      break;
    }
    case "inventory_items": {
      title = p.sku || (resourceId ? `Inventory item ${resourceId}` : "Inventory item");
      summary = `Inventory item "${title}" was ${actionLabel(action).toLowerCase()}`;
      break;
    }
    case "discounts": {
      title = p.title || p.code || (resourceId ? `Discount ${resourceId}` : "Discount");
      summary = `Discount "${title}" was ${actionLabel(action).toLowerCase()}`;
      break;
    }
    case "themes": {
      title = p.name || (resourceId ? `Theme ${resourceId}` : "Theme");
      summary = `Theme "${title}" was ${actionLabel(action).toLowerCase()}`;
      if (p.role) summary += ` (role: ${p.role})`;
      break;
    }
    case "shop": {
      title = p.name || p.myshopify_domain || "Shop";
      summary = `Shop settings were ${actionLabel(action).toLowerCase()}`;
      break;
    }
    default: {
      title = resourceId ? `${label} ${resourceId}` : label;
      summary = `${label} ${actionLabel(action).toLowerCase()}`;
    }
  }

  return { title, summary, resourceId, actor };
}
