/* global AbortSignal, console, fetch */
import process from "node:process";
import { URL } from "node:url";

const engineUrl = process.env.FLUSSO_ENGINE_URL?.trim() || "http://127.0.0.1:3107";
const endpoint = new URL("/api/health", engineUrl);

const response = await fetch(endpoint, { signal: AbortSignal.timeout(10_000) });
let payload;
try {
  payload = JSON.parse(await response.text());
} catch {
  throw new Error("The health endpoint did not return JSON (HTTP " + response.status + ").");
}

if (!response.ok || payload?.status !== "ready") {
  throw new Error(
    "Flusso is not ready (HTTP " + response.status + "): " +
      JSON.stringify(payload?.error ?? payload?.checks ?? null)
  );
}

console.log(JSON.stringify({ status: "ready", engine: endpoint.origin, checks: payload.checks }, null, 2));
