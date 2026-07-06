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

// Known multi-word resources must be matched before single-word ones so that
// e.g. "DRAFT_ORDERS_UPDATE" resolves to resource "draft_orders", not "draft".
const KNOWN_RESOURCES = [
  "draft_orders",
  "inventory_levels",
  "inventory_items",
  "collection_listings",
  "products",
  "collections",
  "orders",
  "refunds",
  "customers",
  "fulfillments",
  "discounts",
  "themes",
  "shop",
  "app",
];

/**
 * Parse a webhook topic into { resource, action }. Shopify delivers topics in
 * two shapes depending on the API surface:
 *   - slash form:      "products/update", "orders/partially_fulfilled"
 *   - enum form:       "PRODUCTS_UPDATE", "ORDERS_PARTIALLY_FULFILLED"
 * Both must yield resource "products"/"orders" and the correct action.
 */
export function parseTopic(topic) {
  const raw = String(topic || "").trim();
  if (!raw) return { resource: "unknown", action: "event" };

  // Normalize the enum form to the slash form: underscore between the resource
  // and action isn't distinguishable by position, so match known resources.
  const lower = raw.toLowerCase();

  // Slash form — split on the first slash.
  const slashIndex = lower.indexOf("/");
  if (slashIndex !== -1) {
    return {
      resource: lower.slice(0, slashIndex),
      action: lower.slice(slashIndex + 1),
    };
  }

  // Enum/underscore form — find the known resource prefix.
  for (const res of KNOWN_RESOURCES) {
    if (lower === res) return { resource: res, action: "event" };
    if (lower.startsWith(`${res}_`)) {
      return { resource: res, action: lower.slice(res.length + 1) };
    }
  }

  // Unknown shape — best effort: first token is the resource.
  const underscore = lower.indexOf("_");
  if (underscore !== -1) {
    return {
      resource: lower.slice(0, underscore),
      action: lower.slice(underscore + 1),
    };
  }
  return { resource: lower, action: "event" };
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

// Shopify admin actions are attributed to the "Shopify Web" app, but the acting
// staff member's name is embedded at the start of the event message, e.g.
// "Ali Haider created this draft order." Extract that leading name.
const STAFF_MESSAGE_RE =
  /^([A-Z][\p{L}.'-]+(?:\s+[A-Z][\p{L}.'-]+){0,3})\s+(?:created|updated|changed|added|removed|deleted|edited|marked|fulfilled|refunded|cancelled|canceled|captured|archived|unarchived|imported|adjusted|set|placed|paid|published|unpublished|closed|opened|reopened|sent|approved|rejected|duplicated|enabled|disabled|activated|deactivated|renamed|moved|assigned|scheduled|restocked|voided|completed|started|connected|disconnected)\b/u;

// Names that are really apps/automation, not people.
const APP_LIKE = /^(shopify|online store|point of sale|pos|draft orders?)$/i;

export function staffNameFromMessage(message) {
  if (!message) return null;
  const text = String(message)
    .replace(/<[^>]*>/g, "")
    .trim();
  const m = text.match(STAFF_MESSAGE_RE);
  const name = m ? m[1].trim() : null;
  return name && !APP_LIKE.test(name) ? name : null;
}

// Shopify event messages are HTML (e.g. contain <a> links). Strip tags and
// decode the few common entities so summaries render as clean plain text.
export function stripHtml(html) {
  if (!html) return html;
  return String(html)
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
