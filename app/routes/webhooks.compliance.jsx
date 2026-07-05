import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * Mandatory GDPR / compliance webhooks (required for App Store approval):
 *   - customers/data_request : merchant requested a customer's stored data
 *   - customers/redact       : delete a specific customer's data
 *   - shop/redact            : delete all shop data (48h after uninstall)
 */
export const action = async ({ request }) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  console.log(`Received compliance webhook ${topic} for ${shop}`);

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST":
    case "customers/data_request": {
      // We only store activity metadata, not customer PII beyond what appears
      // in webhook payloads. Nothing to compile/return here.
      break;
    }
    case "CUSTOMERS_REDACT":
    case "customers/redact": {
      const customerId = payload?.customer?.id
        ? String(payload.customer.id)
        : null;
      if (customerId) {
        await db.activityLog.deleteMany({
          where: { shop, resource: "customers", resourceId: customerId },
        });
      }
      break;
    }
    case "SHOP_REDACT":
    case "shop/redact": {
      await db.activityLog.deleteMany({ where: { shop } });
      break;
    }
    default:
      break;
  }

  return new Response();
};
