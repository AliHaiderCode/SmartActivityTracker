import { redirect, Form, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import styles from "./styles.module.css";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Smart Activity Tracker</h1>
        <p className={styles.text}>
          A complete, searchable audit log for your Shopify store. See every
          change — products, orders, customers, inventory and more — the moment
          it happens.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Capture everything</strong>. Real-time logs for products,
            orders, customers, collections, inventory, fulfillments, discounts
            and themes.
          </li>
          <li>
            <strong>Powerful search</strong>. Filter by date, user, resource, or
            any specific entry to find exactly what changed.
          </li>
          <li>
            <strong>Full history</strong>. Every event is stored with its
            complete payload for a reliable audit trail.
          </li>
        </ul>
      </div>
    </div>
  );
}
