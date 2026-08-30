const checkout = process.argv[2];

if (!checkout) {
	throw new Error("patched agent-teams checkout is required");
}

const blocker = {
	schemaVersion: 1,
	kind: "mypi-agent-teams-generated-profile-acceptance-blocker",
	status: "BLOCKED",
	reason: "generated-profile production acceptance requires a new real-provider setup/spawn/cleanup acceptance harness",
	checkout,
	productionActivated: false,
	nextRequiredEvidence: [
		"real provider spawn uses provisionAgentTeamsWorkerProfile and exact generated argv/environment",
		"readiness binds runtime contract, generated profile digest, lease ID, nonce, Worker, team, tools and source",
		"startup, stop, crash, replacement and retry cleanup leave no reusable Worker auth state",
	],
};

process.stderr.write(`${JSON.stringify(blocker, null, 2)}\n`);
process.exitCode = 78;
