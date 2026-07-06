/* eslint-disable react/prop-types */
import { useState } from "react";
import { useActionData, useLoaderData, useNavigation, useSubmit } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { sendSupportEmail } from "../utils/email.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return { shop: session.shop };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop; // trusted server-side value, never from the form

  const form = await request.formData();
  const name = String(form.get("name") || "").trim();
  const email = String(form.get("email") || "").trim();
  const message = String(form.get("message") || "").trim();

  const errors = {};
  if (!name) errors.name = "Please enter your name.";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    errors.email = "Please enter a valid email address.";
  if (!message) errors.message = "Please enter a message.";

  if (Object.keys(errors).length) {
    return { ok: false, errors };
  }

  const result = await sendSupportEmail({ name, email, message, shop });
  if (!result.ok) {
    return { ok: false, formError: result.error };
  }
  return { ok: true };
};

export default function Support() {
  const { shop } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const submit = useSubmit();
  const isSubmitting = navigation.state === "submitting";

  const [values, setValues] = useState({ name: "", email: "", message: "" });
  const setField = (name) => (event) => {
    const v = event?.currentTarget?.value ?? event?.target?.value ?? "";
    setValues((s) => ({ ...s, [name]: v }));
  };

  const handleSubmit = () => {
    const fd = new FormData();
    fd.set("name", values.name);
    fd.set("email", values.email);
    fd.set("message", values.message);
    submit(fd, { method: "post" });
  };

  const errors = actionData?.errors || {};

  return (
    <s-page heading="Support">
      <s-section>
        <div
          style={{
            fontSize: "22px",
            fontWeight: 700,
            letterSpacing: "-0.01em",
            marginBottom: "6px",
          }}
        >
          Contact us
        </div>
        <s-paragraph color="subdued">
          Have a question or need help? Send us a message and we&apos;ll get back
          to you by email.
        </s-paragraph>
        <s-box paddingBlockStart="base"></s-box>


        {actionData?.ok ? (
          <s-banner tone="success" heading="Message sent">
            Thanks! Your message has been sent. We&apos;ll reply to your email
            soon.
          </s-banner>
        ) : null}

        {actionData?.formError ? (
          <s-banner tone="critical" heading="Something went wrong">
            {actionData.formError}
          </s-banner>
        ) : null}

        <s-stack direction="block" gap="base">
          <s-grid gridTemplateColumns="1fr 1fr" gap="base">
            <s-text-field
              label="Name"
              name="name"
              value={values.name}
              error={errors.name || undefined}
              onInput={setField("name")}
              onChange={setField("name")}
            ></s-text-field>

            <s-email-field
              label="Email"
              name="email"
              value={values.email}
              placeholder="you@example.com"
              error={errors.email || undefined}
              onInput={setField("email")}
              onChange={setField("email")}
            ></s-email-field>
          </s-grid>

          <s-text-field
            label="Store domain"
            name="shop-display"
            value={shop}
            disabled
          ></s-text-field>

          <s-text-area
            label="Message"
            name="message"
            rows={10}
            value={values.message}
            placeholder="How can we help?"
            error={errors.message || undefined}
            onInput={setField("message")}
            onChange={setField("message")}
          ></s-text-area>

          <s-stack direction="inline" gap="base">
            <s-button
              variant="primary"
              onClick={handleSubmit}
              {...(isSubmitting ? { loading: true } : {})}
            >
              Send message
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
