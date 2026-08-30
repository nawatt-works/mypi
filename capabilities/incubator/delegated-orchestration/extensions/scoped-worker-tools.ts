import { constants } from "node:fs";
import {
	lstat,
	mkdir as fsMkdir,
	open as fsOpen,
	realpath,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { isSensitivePath } from "@nawatt-works/mypi-safety-guardrails/detector";

export type ScopedPathAccess = "read" | "write";

export type ScopedWorkerPathPolicy = {
	workspaceRoot: string;
	workspaceMode?: "read-only" | "worktree-write";
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
	const workspaceMode = policy.workspaceMode ?? "worktree-write";
	const denySensitivePaths = policy.denySensitivePaths ?? true;
	const protectedSegments = new Set(policy.protectedSegments ?? DEFAULT_PROTECTED_SEGMENTS);

	return {
		async assertPath(absolutePath, access) {
			if (workspaceMode === "read-only" && access === "write") throw new Error("Scoped Worker write denied by read-only execution adapter");
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
	const noFollow = constants.O_NOFOLLOW ?? 0;
	const readScoped = async (absolutePath: string): Promise<Buffer> => {
		const evidence = await validator.assertPath(absolutePath, "read");
		const handle = await fsOpen(evidence.canonicalPath, constants.O_RDONLY | noFollow);
		try {
			return await handle.readFile();
		} finally {
			await handle.close();
		}
	};
	const writeScoped = async (absolutePath: string, content: string): Promise<void> => {
		const evidence = await validator.assertPath(absolutePath, "write");
		const handle = await fsOpen(evidence.canonicalPath, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | noFollow, 0o666);
		try {
			await handle.writeFile(content, "utf8");
		} finally {
			await handle.close();
		}
	};
	const accessScoped = async (absolutePath: string, access: ScopedPathAccess): Promise<void> => {
		const evidence = await validator.assertPath(absolutePath, access);
		const flags = access === "read" ? constants.O_RDONLY : constants.O_RDWR;
		const handle = await fsOpen(evidence.canonicalPath, flags | noFollow);
		await handle.close();
	};
	return {
		read: {
			readFile: readScoped,
			async access(absolutePath) {
				await accessScoped(absolutePath, "read");
			},
		},
		write: {
			writeFile: writeScoped,
			async mkdir(absolutePath) {
				const evidence = await validator.assertPath(absolutePath, "write");
				await fsMkdir(evidence.canonicalPath, { recursive: true });
				await validator.assertPath(absolutePath, "write");
			},
		},
		edit: {
			readFile: readScoped,
			writeFile: writeScoped,
			async access(absolutePath) {
				await accessScoped(absolutePath, "write");
			},
		},
	};
}
