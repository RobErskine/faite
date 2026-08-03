import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({
  // No incremental cache override yet. The main loop renders from the client-side
  // local store (see plan: "Client renders only from a local store"), so there is
  // no ISR surface worth caching in R2 at P0. Revisit if marketing pages get ISR.
});
