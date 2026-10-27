import { loadServiceEnvironment } from "./service-environment.js";
import { runSync } from "./sync.js";

try {
  const environmentPath = process.argv[2];
  if (!environmentPath)
    throw new Error("A service environment path is required.");
  loadServiceEnvironment(environmentPath);
  await runSync({ scheduled: true });
} catch (error) {
  console.error(
    "❌",
    error instanceof Error ? error.message : "Scheduled sync failed",
  );
  process.exitCode = 1;
}
