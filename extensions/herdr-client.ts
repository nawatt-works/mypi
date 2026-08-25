import type { ExecOptions, ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DEFAULT_TIMEOUT_MS = 10_000;

type ExecHost = Pick<ExtensionAPI, "exec">;

type EventBus = {
	emit(channel: string, data: unknown): void;
};

/**
 * Herdr answers most control commands with a single JSON envelope: either
 * `{ id, result }` or `{ id, error: { code, message } }`. Identifiers and state
 * are read from that payload rather than predicted.
 */
export type HerdrError = {
	code: string;
	message: string;
};

export type HerdrResult = {
	ok: boolean;
	code: number | null;
	killed: boolean;
	/** stdout and stderr joined and trimmed, for messages and text-mode commands. */
	output: string;
	stdout: string;
	stderr: string;
	/** The `result` payload when the command answered with a JSON envelope. */
	result?: unknown;
	/** The `error` payload when Herdr rejected the command. */
	error?: HerdrError;
};

export function herdrExecutable(environment: NodeJS.ProcessEnv = process.env): string {
	return environment.HERDR_BIN_PATH?.trim() || "herdr";
}

/**
 * Herdr control commands act on the session that owns this process. Anything
 * that inspects or drives panes must confirm this first: outside Herdr the CLI
 * would target whatever session happens to be focused.
 */
export function isHerdrSession(environment: NodeJS.ProcessEnv = process.env): boolean {
	return environment.HERDR_ENV === "1";
}

export type HerdrCallerContext = {
	workspaceId?: string;
	tabId?: string;
	paneId?: string;
};

/** The IDs Herdr injects into every managed pane, for targeting the caller. */
export function herdrCallerContext(environment: NodeJS.ProcessEnv = process.env): HerdrCallerContext {
	const read = (name: string) => {
		const value = environment[name]?.trim();
		return value ? value : undefined;
	};
	return {
		workspaceId: read("HERDR_WORKSPACE_ID"),
		tabId: read("HERDR_TAB_ID"),
		paneId: read("HERDR_PANE_ID"),
	};
}

function parseEnvelope(stream: string): Pick<HerdrResult, "result" | "error"> | undefined {
	const trimmed = stream.trim();
	if (!trimmed.startsWith("{")) return undefined;
	try {
		const parsed = JSON.parse(trimmed) as { result?: unknown; error?: unknown };
		const error = parsed.error as Partial<HerdrError> | undefined;
		if (error && typeof error.code === "string") {
			return { error: { code: error.code, message: String(error.message ?? "") } };
		}
		if ("result" in parsed) return { result: parsed.result };
		return undefined;
	} catch {
		// Not every command answers with JSON; callers fall back to `output`.
		return undefined;
	}
}

/**
 * Run one Herdr CLI command and report both the process outcome and the JSON
 * envelope. A rejected command still resolves: a Coordinator has to tell
 * `agent_prompt_stalled` from a timeout from a crash, so failures are values.
 */
export async function runHerdr(
	host: ExecHost,
	args: string[],
	options: ExecOptions & { environment?: NodeJS.ProcessEnv } = {},
): Promise<HerdrResult> {
	const { environment = process.env, ...execOptions } = options;
	try {
		const result = await host.exec(herdrExecutable(environment), args, {
			timeout: DEFAULT_TIMEOUT_MS,
			...execOptions,
		});
		const stdout = result.stdout ?? "";
		const stderr = result.stderr ?? "";
		// Herdr prints rejections as a JSON envelope on stderr and results on stdout.
		const envelope = parseEnvelope(stdout) ?? parseEnvelope(stderr) ?? {};
		return {
			ok: !result.killed && result.code === 0 && !envelope.error,
			code: result.code,
			killed: result.killed === true,
			output: [stdout, stderr].filter(Boolean).join("\n").trim(),
			stdout,
			stderr,
			...envelope,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			ok: false,
			code: null,
			killed: false,
			output: message,
			stdout: "",
			stderr: message,
			error: { code: "herdr_unavailable", message },
		};
	}
}

/**
 * Mark the session blocked while `operation` waits for the user, so Herdr shows
 * the pane as blocked and a Coordinator watching it can surface the request.
 * The paired event fires even when the dialog throws.
 */
export async function withHerdrBlocked<T>(
	events: EventBus,
	label: string,
	operation: () => Promise<T>,
): Promise<T> {
	events.emit("herdr:blocked", { active: true, label });
	try {
		return await operation();
	} finally {
		events.emit("herdr:blocked", { active: false });
	}
}
