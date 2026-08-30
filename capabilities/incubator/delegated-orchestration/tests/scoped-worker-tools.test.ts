import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createScopedPathValidator, createScopedToolOperations } from "../extensions/scoped-worker-tools.ts";

async function fixture(): Promise<{ root: string; workspace: string; outside: string }> {
	const root = await mkdtemp(join(tmpdir(), "mypi-scoped-tools-"));
	const workspace = join(root, "worktree");
	const outside = join(root, "outside");
	await mkdir(join(workspace, "src"), { recursive: true });
	await mkdir(outside, { recursive: true });
	await writeFile(join(workspace, "src", "input.txt"), "INPUT\n");
	await writeFile(join(outside, "host.txt"), "HOST\n");
	return { root, workspace, outside };
}

test("scoped operations read, create, and edit only inside the worktree", async (t) => {
	const { root, workspace } = await fixture();
	t.after(() => rm(root, { recursive: true, force: true }));
	const operations = createScopedToolOperations({ workspaceRoot: workspace });

	assert.equal((await operations.read.readFile(join(workspace, "src", "input.txt"))).toString(), "INPUT\n");
	await operations.read.access(join(workspace, "src", "input.txt"));
	await operations.write.mkdir(join(workspace, "generated", "nested"));
	await operations.write.writeFile(join(workspace, "generated", "nested", "output.txt"), "OUTPUT\n");
	await operations.edit.access(join(workspace, "generated", "nested", "output.txt"));
	await operations.edit.writeFile(join(workspace, "generated", "nested", "output.txt"), "EDITED\n");
	assert.equal(await readFile(join(workspace, "generated", "nested", "output.txt"), "utf8"), "EDITED\n");
});

test("denies lexical external paths and symlinks that escape the worktree", async (t) => {
	const { root, workspace, outside } = await fixture();
	t.after(() => rm(root, { recursive: true, force: true }));
	await symlink(join(outside, "host.txt"), join(workspace, "src", "external-link.txt"));
	await symlink(outside, join(workspace, "external-dir"));
	const validator = createScopedPathValidator({ workspaceRoot: workspace });

	await assert.rejects(() => validator.assertPath(join(outside, "host.txt"), "read"), /outside worktree/);
	await assert.rejects(() => validator.assertPath(join(workspace, "src", "external-link.txt"), "read"), /symlink escape/);
	await assert.rejects(() => validator.assertPath(join(workspace, "external-dir", "new.txt"), "write"), /symlink escape/);
});

test("allows an internal symlink only when its canonical target remains scoped", async (t) => {
	const { root, workspace } = await fixture();
	t.after(() => rm(root, { recursive: true, force: true }));
	await symlink(join(workspace, "src"), join(workspace, "src-link"));
	const validator = createScopedPathValidator({ workspaceRoot: workspace });
	const evidence = await validator.assertPath(join(workspace, "src-link", "input.txt"), "read");
	assert.equal(evidence.canonicalPath, await realpath(join(workspace, "src", "input.txt")));
});

test("denies sensitive files and repository-control paths through lexical or canonical names", async (t) => {
	const { root, workspace } = await fixture();
	t.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(workspace, ".git"), { recursive: true });
	await writeFile(join(workspace, ".git", "config"), "[core]\n");
	await writeFile(join(workspace, ".env"), "FAKE_SECRET=1\n");
	await symlink(join(workspace, ".env"), join(workspace, "src", "innocent-link.txt"));
	const validator = createScopedPathValidator({ workspaceRoot: workspace });

	await assert.rejects(() => validator.assertPath(join(workspace, ".git", "config"), "read"), /protected worktree path/);
	await assert.rejects(() => validator.assertPath(join(workspace, ".env"), "read"), /sensitive path/);
	await assert.rejects(() => validator.assertPath(join(workspace, "nested", ".env.local"), "write"), /sensitive path/);
	await assert.rejects(() => validator.assertPath(join(workspace, "src", "innocent-link.txt"), "read"), /canonical sensitive path/);
});

test("read-only mode permits reads but rejects every write path", async (t) => {
	const { root, workspace } = await fixture();
	t.after(() => rm(root, { recursive: true, force: true }));
	const operations = createScopedToolOperations({ workspaceRoot: workspace, workspaceMode: "read-only" });
	assert.equal((await operations.read.readFile(join(workspace, "src", "input.txt"))).toString(), "INPUT\n");
	await assert.rejects(() => operations.write.writeFile(join(workspace, "output.txt"), "NO\n"), /read-only execution adapter/);
	await assert.rejects(() => operations.write.mkdir(join(workspace, "generated")), /read-only execution adapter/);
	await assert.rejects(() => operations.edit.access(join(workspace, "src", "input.txt")), /read-only execution adapter/);
	await assert.rejects(() => operations.edit.writeFile(join(workspace, "src", "input.txt"), "NO\n"), /read-only execution adapter/);
});

test("rejects malformed policy roots and relative operation paths", async (t) => {
	assert.throws(() => createScopedPathValidator({ workspaceRoot: "relative/worktree" }), /absolute path/);
	const { root, workspace } = await fixture();
	t.after(() => rm(root, { recursive: true, force: true }));
	const validator = createScopedPathValidator({ workspaceRoot: workspace });
	await assert.rejects(() => validator.assertPath("relative.txt", "write"), /requires an absolute path/);
});
