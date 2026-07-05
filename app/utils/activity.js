/**
 * Pure, isomorphic helpers for activity topics/labels.
 * Safe to import from both server loaders and client components
 * (no DB, no secrets — that lives in activity.server.js).
 */

// Maps the first segment of a topic to a friendly resource label.
const RESOURCE_LABELS = {
  products: "Product",
  collections: "Collection",
  orders: "Order",
  draft_orders: "Draft order",
  refunds: "Refund",
  customers: "Customer",
  fulfillments: "Fulfillment",
  inventory_levels: "Inventory level",
  inventory_items: "Inventory item",
  discounts: "Discount",
  themes: "Theme",
  shop: "Shop",
  app: "App",
};

/**
 * Split "products/update" → { resource: "products", action: "update" }.
 * Handles multi-segment topics like "orders/partially_fulfilled".
 */
export function parseTopic(topic) {
  const normalized = String(topic || "").toLowerCase();
  const slashIndex = normalized.indexOf("/");
  if (slashIndex === -1) {
    return { resource: normalized || "unknown", action: "event" };
  }
  return {
    resource: normalized.slice(0, slashIndex),
    action: normalized.slice(slashIndex + 1),
  };
}

// Human label for a resource key, falling back to a title-cased version.
export function resourceLabel(resource) {
  if (RESOURCE_LABELS[resource]) return RESOURCE_LABELS[resource];
  return String(resource || "")
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Human label for an action key, e.g. "partially_fulfilled" → "Partially fulfilled".
export function actionLabel(action) {
  const cleaned = String(action || "").replace(/_/g, " ");
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}
