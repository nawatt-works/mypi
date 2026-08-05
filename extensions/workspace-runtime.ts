import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const RUNTIME_ENV_NAMES = ["TMPDIR", "TMP", "TEMP"] as const;

export function workspaceTemporaryDirectory(cwd: string): string {
	return resolve(cwd, ".runtime", "tmp");
}

export function configureWorkspaceRuntime(
	cwd: string,
	environment: NodeJS.ProcessEnv = process.env,
): string {
	const temporaryDirectory = workspaceTemporaryDirectory(cwd);
	mkdirSync(temporaryDirectory, { recursive: true, mode: 0o700 });
	for (const name of RUNTIME_ENV_NAMES) environment[name] = temporaryDirectory;
	return temporaryDirectory;
}

function notifyFailure(ctx: ExtensionContext, error: unknown): void {
	if (!ctx.hasUI) return;
	ctx.ui.notify(
		`my-pi could not configure .runtime/tmp: ${error instanceof Error ? error.message : String(error)}`,
		"warning",
	);
}

/** Point Pi and child processes at a temporary directory owned by the workspace. */
export default function workspaceRuntime(pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		try {
			configureWorkspaceRuntime(ctx.cwd);
		} catch (error) {
			notifyFailure(ctx, error);
		}
	});
}
