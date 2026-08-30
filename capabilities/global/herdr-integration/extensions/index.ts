import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isHerdrSession, runHerdr, withHerdrBlocked } from "./client.ts";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CHECK_TIMEOUT_MS = 10_000;
const SETUP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_FILE = resolve(tmpdir(), "my-pi", "herdr-integration.json");

export type HerdrIntegrationState = "current" | "missing" | "outdated" | "unavailable" | "unknown";

export type HerdrIntegrationStatus = {
	state: HerdrIntegrationState;
	detail?: string;
};

type StatusCache = HerdrIntegrationStatus & { checkedAt: string };

export function parseHerdrIntegrationStatus(output: string): HerdrIntegrationStatus {
	const line = output
		.split(/\r?\n/)
		.map((candidate) => candidate.trim())
		.find((candidate) => candidate.toLowerCase().startsWith("pi:"));
	if (!line) return { state: "unknown", detail: output.trim() || undefined };

	const normalized = line.toLowerCase();
	if (normalized.includes("not installed")) return { state: "missing", detail: line };
	if (normalized.includes("outdated")) return { state: "outdated", detail: line };
	if (normalized.includes("current")) return { state: "current", detail: line };
	return { state: "unknown", detail: line };
}

export function herdrIntegrationPath(environment: NodeJS.ProcessEnv = process.env): string {
	const agentDirectory = environment.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
	return resolve(agentDirectory, "extensions", "herdr-agent-state.ts");
}

async function readCache(): Promise<StatusCache | undefined> {
	try {
		const parsed = JSON.parse(await readFile(CACHE_FILE, "utf8")) as Partial<StatusCache>;
		if (
			typeof parsed.checkedAt !== "string" ||
			!parsed.state ||
			!["current", "missing", "outdated", "unavailable", "unknown"].includes(parsed.state)
		) return undefined;
		return parsed as StatusCache;
	} catch {
		return undefined;
	}
}

async function writeCache(status: HerdrIntegrationStatus): Promise<void> {
	await mkdir(dirname(CACHE_FILE), { recursive: true });
	const temporaryFile = `${CACHE_FILE}.${process.pid}.tmp`;
	await writeFile(temporaryFile, `${JSON.stringify({ ...status, checkedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
	await rename(temporaryFile, CACHE_FILE);
}

function cacheIsFresh(cache: StatusCache | undefined): boolean {
	if (!cache) return false;
	const checkedAt = Date.parse(cache.checkedAt);
	return Number.isFinite(checkedAt) && Date.now() - checkedAt >= 0 && Date.now() - checkedAt < CHECK_INTERVAL_MS;
}

async function queryIntegrationStatus(pi: ExtensionAPI): Promise<HerdrIntegrationStatus> {
	const result = await runHerdr(pi, ["integration", "status"], {
		cwd: SETUP_ROOT,
		timeout: CHECK_TIMEOUT_MS,
	});
	if (result.killed) return { state: "unavailable", detail: "Herdr integration status timed out" };
	if (!result.ok) {
		return {
			state: "unavailable",
			detail: result.output || `herdr exited with code ${result.code}`,
		};
	}
	return parseHerdrIntegrationStatus(result.output);
}

function statusMessage(status: HerdrIntegrationStatus): { message: string; type: "info" | "warning" | "error" } {
	if (status.state === "current") {
		return { message: `Herdr Pi integration is current.${status.detail ? `\n${status.detail}` : ""}`, type: "info" };
	}
	if (status.state === "missing") {
		return {
			message: "Herdr Pi integration is not installed. Run /mypi-herdr-setup to install the official integration.",
			type: "warning",
		};
	}
	if (status.state === "outdated") {
		return {
			message: `Herdr Pi integration is outdated. Run /mypi-herdr-setup to update it.${status.detail ? `\n${status.detail}` : ""}`,
			type: "warning",
		};
	}
	return {
		message: `Could not determine Herdr Pi integration status.${status.detail ? `\n${status.detail}` : ""}`,
		type: status.state === "unavailable" ? "error" : "warning",
	};
}

function notifyStatus(ctx: ExtensionContext, status: HerdrIntegrationStatus): void {
	const notification = statusMessage(status);
	ctx.ui.notify(notification.message, notification.type);
}

export default function herdrIntegration(pi: ExtensionAPI) {
	// RPIV owns this package-specific event; my-pi maps it to the stable event
	// consumed by Herdr's official Pi lifecycle reporter.
	pi.events.on("rpiv:ask-user:blocked", (data: unknown) => {
		const active = (data as { active?: unknown } | null)?.active;
		if (typeof active === "boolean") {
			pi.events.emit("herdr:blocked", {
				active,
				...(active ? { label: "Waiting for user input" } : {}),
			});
		}
	});

	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI || !isHerdrSession()) return;

		void (async () => {
			const cache = await readCache();
			if (cacheIsFresh(cache)) return;
			const status = await queryIntegrationStatus(pi);
			try {
				await writeCache(status);
			} catch {
				// Status is still useful when the best-effort cache cannot be written.
			}
			if (status.state !== "current") notifyStatus(ctx, status);
		})().catch(() => {
			// Startup checks must never interrupt the session.
		});
	});

	pi.registerCommand("mypi-herdr-status", {
		description: "ตรวจสถานะ official Herdr Pi integration",
		handler: async (_args, ctx) => {
			const status = await queryIntegrationStatus(pi);
			try {
				await writeCache(status);
			} catch {
				// Do not hide the live status when caching fails.
			}
			if (ctx.hasUI) notifyStatus(ctx, status);
		},
	});

	pi.registerCommand("mypi-herdr-setup", {
		description: "ติดตั้งหรืออัปเดต official Herdr Pi integration หลังยืนยัน",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;

			const before = await queryIntegrationStatus(pi);
			if (before.state === "unavailable") {
				notifyStatus(ctx, before);
				return;
			}
			if (before.state === "current") {
				notifyStatus(ctx, before);
				return;
			}

			const targetPath = herdrIntegrationPath();
			const approved = await withHerdrBlocked(pi.events, "Herdr integration setup approval", () =>
				ctx.ui.confirm(
					"ติดตั้ง Herdr Pi integration?",
					`Herdr จะเขียน official integration ไปที่:\n${targetPath}\n\nคำสั่ง: herdr integration install pi`,
				),
			);
			if (!approved) {
				ctx.ui.notify("ยกเลิกการติดตั้ง Herdr Pi integration", "info");
				return;
			}

			const result = await runHerdr(pi, ["integration", "install", "pi"], {
				cwd: SETUP_ROOT,
				timeout: CHECK_TIMEOUT_MS,
			});
			if (!result.ok) {
				ctx.ui.notify(
					`ติดตั้ง Herdr Pi integration ไม่สำเร็จ${result.output ? `\n${result.output}` : ""}`,
					"error",
				);
				return;
			}

			const after = await queryIntegrationStatus(pi);
			try {
				await writeCache(after);
			} catch {
				// Installation result remains authoritative.
			}
			if (after.state !== "current") {
				notifyStatus(ctx, after);
				return;
			}

			ctx.ui.notify("ติดตั้ง official Herdr Pi integration แล้ว กำลัง reload Pi resources", "info");
			await ctx.reload();
			return;
		},
	});
}
