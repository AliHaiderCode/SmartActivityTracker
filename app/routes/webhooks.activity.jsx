import { authenticate } from "../shopify.server";
import db from "../db.server";
import { parseTopic } from "../utils/activity";
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
  const { title, summary, resourceId, actor } = summarize(topic, payload);

  // Best-effort "who did it" via the Admin events API. Only enrich when the
  // payload didn't already give us a real actor (e.g. customer email) and we
  // have an admin client + a resource GID. Deletes have no node to query.
  if (!actor.actorName && !actor.actorEmail && admin && eventAction !== "delete") {
    const gid = payload?.admin_graphql_api_id;
    const enriched = await enrichActor(admin, gid);
    if (enriched.actorName) actor.actorName = enriched.actorName;
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
