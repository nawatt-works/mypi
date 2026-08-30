import { lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export type WorkspaceAuthoritySource = "explicit" | "git-root" | "launch-cwd";

export type WorkspaceAuthority = Readonly<{
	workspaceRoot: string;
	launchCwd: string;
	source: WorkspaceAuthoritySource;
}>;

function isWithin(path: string, root: string): boolean {
	const offset = relative(root, path);
	return offset === "" || (offset !== ".." && !offset.startsWith(`..${sep}`) && !isAbsolute(offset));
}

function canonicalDirectory(path: string, label: string): string {
	if (!isAbsolute(path)) throw new Error(`${label} must be an absolute path`);
	const canonical = realpathSync.native(resolve(path));
	if (!lstatSync(canonical).isDirectory()) throw new Error(`${label} must be a directory`);
	return canonical;
}

function hasGitMarker(directory: string): boolean {
	try {
		const marker = lstatSync(join(directory, ".git"));
		return marker.isDirectory() || marker.isFile();
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}

export function discoverGitWorkspaceRoot(startCwd: string): string | undefined {
	let cursor = canonicalDirectory(startCwd, "launch cwd");
	while (true) {
		if (hasGitMarker(cursor)) return cursor;
		const parent = dirname(cursor);
		if (parent === cursor) return;
		cursor = parent;
	}
}

export function createWorkspaceAuthority(launchCwd: string, explicitRoot?: string): WorkspaceAuthority {
	const canonicalLaunchCwd = canonicalDirectory(launchCwd, "launch cwd");
	if (explicitRoot !== undefined) {
		const workspaceRoot = canonicalDirectory(explicitRoot, "explicit workspace root");
		if (!isWithin(canonicalLaunchCwd, workspaceRoot)) {
			throw new Error(`launch cwd is outside explicit workspace root: ${canonicalLaunchCwd}`);
		}
		return Object.freeze({ workspaceRoot, launchCwd: canonicalLaunchCwd, source: "explicit" });
	}
	const gitRoot = discoverGitWorkspaceRoot(canonicalLaunchCwd);
	return Object.freeze({
		workspaceRoot: gitRoot ?? canonicalLaunchCwd,
		launchCwd: canonicalLaunchCwd,
		source: gitRoot ? "git-root" : "launch-cwd",
	});
}

export function assertWorkspaceExecutionCwd(authority: WorkspaceAuthority, cwd: string): string {
	const canonicalCwd = canonicalDirectory(cwd, "execution cwd");
	if (!isWithin(canonicalCwd, authority.workspaceRoot)) {
		throw new Error(`execution cwd escaped workspace authority: ${canonicalCwd}`);
	}
	return canonicalCwd;
}
