import { writeFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function smokeResourceProbe(pi: ExtensionAPI): void {
	pi.on("session_start", () => {
		const output = process.env.MYPI_SMOKE_RESOURCE_OUTPUT;
		if (!output) throw new Error("MYPI_SMOKE_RESOURCE_OUTPUT is required");
		writeFileSync(output, `${JSON.stringify({ tools: pi.getAllTools().map((tool) => tool.name).sort() })}\n`, "utf8");
	});
}
