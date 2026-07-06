import { authenticate } from "../shopify.server";
import db from "../db.server";
import { parseTopic, stripHtml, staffNameFromMessage } from "../utils/activity";
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

  // Attribution is split into two independent things:
  //   actorName/actorEmail → the PERSON who did it (null if not a person)
  //   sourceLabel          → where it came from (app / "System")
  let sourceType = actor.actorName || actor.actorEmail ? "user" : "system";
  let sourceLabel = null;

  // Best-effort enrichment via the Admin events API. Deletes have no node.
  if (admin && eventAction !== "delete") {
    const gid = payload?.admin_graphql_api_id;
    const enriched = await enrichActor(admin, gid, resource);
    // Only take the person from enrichment if the payload didn't already have one.
    if (!actor.actorName && !actor.actorEmail) {
      if (enriched.actorName) actor.actorName = enriched.actorName;
      if (enriched.actorEmail) actor.actorEmail = enriched.actorEmail;
    }
    sourceType = enriched.sourceType;
    if (enriched.sourceLabel) sourceLabel = enriched.sourceLabel;
    // The event message often names the staff member and describes the change
    // precisely — prefer it (it's HTML, so strip tags).
    if (enriched.eventMessage) summary = stripHtml(enriched.eventMessage);
  }

  // "Admin user" isn't a real person name — treat it as no user, source only.
  if (actor.actorName === "Admin user") {
    actor.actorName = null;
    sourceLabel = sourceLabel || "Shopify admin";
  }

  // Guarantee: if the final summary names a staff member (e.g. "Ali Haider
  // created…"), that person IS the user — surface them even if enrichment
  // didn't. This is the strongest signal the merchant sees.
  if (!actor.actorName && !actor.actorEmail) {
    const named = staffNameFromMessage(summary);
    if (named) {
      actor.actorName = named;
      sourceType = "user";
      if (!sourceLabel) sourceLabel = "Shopify admin";
    }
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
    actorName: actor.actorName || null,
    actorEmail: actor.actorEmail || null,
    actorId: actor.actorId,
    sourceType,
    sourceLabel,
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
