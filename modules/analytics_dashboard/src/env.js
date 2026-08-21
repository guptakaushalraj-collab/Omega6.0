import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Loads this module's own .env, if present.
 *
 * Uses Node's built-in process.loadEnvFile (Node >= 20.12) so the module
 * gains no dependency — consistent with the registry rule that each module
 * stays independently liftable.
 *
 * Real environment variables always win: loadEnvFile does not overwrite
 * values already set in the process environment, so container/CI config
 * takes precedence over a stray local .env file.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, "..", ".env");

try {
  process.loadEnvFile(ENV_PATH);
} catch {
  // No .env file — expected in container deployments where the environment
  // is supplied directly. Defaults in each module cover local development.
}
