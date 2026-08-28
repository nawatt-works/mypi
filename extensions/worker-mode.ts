import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * A Coordinator names a Worker's session with this prefix. Pi applies `--name`
 * atomically at startup and every extension can read it back through
 * `getSessionName`, unlike a CLI flag, whose value only the registering
 * extension can see.
 */
export const WORKER_SESSION_PREFIX = "mypi-worker:";

/** Escape hatch for running a session as a worker by hand. */
export const WORKER_ENV = "MYPI_WORKER";

/**
 * Tools that block on a human at the terminal. A Coordinator-spawned Worker has
 * nobody watching its pane, so anything that opens a browser or waits for a
 * local answer must stay out of its tool list.
 */
const INTERACTIVE_TOOLS = ["plannotator_submit_plan"];

/** The session name a Coordinator gives a Worker it spawns. */
export function workerSessionName(worker: string): string {
	return `${WORKER_SESSION_PREFIX}${worker}`;
}

/**
 * Worker mode marks a Pi session that was started by a Coordinator rather than
 * by the user.
 *
 * The signal travels in the session name because that is set by a flag on the
 * command line, so it cannot be lost the way text typed into a pane's shell
 * can, and Herdr surfaces it in the terminal title, so the Coordinator can
 * verify from outside that the Worker really started in this mode.
 *
 * The same global package serves both kinds of session, so extensions that take
 * over input or ask the user something have to know which one they are in.
 * Guardrails deliberately keep asking: those prompts are bridged to
 * `herdr:blocked` and the Coordinator surfaces them, so approval stays with the
 * user.
 */
export function isWorkerMode(
	pi: Pick<ExtensionAPI, "getSessionName">,
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	if (env[WORKER_ENV]?.trim() === "1") return true;
	if (typeof pi?.getSessionName !== "function") return false;
	return pi.getSessionName()?.startsWith(WORKER_SESSION_PREFIX) === true;
}

export default function workerMode(pi: ExtensionAPI): void {
	pi.registerCommand("mypi-worker-status", {
		description: "Show whether this session is running as a Coordinator-managed worker",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;
			ctx.ui.notify(
				isWorkerMode(pi)
					? `Worker mode is active (${pi.getSessionName() ?? WORKER_ENV}): steering choice, Plannotator review and startup update checks are disabled.`
					: "Worker mode is off: this is a normal interactive session.",
				"info",
			);
		},
	});

	pi.on("session_start", () => {
		if (!isWorkerMode(pi)) return;
		const active = pi.getActiveTools();
		const filtered = active.filter((name) => !INTERACTIVE_TOOLS.includes(name));
		if (filtered.length !== active.length) pi.setActiveTools(filtered);
	});
}
