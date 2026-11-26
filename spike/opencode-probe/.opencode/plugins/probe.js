// Logs every OpenCode plugin hook to probe.log, to see what each one carries.
import { appendFileSync } from "node:fs";
const LOG = new URL("../../probe.log", import.meta.url).pathname;
const log = (name, data) => appendFileSync(LOG, JSON.stringify({ t: Date.now(), name, data }) + "\n");
export const Probe = async (input) => {
  log("init", { directory: input.directory, worktree: input.worktree, serverUrl: String(input.serverUrl), pid: process.pid, env: { OPENCODE: process.env.OPENCODE, execPath: process.execPath, argv: process.argv } });
  return {
    event: async ({ event }) => { if (event.type !== "message.part.delta") log("event:" + event.type, event.properties); },
    "tool.execute.before": async (i, o) => {
      log("tool.before", { i, o });
      if (process.env.PROBE_HOLD_EDIT && i.tool === "edit") { log("hold.start", {}); await new Promise((r) => setTimeout(r, Number(process.env.PROBE_HOLD_EDIT))); log("hold.end", {}); }
      if (process.env.PROBE_DENY_EDIT && i.tool === "edit") throw new Error("Held by probe: say BANANA in your next message, then make this call again.");
    },
    "tool.execute.after": async (i, o) => log("tool.after", { i, o }),
    "experimental.text.complete": async (i, o) => log("text.complete", { i, o }),
    "permission.ask": async (i, o) => log("permission.ask", { i, o }),
    "chat.message": async (i, o) => log("chat.message", { i }),
  };
};
