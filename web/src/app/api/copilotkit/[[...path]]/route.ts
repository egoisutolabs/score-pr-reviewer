import { CopilotRuntime, createCopilotEndpoint } from "@copilotkit/runtime/v2";
import { LangGraphHttpAgent } from "@copilotkit/runtime/langgraph";
import { handle } from "hono/vercel";

// The v2 runtime: it answers the client's GET /info identification probe and
// streams agent runs itself, so no GraphQL layer and no "runtime did not
// answer" noise. One agent, proxied to the Python AG-UI server.
const runtime = new CopilotRuntime({
  agents: {
    pr_reviewer: new LangGraphHttpAgent({
      url: process.env.AGENT_URL ?? "http://localhost:8123",
    }),
  },
});

// Optional catch-all segment: the endpoint mounts /info, /agent/<id>/run and
// friends under the base path, which a plain route.ts could not match.
const app = createCopilotEndpoint({ runtime, basePath: "/api/copilotkit" });
const hono = handle(app);

// Every subscribing hook opens its own long-lived `connect` stream to join the
// active run, and with a run in flight that exceeds a browser's six HTTP/1.1
// connections per host, so the client's periodic GET /info probe queues,
// times out, and reports the runtime unreachable. The run's own stream already
// carries every event this single-tab app needs, and 204 is the protocol's
// "nothing to join" answer, so joins are declined rather than held open.
const handler = (req: Request) =>
  req.method === "POST" && new URL(req.url).pathname.endsWith("/connect")
    ? Promise.resolve(new Response(null, { status: 204 }))
    : hono(req);

export const GET = hono;
export const POST = handler;
export const OPTIONS = hono;
