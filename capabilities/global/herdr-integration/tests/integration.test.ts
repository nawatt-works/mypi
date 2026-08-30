import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import herdrIntegration, {
	herdrIntegrationPath,
	parseHerdrIntegrationStatus,
} from "../extensions/index.ts";
import { withHerdrBlocked } from "../extensions/client.ts";

test("parses official Herdr Pi integration states", () => {
	assert.equal(parseHerdrIntegrationStatus("pi: current (v2)").state, "current");
	assert.equal(parseHerdrIntegrationStatus("pi: not installed (/x/herdr-agent-state.ts)").state, "missing");
	assert.equal(parseHerdrIntegrationStatus("pi: outdated (v1 -> v2)").state, "outdated");
	assert.equal(parseHerdrIntegrationStatus("claude: current").state, "unknown");
});

test("resolves the installer-owned path from PI_CODING_AGENT_DIR", () => {
	assert.equal(
		herdrIntegrationPath({ PI_CODING_AGENT_DIR: "/custom/pi-agent" }),
		resolve("/custom/pi-agent/extensions/herdr-agent-state.ts"),
	);
	assert.equal(
		herdrIntegrationPath({ HOME: "/ignored" }),
		join(homedir(), ".pi", "agent", "extensions", "herdr-agent-state.ts"),
	);
});

test("pairs Herdr blocked events even when a dialog fails", async () => {
	const emitted: Array<{ channel: string; data: unknown }> = [];
	const events = {
		emit(channel: string, data: unknown) {
			emitted.push({ channel, data });
		},
	};

	await assert.rejects(
		withHerdrBlocked(events, "Permission", async () => {
			throw new Error("dialog failed");
		}),
		/dialog failed/,
	);
	assert.deepEqual(emitted, [
		{ channel: "herdr:blocked", data: { active: true, label: "Permission" } },
		{ channel: "herdr:blocked", data: { active: false } },
	]);
});

test("bridges RPIV user-input state to Herdr's official blocked event", () => {
	const eventHandlers = new Map<string, (data: unknown) => void>();
	const emitted: Array<{ channel: string; data: unknown }> = [];
	const pi = {
		events: {
			on(channel: string, handler: (data: unknown) => void) {
				eventHandlers.set(channel, handler);
			},
			emit(channel: string, data: unknown) {
				emitted.push({ channel, data });
			},
		},
		on() {},
		registerCommand() {},
	};

	herdrIntegration(pi as any);
	eventHandlers.get("rpiv:ask-user:blocked")?.({ active: true });
	eventHandlers.get("rpiv:ask-user:blocked")?.({ active: false });

	assert.deepEqual(emitted, [
		{ channel: "herdr:blocked", data: { active: true, label: "Waiting for user input" } },
		{ channel: "herdr:blocked", data: { active: false } },
	]);
});
