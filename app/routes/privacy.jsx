/**
 * Public privacy policy page — no authentication.
 * Reachable at /privacy, e.g. https://your-app.up.railway.app/privacy
 * Use this URL as the "Privacy policy URL" in your Shopify App Store listing.
 *
 * NOTE: This is a DRAFT. Review it with a legal advisor and replace the
 * placeholders (contact email, company name, effective date) before submitting.
 */

const CONTACT_EMAIL = "ali@bluestout.com";
const APP_NAME = "Smart Activity Tracker";
const EFFECTIVE_DATE = "July 5, 2026";

const styles = {
  page: {
    maxWidth: "760px",
    margin: "0 auto",
    padding: "48px 24px 80px",
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    color: "#202223",
    lineHeight: 1.6,
  },
  h1: { fontSize: "32px", marginBottom: "4px" },
  meta: { color: "#6d7175", fontSize: "14px", marginBottom: "32px" },
  h2: { fontSize: "20px", marginTop: "32px", marginBottom: "8px" },
  li: { marginBottom: "6px" },
};

export const meta = () => [{ title: `Privacy Policy — ${APP_NAME}` }];

export default function Privacy() {
  return (
    <main style={styles.page}>
      <h1 style={styles.h1}>Privacy Policy</h1>
      <p style={styles.meta}>
        {APP_NAME} · Effective {EFFECTIVE_DATE}
      </p>

      <p>
        This Privacy Policy explains how {APP_NAME} (&quot;the App&quot;,
        &quot;we&quot;, &quot;us&quot;) collects, uses, and protects information
        when a merchant installs and uses the App on their Shopify store.
      </p>

      <h2 style={styles.h2}>1. Information we process</h2>
      <p>
        The App creates an activity log of changes in a merchant&apos;s Shopify
        store. To do this we receive and store data delivered by Shopify
        webhooks, which may include:
      </p>
      <ul>
        <li style={styles.li}>
          Store resource changes (products, collections, inventory, discounts,
          themes, fulfillments and, where authorized, orders and customers).
        </li>
        <li style={styles.li}>
          The webhook payload for each event, which may contain personal data
          such as customer names, email addresses, and order details.
        </li>
        <li style={styles.li}>
          Store and app session data required to authenticate the App with
          Shopify.
        </li>
      </ul>

      <h2 style={styles.h2}>2. How we use the information</h2>
      <p>
        We use this information solely to provide the App&apos;s core function —
        maintaining a searchable audit log of store activity for the installing
        merchant. We do not sell personal data, and we do not use it for
        advertising or any purpose beyond providing the service.
      </p>

      <h2 style={styles.h2}>3. Storage and security</h2>
      <ul>
        <li style={styles.li}>
          Data is stored in a PostgreSQL database hosted on our infrastructure
          provider (Railway), encrypted in transit (TLS) and at rest.
        </li>
        <li style={styles.li}>
          Access to the database is restricted to authorized personnel.
        </li>
        <li style={styles.li}>
          <strong>Retention:</strong> activity logs are automatically deleted
          after 90 days by default. Session data is removed when the App is
          uninstalled.
        </li>
      </ul>

      <h2 style={styles.h2}>4. Data sharing</h2>
      <p>
        We do not share merchant or customer data with third parties, except our
        infrastructure provider strictly for hosting the service, and where
        required by law.
      </p>

      <h2 style={styles.h2}>5. Your rights (GDPR / compliance)</h2>
      <p>
        The App honors Shopify&apos;s mandatory compliance webhooks:
      </p>
      <ul>
        <li style={styles.li}>
          <strong>Customer data request:</strong> we can provide the activity
          data we hold for a given customer.
        </li>
        <li style={styles.li}>
          <strong>Customer redact:</strong> we delete stored activity data for a
          specific customer on request.
        </li>
        <li style={styles.li}>
          <strong>Shop redact:</strong> we delete all stored data for a shop 48
          hours after the App is uninstalled.
        </li>
      </ul>

      <h2 style={styles.h2}>6. Changes to this policy</h2>
      <p>
        We may update this policy from time to time. Material changes will be
        reflected by updating the effective date above.
      </p>

      <h2 style={styles.h2}>7. Contact</h2>
      <p>
        For any privacy questions or requests, contact us at{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </main>
  );
}
