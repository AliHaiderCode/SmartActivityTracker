import { authenticate } from "../shopify.server";
import db from "../db.server";
import { parseTopic, stripHtml } from "../utils/activity";
import { summarize, enrichActor } from "../utils/activity.server";

/**
 * Catch-all activity webhook. Every store-change topic subscribed in
 * shopify.app.toml points here. We turn the payload into a structured
 * ActivityLog row, deduped by the Shopify webhook id.
 */
export const action = async ({ request }) => {
  const { topic, shop, payload, webhookId, triggeredAt, admin } =
    await authenticate.webhook(request);

  const { resource, action: eventAction } = parseTopic(topic);
  let { title, summary, resourceId, actor } = summarize(topic, payload);

  // If the payload itself gave us a person (e.g. a customer's email/name),
  // that's a user-sourced change.
  let sourceType = actor.actorName || actor.actorEmail ? "user" : "system";

  // Best-effort "who did it" via the Admin events API. Only enrich when the
  // payload didn't already give us a real actor and we have an admin client +
  // a resource GID. Deletes have no node to query.
  if (!actor.actorName && !actor.actorEmail && admin && eventAction !== "delete") {
    const gid = payload?.admin_graphql_api_id;
    const enriched = await enrichActor(admin, gid, resource);
    if (enriched.actorName) actor.actorName = enriched.actorName;
    if (enriched.actorEmail) actor.actorEmail = enriched.actorEmail;
    sourceType = enriched.sourceType;
    // The event message is Shopify's own human description of the change and,
    // on Plus with read_users, often names the staff member — prefer it.
    // It's HTML, so strip tags for a clean plain-text summary.
    if (enriched.eventMessage) summary = stripHtml(enriched.eventMessage);
  }

  // Meaningful fallback so the "User / source" column is never blank:
  //  - deletes can't be queried (the resource is gone)
  //  - themes/inventory don't expose events, so the source is unknown
  if (!actor.actorName && !actor.actorEmail) {
    actor.actorName = eventAction === "delete" ? "Deleted" : "Unknown";
    sourceType = "system";
  }

  const occurredAt = triggeredAt ? new Date(triggeredAt) : new Date();

  const data = {
    shop,
    topic,
    resource,
    action: eventAction,
    resourceId,
    title,
    summary,
    actorName: actor.actorName,
    actorEmail: actor.actorEmail,
    actorId: actor.actorId,
    sourceType,
    payload,
    webhookId,
    occurredAt,
  };

  try {
    // webhookId is unique → upsert makes retries/duplicate deliveries idempotent.
    if (webhookId) {
      await db.activityLog.upsert({
        where: { webhookId },
        create: data,
        update: {}, // already logged; nothing to change
      });
    } else {
      await db.activityLog.create({ data });
    }
  } catch (error) {
    console.error(`Failed to store activity for ${topic} (${shop})`, error);
    // Return 200 anyway so Shopify doesn't retry storms on a persistent
    // DB error; the event is lost but the endpoint stays healthy.
  }

  return new Response();
};
