import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { createJiti } from "./toolchain/node_modules/jiti/lib/jiti.mjs";

const root = resolve(import.meta.dirname);
const fixture = resolve(root, "fixture");
const modules = resolve(root, "node_modules");
const resultsDir = resolve(root, "results");
const mode = process.argv[2];
const warmupMs = Number(process.env.BENCH_WARMUP_MS ?? 2000);
const jiti = createJiti(import.meta.url, { interopDefault: false });

function createHarness() {
  const tools = new Map();
  const handlers = new Map();
  const commands = new Map();
  const pi = {
    registerTool(tool) { tools.set(tool.name, tool); },
    registerCommand(name, command) { commands.set(name, command); },
    registerMessageRenderer() {},
    sendMessage() {},
    on(name, handler) {
      const list = handlers.get(name) ?? [];
      list.push(handler);
      handlers.set(name, list);
    },
    events: { on() {}, emit() {} },
    getActiveTools() { return [...tools.keys()]; },
    getAllTools() { return [...tools.values()]; },
    setActiveTools() {},
  };
  return { pi, tools, handlers, commands };
}

const theme = {
  fg(_name, value) { return value; },
  bg(_name, value) { return value; },
  bold(value) { return value; },
  italic(value) { return value; },
  strikethrough(value) { return value; },
};
const ctx = {
  cwd: fixture,
  hasUI: false,
  mode: "print",
  signal: undefined,
  isProjectTrusted() { return true; },
  ui: {
    theme,
    setStatus() {},
    notify() {},
    confirm: async () => false,
  },
};

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function contentText(result) {
  return (result?.content ?? [])
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

async function invoke(tool, params) {
  const start = performance.now();
  const result = await tool.execute("benchmark-call", params, undefined, undefined, ctx);
  const elapsedMs = performance.now() - start;
  const text = contentText(result);
  return {
    elapsedMs: Number(elapsedMs.toFixed(1)),
    outputChars: text.length,
    text,
  };
}

async function runAstGrep() {
  const harness = createHarness();
  const module = await jiti.import(resolve(modules, "pi-ast-grep/src/index.ts"));
  module.default(harness.pi);
  const tool = harness.tools.get("ast_grep");
  return {
    package: "pi-ast-grep@0.1.0",
    registeredTools: [...harness.tools.keys()],
    schemaChars: JSON.stringify(tool.parameters).length,
    calls: {
      consoleCalls: await invoke(tool, {
        command: "run",
        pattern: "console.log($A)",
        language: "ts",
        paths: ["src"],
        maxResults: 20,
      }),
      formatUserCalls: await invoke(tool, {
        command: "run",
        pattern: "formatUser($A)",
        language: "ts",
        paths: ["src"],
        maxResults: 20,
      }),
    },
  };
}

async function runLspPi() {
  const harness = createHarness();
  const module = await jiti.import(resolve(modules, "lsp-pi/lsp-tool.ts"));
  module.default(harness.pi);
  const tool = harness.tools.get("lsp");
  let output;
  try {
    output = {
      package: "lsp-pi@1.0.5",
      registeredTools: [...harness.tools.keys()],
      schemaChars: JSON.stringify(tool.parameters).length,
      calls: {},
    };
    output.calls.diagnosticsCold = await invoke(tool, { action: "diagnostics", file: "src/index.ts", severity: "all" });
    await delay(warmupMs);
    output.calls.diagnosticsWarm = await invoke(tool, { action: "diagnostics", file: "src/index.ts", severity: "all" });
    output.calls.hoverWarm = await invoke(tool, { action: "hover", file: "src/index.ts", line: 9, column: 13 });
    output.calls.definitionWarm = await invoke(tool, { action: "definition", file: "src/index.ts", line: 9, column: 13 });
    output.calls.referencesWarm = await invoke(tool, { action: "references", file: "src/domain.ts", line: 9, column: 17 });
    output.calls.symbolsWarm = await invoke(tool, { action: "symbols", file: "src/service.ts" });
    output = {
      ...output,
      calls: output.calls,
    
    };
  } finally {
    const core = await jiti.import(resolve(modules, "lsp-pi/lsp-core.ts"));
    await core.shutdownManager();
  }
  return output;
}

async function runLspAdapter() {
  const harness = createHarness();
  const module = await jiti.import(resolve(modules, "pi-lsp-adapter/src/index.ts"));
  module.default(harness.pi);
  for (const handler of harness.handlers.get("session_start") ?? []) {
    await handler({ reason: "startup" }, ctx);
  }
  let output;
  try {
    const call = (name, params) => invoke(harness.tools.get(name), params);
    output = {
      package: "pi-lsp-adapter@0.1.3",
      registeredTools: [...harness.tools.keys()],
      schemaChars: [...harness.tools.values()].reduce((sum, tool) => sum + JSON.stringify(tool.parameters).length, 0),
      calls: {},
    };
    output.calls.diagnosticsCold = await call("lsp_diagnostics", { filePath: "src/index.ts" });
    await delay(warmupMs);
    output.calls.diagnosticsWarm = await call("lsp_diagnostics", { filePath: "src/index.ts" });
    output.calls.hoverWarm = await call("lsp_hover", { filePath: "src/index.ts", line: 9, column: 13 });
    output.calls.definitionWarm = await call("lsp_definition", { filePath: "src/index.ts", line: 9, column: 13 });
    output.calls.referencesWarm = await call("lsp_references", { filePath: "src/domain.ts", line: 9, column: 17, includeDeclaration: true });
    output.calls.symbolsWarm = await call("lsp_document_symbols", { filePath: "src/service.ts" });
    output.calls.workspaceSymbolsWarm = await call("lsp_workspace_symbols", { query: "summarize", serverId: "vtsls" });
    output = {
      ...output,
      calls: output.calls,
    
    };
  } finally {
    for (const handler of harness.handlers.get("session_shutdown") ?? []) {
      await handler({ reason: "quit" }, ctx);
    }
  }
  return output;
}

async function runDeclarativePiLsp() {
  const harness = createHarness();
  const module = await jiti.import(resolve(modules, "pi-lsp/extensions/pi-lsp/index.ts"));
  module.default(harness.pi);
  for (const handler of harness.handlers.get("session_start") ?? []) {
    await handler({ reason: "startup" }, ctx);
  }
  let output;
  try {
    const call = (name, params) => invoke(harness.tools.get(name), params);
    output = {
      package: "pi-lsp@0.1.7",
      registeredTools: [...harness.tools.keys()],
      schemaChars: [...harness.tools.values()].reduce((sum, tool) => sum + JSON.stringify(tool.parameters).length, 0),
      calls: {},
    };
    output.calls.diagnosticsBeforeStart = await call("lsp_diagnostics", { path: "src/index.ts" });
    output.calls.hoverCold = await call("lsp_hover", { path: "src/index.ts", line: 8, character: 12 });
    await delay(warmupMs);
    output.calls.diagnosticsWarm = await call("lsp_diagnostics", { path: "src/index.ts" });
    output.calls.hoverWarm = await call("lsp_hover", { path: "src/index.ts", line: 8, character: 12 });
    output.calls.definitionWarm = await call("lsp_definition", { path: "src/index.ts", line: 8, character: 12 });
    output.calls.referencesWarm = await call("lsp_references", { path: "src/domain.ts", line: 8, character: 16, includeDeclaration: true });
    output.calls.symbolsWarm = await call("lsp_symbols", { path: "src/service.ts" });
  } finally {
    for (const handler of harness.handlers.get("session_shutdown") ?? []) {
      await handler({ reason: "quit" }, ctx);
    }
  }
  return output;
}

async function runNarumiPiLsp() {
  const harness = createHarness();
  const module = await jiti.import(resolve(modules, "@narumitw/pi-lsp/dist/index.ts"));
  module.default(harness.pi);
  for (const handler of harness.handlers.get("session_start") ?? []) {
    await handler({ reason: "startup" }, ctx);
  }
  try {
    const tool = harness.tools.get("lsp_diagnostics");
    return {
      package: "@narumitw/pi-lsp@0.49.5",
      registeredTools: [...harness.tools.keys()],
      schemaChars: [...harness.tools.values()].reduce((sum, registered) => sum + JSON.stringify(registered.parameters).length, 0),
      calls: {
        diagnosticsCold: await invoke(tool, { paths: ["src/index.ts"], root: fixture, limit: 10, server: "typescript" }),
        diagnosticsSecondCold: await invoke(tool, { paths: ["src/index.ts"], root: fixture, limit: 10, server: "typescript" }),
      },
    };
  } finally {
    for (const handler of harness.handlers.get("session_shutdown") ?? []) {
      await handler({ reason: "quit" }, ctx);
    }
  }
}

const runners = {
  ast: runAstGrep,
  "lsp-pi": runLspPi,
  adapter: runLspAdapter,
  "pi-lsp": runDeclarativePiLsp,
  narumi: runNarumiPiLsp,
};
if (!runners[mode]) throw new Error(`Unknown mode: ${mode}`);

const output = await runners[mode]();
await mkdir(resultsDir, { recursive: true });
await writeFile(resolve(resultsDir, `${mode}.json`), `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify(output, null, 2));
process.exit(0);
