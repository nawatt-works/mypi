import { constants } from "node:fs";
import {
	access as fsAccess,
	lstat,
	mkdir as fsMkdir,
	readFile as fsReadFile,
	realpath,
	writeFile as fsWriteFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { isSensitivePath } from "./guardrails.ts";

export type ScopedPathAccess = "read" | "write";

export type ScopedWorkerPathPolicy = {
	workspaceRoot: string;
	denySensitivePaths?: boolean;
	protectedSegments?: readonly string[];
};

export type ScopedPathEvidence = {
	requestedPath: string;
	canonicalPath: string;
	workspaceRoot: string;
	access: ScopedPathAccess;
};

const DEFAULT_PROTECTED_SEGMENTS = [".git"] as const;

function isWithin(path: string, root: string): boolean {
	const offset = relative(root, path);
	return offset === "" || (!offset.startsWith("..") && !isAbsolute(offset));
}

function pathSegments(path: string, root: string): string[] {
	const offset = relative(root, path);
	if (!offset) return [];
	return offset.split(sep).filter(Boolean);
}

async function nearestExistingAncestor(path: string): Promise<string> {
	let candidate = path;
	while (true) {
		try {
			await lstat(candidate);
			return candidate;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			const parent = dirname(candidate);
			if (parent === candidate) throw new Error(`No existing ancestor for ${path}`);
			candidate = parent;
		}
	}
}

export function createScopedPathValidator(policy: ScopedWorkerPathPolicy): {
	assertPath: (absolutePath: string, access: ScopedPathAccess) => Promise<ScopedPathEvidence>;
} {
	if (!isAbsolute(policy.workspaceRoot)) throw new Error("workspaceRoot must be an absolute path");
	const workspaceRoot = resolve(policy.workspaceRoot);
	const canonicalRootPromise = realpath(workspaceRoot);
	const denySensitivePaths = policy.denySensitivePaths ?? true;
	const protectedSegments = new Set(policy.protectedSegments ?? DEFAULT_PROTECTED_SEGMENTS);

	return {
		async assertPath(absolutePath, access) {
			if (!isAbsolute(absolutePath)) throw new Error("Scoped Worker operation requires an absolute path");
			const requestedPath = resolve(absolutePath);
			if (!isWithin(requestedPath, workspaceRoot)) {
				throw new Error(`Scoped Worker ${access} denied outside worktree: ${requestedPath}`);
			}
			if (pathSegments(requestedPath, workspaceRoot).some((segment) => protectedSegments.has(segment))) {
				throw new Error(`Scoped Worker ${access} denied protected worktree path: ${requestedPath}`);
			}
			if (denySensitivePaths && isSensitivePath(requestedPath)) {
				throw new Error(`Scoped Worker ${access} denied sensitive path: ${requestedPath}`);
			}

			const canonicalRoot = await canonicalRootPromise;
			const existing = await nearestExistingAncestor(requestedPath);
			const canonicalExisting = await realpath(existing);
			if (!isWithin(canonicalExisting, canonicalRoot)) {
				throw new Error(`Scoped Worker ${access} denied symlink escape: ${requestedPath}`);
			}
			const suffix = relative(existing, requestedPath);
			const canonicalPath = suffix ? resolve(canonicalExisting, suffix) : canonicalExisting;
			if (!isWithin(canonicalPath, canonicalRoot)) {
				throw new Error(`Scoped Worker ${access} denied canonical path escape: ${requestedPath}`);
			}
			if (pathSegments(canonicalPath, canonicalRoot).some((segment) => protectedSegments.has(segment))) {
				throw new Error(`Scoped Worker ${access} denied canonical protected path: ${canonicalPath}`);
			}
			if (denySensitivePaths && isSensitivePath(canonicalPath)) {
				throw new Error(`Scoped Worker ${access} denied canonical sensitive path: ${canonicalPath}`);
			}
			return { requestedPath, canonicalPath, workspaceRoot: canonicalRoot, access };
		},
	};
}

export function createScopedToolOperations(policy: ScopedWorkerPathPolicy): {
	read: {
		readFile: (absolutePath: string) => Promise<Buffer>;
		access: (absolutePath: string) => Promise<void>;
	};
	write: {
		writeFile: (absolutePath: string, content: string) => Promise<void>;
		mkdir: (absolutePath: string) => Promise<void>;
	};
	edit: {
		readFile: (absolutePath: string) => Promise<Buffer>;
		writeFile: (absolutePath: string, content: string) => Promise<void>;
		access: (absolutePath: string) => Promise<void>;
	};
} {
	const validator = createScopedPathValidator(policy);
	return {
		read: {
			async readFile(absolutePath) {
				await validator.assertPath(absolutePath, "read");
				return fsReadFile(absolutePath);
			},
			async access(absolutePath) {
				await validator.assertPath(absolutePath, "read");
				await fsAccess(absolutePath, constants.R_OK);
			},
		},
		write: {
			async writeFile(absolutePath, content) {
				await validator.assertPath(absolutePath, "write");
				await fsWriteFile(absolutePath, content, "utf8");
			},
			async mkdir(absolutePath) {
				await validator.assertPath(absolutePath, "write");
				await fsMkdir(absolutePath, { recursive: true });
			},
		},
		edit: {
			async readFile(absolutePath) {
				await validator.assertPath(absolutePath, "read");
				return fsReadFile(absolutePath);
			},
			async writeFile(absolutePath, content) {
				await validator.assertPath(absolutePath, "write");
				await fsWriteFile(absolutePath, content, "utf8");
			},
			async access(absolutePath) {
				await validator.assertPath(absolutePath, "write");
				await fsAccess(absolutePath, constants.R_OK | constants.W_OK);
			},
		},
	};
}
