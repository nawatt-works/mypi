import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const WORKER_ENV = "MYPI_WORKER";

/**
 * Tools that block on a human at the terminal. A Coordinator-spawned Worker has
 * nobody watching its pane, so anything that opens a browser or waits for a
 * local answer must stay out of its tool list.
 */
const INTERACTIVE_TOOLS = ["plannotator_submit_plan"];

/**
 * Worker mode marks a Pi session that was started by a Coordinator rather than
 * by the user. The Coordinator exports `MYPI_WORKER=1` into the target pane's
 * shell before `herdr agent start`, so the worker inherits it.
 *
 * The signal is an environment variable rather than a CLI flag because Pi
 * refuses to let two extensions register the same flag, scopes `getFlag` to the
 * registering extension, and loads every extension with its own module graph.
 * That leaves no way to share a flag value; the environment is already shared.
 *
 * The same global package serves both kinds of session, so extensions that take
 * over input or ask the user something have to know which one they are in.
 * Guardrails deliberately keep asking: those prompts are bridged to
 * `herdr:blocked` and the Coordinator surfaces them, so approval stays with the
 * user.
 */
export function isWorkerMode(env: NodeJS.ProcessEnv = process.env): boolean {
	return env[WORKER_ENV]?.trim() === "1";
}

export default function workerMode(pi: ExtensionAPI): void {
	pi.registerCommand("mypi-worker-status", {
		description: "Show whether this session is running as a Coordinator-managed worker",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;
			ctx.ui.notify(
				isWorkerMode()
					? "Worker mode is active: steering choice, Plannotator review and startup update checks are disabled."
					: "Worker mode is off: this is a normal interactive session.",
				"info",
			);
		},
	});

	pi.on("session_start", () => {
		if (!isWorkerMode()) return;
		const active = pi.getActiveTools();
		const filtered = active.filter((name) => !INTERACTIVE_TOOLS.includes(name));
		if (filtered.length !== active.length) pi.setActiveTools(filtered);
	});
}
