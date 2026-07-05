/**
 * Helpers for turning a raw Shopify webhook (topic + payload) into a
 * structured, human-readable ActivityLog entry.
 *
 * Note on "user"/actor data: most Shopify webhook payloads do NOT include which
 * staff member performed the change. We extract actor info opportunistically
 * (orders carry `user_id`; some payloads carry `email`/name fields) and fall
 * back to the shop/system otherwise. See README for the full explanation.
 */

import { parseTopic, resourceLabel, actionLabel } from "./activity";

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
