import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = mkdtempSync(join(tmpdir(), "mypi-capability-install-"));
const releaseRoot = join(temporaryRoot, "release");
const agentRoot = join(temporaryRoot, "agent");
const optInAgentRoot = join(temporaryRoot, "agent-opt-in");
const resourceOutput = join(temporaryRoot, "stable-resources.json");
const excluded = new Set([".git", "node_modules", ".npm-cache", ".DS_Store"]);

function run(command, args, options = {}) {
	const result = spawnSync(command, args, { encoding: "utf8", ...options });
	if (result.error || result.status !== 0) {
		throw new Error(`${command} ${args.join(" ")} failed\n${result.stderr || result.stdout}`, { cause: result.error });
	}
	return result;
}

try {
	cpSync(ROOT, releaseRoot, {
		recursive: true,
		filter(source) {
			return !excluded.has(basename(source));
		},
	});
	run("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: releaseRoot });
	// Pi's extension loader must provide host-owned core modules. Removing npm's
	// auto-installed peer copies proves the adapters do not depend on release-local Pi cores.
	for (const modulePath of [
		["@earendil-works", "pi-coding-agent"],
		["@earendil-works", "pi-agent-core"],
		["@earendil-works", "pi-ai"],
		["@earendil-works", "pi-tui"],
		["typebox"],
	]) rmSync(join(releaseRoot, "node_modules", ...modulePath), { recursive: true, force: true });
	const environment = {
		...process.env,
		PI_CODING_AGENT_DIR: agentRoot,
		PI_OFFLINE: "1",
		MYPI_SMOKE_RESOURCE_OUTPUT: resourceOutput,
	};
	run("pi", ["install", releaseRoot], { env: environment });
	const listed = run("pi", ["list"], { env: environment });
	if (!listed.stdout.includes(releaseRoot)) throw new Error("isolated Pi profile did not list the installed aggregate package");

	const rpc = run("pi", [
		"--mode", "rpc", "--no-session",
		"-e", join(releaseRoot, "scripts", "smoke-resource-probe.ts"),
	], {
		env: environment,
		input: '{"type":"get_state"}\n{"type":"get_commands"}\n',
	});
	const messages = rpc.stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line));
	if (!messages.some((message) => message.type === "response" && message.command === "get_state" && message.success === true)) {
		throw new Error("stable aggregate RPC session did not reach get_state");
	}
	const commandsResponse = messages.find((message) => message.type === "response" && message.command === "get_commands" && message.success === true);
	if (!commandsResponse) throw new Error("stable aggregate RPC session did not return commands");
	const commandList = (commandsResponse.data?.commands ?? []).map((command) => command.name);
	const commandNames = new Set(commandList);
	if (commandNames.size !== commandList.length) throw new Error("stable aggregate registered a duplicate command name");
	for (const required of [
		"mypi-worker-status", "mypi-updates", "mypi-herdr-status", "mypi-herdr-setup", "mypi-continuity",
		"plannotator-plan-mode", "plannotator-review",
		"mcp", "pi-mcp", "mcp-auth", "chrome-devtools", "skill:mcp-scripting", "skill:dependency-update-assessment",
	]) {
		if (!commandNames.has(required)) throw new Error(`stable aggregate command is missing: ${required}`);
	}
	for (const forbidden of ["mypi-orchestrate", "mypi-orchestrate-status", "mypi-orchestrate-cleanup", "mypi-azure-devops-config"]) {
		if (commandNames.has(forbidden)) throw new Error(`non-global command leaked into stable aggregate: ${forbidden}`);
	}
	const observedToolList = JSON.parse(readFileSync(resourceOutput, "utf8")).tools ?? [];
	const observedTools = new Set(observedToolList);
	if (observedTools.size !== observedToolList.length) throw new Error("stable aggregate registered a duplicate tool name");
	const requiredStableTools = [
		"ask_user_question", "plannotator_submit_plan",
		"mcp", "mcpScript",
		"web_search", "source_check", "fetch_content", "get_search_content",
		"chrome_devtools_load",
	];
	for (const required of requiredStableTools) {
		if (!observedTools.has(required)) throw new Error(`stable aggregate tool is missing: ${required}`);
	}
	for (const forbidden of ["mypi_preview_worker", "mypi_spawn_worker", "azure_boards_doctor"]) {
		if (observedTools.has(forbidden)) throw new Error(`non-global tool leaked into stable aggregate: ${forbidden}`);
	}

	const optInEnvironment = { ...environment, PI_CODING_AGENT_DIR: optInAgentRoot };
	const azurePackage = join(releaseRoot, "capabilities", "project-opt-in", "azure-devops");
	run("pi", ["install", azurePackage], { env: optInEnvironment });
	const optInRpc = run("pi", ["--mode", "rpc", "--no-session"], {
		env: optInEnvironment,
		input: '{"type":"get_commands"}\n',
	});
	const optInMessages = optInRpc.stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line));
	const optInCommands = optInMessages.find((message) => message.type === "response" && message.command === "get_commands" && message.success === true);
	if (!(optInCommands?.data?.commands ?? []).some((command) => command.name === "mypi-azure-devops-config")) {
		throw new Error("Azure DevOps package did not load when explicitly installed");
	}

	console.log(JSON.stringify({
		cleanInstall: true,
		rpcSessionStart: true,
		stableCommands: [...commandNames].filter((name) => name.startsWith("mypi-")).sort(),
		thirdPartyCommands: ["mcp", "pi-mcp", "mcp-auth", "chrome-devtools", "skill:mcp-scripting"],
		stableSkills: ["skill:mcp-scripting", "skill:dependency-update-assessment"],
		stableAdapterTools: requiredStableTools,
		projectOptInPackage: "azure-devops",
	}));
} finally {
	rmSync(temporaryRoot, { recursive: true, force: true });
}
