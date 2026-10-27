/* global console */
// Usage: npm run zetaris:setup              (dry run: prints the plan, credentials masked)
//        npm run zetaris:setup -- --apply   (creates the datasource, views, and USL in Zetaris)
//        add --from <n> to resume at statement n after fixing a failure.
// Registers Flusso's Neon database in Zetaris as a JDBC datasource, creates the datasource views,
// and deploys and activates the brand_evidence unified semantic layer the reasoning agent queries.
import process from "node:process";
import { jdbcFromDatabaseUrl, setupStatements } from "../lib/agent/zetaris-catalog.ts";
import { createTracer, jsonlSink } from "../lib/agent/trace.ts";
import { createZetarisRunner, zetarisConfigFromEnv } from "../lib/agent/zetaris.ts";

const apply = process.argv.includes("--apply");
const fromIndex = process.argv.indexOf("--from");
const startAt = fromIndex > 0 ? Number(process.argv[fromIndex + 1]) : 1;

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error("DATABASE_URL is missing. Add it to .env.local.");
  process.exit(64);
}
const connection = jdbcFromDatabaseUrl(databaseUrl);
const statements = setupStatements(connection);
const masked = setupStatements({ ...connection, username: "<DATABASE_URL user>", password: "<DATABASE_URL password>" });

if (!apply) {
  masked.forEach((statement, index) => console.log("-- [" + (index + 1) + "]\n" + statement + "\n"));
  console.log("Dry run only. Re-run with --apply to create these objects in Zetaris.");
  process.exit(0);
}

const config = zetarisConfigFromEnv();
if (!config) {
  console.error("ZETARIS_REST_URL and ZETARIS_API_KEY are required in .env.local.");
  process.exit(64);
}
const tracer = createTracer("zetaris-setup-" + new Date().toISOString(), [jsonlSink("logs")]);
const run = createZetarisRunner(config, tracer);

for (let index = startAt - 1; index < statements.length; index += 1) {
  const label = masked[index].split("\n")[0].slice(0, 110);
  try {
    const result = await run(statements[index], { purpose: "setup", limit: 10, traceSql: masked[index] });
    // The audit log keeps the masked statement, never the credentials.
    tracer.write("audit", "zetaris", "object.created", { step: index + 1, statement: masked[index], rows: result.rows.length });
    console.log("[" + (index + 1) + "/" + statements.length + "] ok  " + label);
  } catch (error) {
    console.error("[" + (index + 1) + "/" + statements.length + "] failed  " + label);
    console.error(error instanceof Error ? error.message : String(error));
    console.error("Fix the cause, then resume with: npm run zetaris:setup -- --apply --from " + (index + 1));
    process.exit(1);
  }
}
console.log("Zetaris is set up. Try: npm run agent:sample -- --live");
