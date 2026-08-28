import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isWorkerMode } from "./worker-mode.ts";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CHECK_TIMEOUT_MS = 10_000;
const SETUP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_FILE = resolve(tmpdir(), "my-pi", "dependency-updates.json");

export type DependencyUpdate = {
	name: string;
	current: string;
	wanted: string;
	latest: string;
};

type UpdateCache = {
	checkedAt: string;
	updates: DependencyUpdate[];
};

type CheckResult =
	| { status: "fresh-cache" }
	| { status: "offline" }
	| { status: "success"; updates: DependencyUpdate[] }
	| { status: "failed"; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseOutdatedOutput(stdout: string): DependencyUpdate[] {
	const trimmed = stdout.trim();
	if (!trimmed) return [];

	const parsed: unknown = JSON.parse(trimmed);
	if (!isRecord(parsed)) throw new Error("npm returned an unexpected response");

	const updates: DependencyUpdate[] = [];
	for (const [name, details] of Object.entries(parsed)) {
		if (!isRecord(details)) continue;
		const { current, wanted, latest } = details;
		if (
			typeof current !== "string" ||
			typeof wanted !== "string" ||
			typeof latest !== "string"
		) {
			continue;
		}
		updates.push({ name, current, wanted, latest });
	}

	return updates.sort((left, right) => left.name.localeCompare(right.name));
}

function isDependencyUpdate(value: unknown): value is DependencyUpdate {
	return (
		isRecord(value) &&
		typeof value.name === "string" &&
		typeof value.current === "string" &&
		typeof value.wanted === "string" &&
		typeof value.latest === "string"
	);
}

async function readCache(): Promise<UpdateCache | undefined> {
	try {
		const parsed: unknown = JSON.parse(await readFile(CACHE_FILE, "utf8"));
		if (
			!isRecord(parsed) ||
			typeof parsed.checkedAt !== "string" ||
			!Array.isArray(parsed.updates) ||
			!parsed.updates.every(isDependencyUpdate)
		) {
			return undefined;
		}
		return {
			checkedAt: parsed.checkedAt,
			updates: parsed.updates,
		};
	} catch {
		return undefined;
	}
}

async function writeCache(cache: UpdateCache): Promise<void> {
	await mkdir(dirname(CACHE_FILE), { recursive: true });
	const temporaryFile = `${CACHE_FILE}.${process.pid}.tmp`;
	await writeFile(temporaryFile, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
	await rename(temporaryFile, CACHE_FILE);
}

function cacheIsFresh(cache: UpdateCache | undefined, now = Date.now()): boolean {
	if (!cache) return false;
	const checkedAt = Date.parse(cache.checkedAt);
	return Number.isFinite(checkedAt) && now - checkedAt >= 0 && now - checkedAt < CHECK_INTERVAL_MS;
}

export function formatUpdateNotification(updates: DependencyUpdate[]): string {
	const lines = updates.map((update) => {
		if (update.current !== update.wanted) {
			const latest = update.wanted === update.latest ? "" : ` (latest: ${update.latest})`;
			return `• ${update.name}: ${update.current} → ${update.wanted}${latest}`;
		}
		return `• ${update.name}: ${update.current} (latest: ${update.latest}; version range blocks update)`;
	});

	const hasRangeBlockedUpdate = updates.some(
		(update) => update.current === update.wanted && update.current !== update.latest,
	);
	const guidance = hasRangeBlockedUpdate
		? "Run npm update in my-pi for compatible updates. Latest versions marked above require changing package.json; then /reload."
		: "Run npm update in my-pi, then /reload.";

	return `my-pi dependency updates available:\n${lines.join("\n")}\n${guidance}`;
}

async function checkForUpdates(
	pi: ExtensionAPI,
	force: boolean,
): Promise<CheckResult> {
	if (process.env.PI_OFFLINE) return { status: "offline" };

	const previousCache = await readCache();
	if (!force && cacheIsFresh(previousCache)) {
		return { status: "fresh-cache" };
	}

	const cacheAttempt = async () => {
		try {
			await writeCache({
				checkedAt: new Date().toISOString(),
				updates: previousCache?.updates ?? [],
			});
		} catch {
			// A cache failure must not make the startup check visible to the user.
		}
	};

	const result = await pi.exec("npm", ["outdated", "--json"], {
		cwd: SETUP_ROOT,
		timeout: CHECK_TIMEOUT_MS,
	});

	// npm outdated exits with 1 when it successfully finds outdated packages.
	if (result.killed) {
		await cacheAttempt();
		return { status: "failed", message: "npm update check timed out" };
	}
	if (result.code !== 0 && result.code !== 1) {
		await cacheAttempt();
		return {
			status: "failed",
			message: result.stderr.trim() || `npm exited with code ${result.code}`,
		};
	}

	let updates: DependencyUpdate[];
	try {
		updates = parseOutdatedOutput(result.stdout);
	} catch (error) {
		await cacheAttempt();
		return {
			status: "failed",
			message: error instanceof Error ? error.message : String(error),
		};
	}

	try {
		await writeCache({
			checkedAt: new Date().toISOString(),
			updates,
		});
	} catch {
		// The update result is still useful even if caching is unavailable.
	}
	return { status: "success", updates };
}

function notifyUpdates(ctx: ExtensionContext, updates: DependencyUpdate[]): void {
	if (updates.length > 0 && ctx.hasUI) {
		ctx.ui.notify(formatUpdateNotification(updates), "warning");
	}
}

export default function dependencyUpdateNotifier(pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI || isWorkerMode(pi)) return;

		// Deliberately do not return this promise: startup must not wait for npm.
		void checkForUpdates(pi, false)
			.then((result) => {
				if (result.status === "success") notifyUpdates(ctx, result.updates);
			})
			.catch(() => {
				// Startup checks are best-effort and should never interrupt the user.
			});
	});

	pi.registerCommand("mypi-updates", {
		description: "Check my-pi dependencies for updates now",
		handler: async (_args, ctx) => {
			const result = await checkForUpdates(pi, true);
			if (!ctx.hasUI) return;

			if (result.status === "offline") {
				ctx.ui.notify("Dependency update check is disabled in offline mode.", "warning");
			} else if (result.status === "failed") {
				ctx.ui.notify(`Could not check my-pi dependencies: ${result.message}`, "error");
			} else if (result.status === "success" && result.updates.length === 0) {
				ctx.ui.notify("my-pi dependencies are up to date.", "info");
			} else if (result.status === "success") {
				notifyUpdates(ctx, result.updates);
			}
		},
	});
}
