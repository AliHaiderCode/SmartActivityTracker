import { authenticate } from "../shopify.server";
import db from "../db.server";
import { parseTopic } from "../utils/activity";
import { summarize } from "../utils/activity.server";

/**
 * Catch-all activity webhook. Every store-change topic subscribed in
 * shopify.app.toml points here. We turn the payload into a structured
 * ActivityLog row, deduped by the Shopify webhook id.
 */
export const action = async ({ request }) => {
  const { topic, shop, payload, webhookId, triggeredAt } =
    await authenticate.webhook(request);

  const { resource, action: eventAction } = parseTopic(topic);
  const { title, summary, resourceId, actor } = summarize(topic, payload);

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
