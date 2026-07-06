/* eslint-disable react/prop-types */
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { actionLabel, resourceLabel } from "../utils/activity";

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const log = await db.activityLog.findFirst({
    where: { id: params.id, shop },
  });

  if (!log) {
    throw new Response("Not found", { status: 404 });
  }

  return {
    log: {
      id: log.id,
      topic: log.topic,
      resource: log.resource,
      action: log.action,
      resourceId: log.resourceId,
      title: log.title,
      summary: log.summary,
      actorName: log.actorName,
      actorEmail: log.actorEmail,
      actorId: log.actorId,
      sourceLabel: log.sourceLabel,
      webhookId: log.webhookId,
      occurredAt: log.occurredAt.toISOString(),
      createdAt: log.createdAt.toISOString(),
      payload: log.payload,
    },
  };
};

function Row({ label, value }) {
  return (
    <s-stack direction="inline" gap="base">
      <s-box minInlineSize="160px">
        <s-text color="subdued">{label}</s-text>
      </s-box>
      <s-text>{value ?? "—"}</s-text>
    </s-stack>
  );
}

export default function LogDetail() {
  const { log } = useLoaderData();

  return (
    <s-page heading={log.title || log.topic}>
      <s-link slot="breadcrumb-actions" href="/app">
        Dashboard
      </s-link>

      <s-section heading="Event details">
        <s-stack direction="block" gap="base">
          <Row label="Summary" value={log.summary} />
          <Row label="Resource" value={resourceLabel(log.resource)} />
          <Row label="Action" value={actionLabel(log.action)} />
          <Row label="Topic" value={log.topic} />
          <Row label="Resource ID" value={log.resourceId} />
          <Row label="User" value={log.actorName || log.actorEmail || "—"} />
          <Row label="User email" value={log.actorEmail || "—"} />
          <Row label="Source" value={log.sourceLabel || "—"} />
          <Row
            label="Occurred at"
            value={new Date(log.occurredAt).toLocaleString()}
          />
          <Row
            label="Recorded at"
            value={new Date(log.createdAt).toLocaleString()}
          />
          <Row label="Webhook ID" value={log.webhookId} />
        </s-stack>
      </s-section>

      <s-section heading="Raw payload">
        <s-box
          padding="base"
          borderWidth="base"
          borderRadius="base"
          background="subdued"
        >
          <pre style={{ margin: 0, overflowX: "auto" }}>
            <code>{JSON.stringify(log.payload, null, 2)}</code>
          </pre>
        </s-box>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
