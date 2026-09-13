// security/scanner.mjs
//
// The container's eyes: a static pickle opcode disassembler and threat
// classifier. It NEVER executes, imports, or unpickles anything -- it walks
// the opcode stream the way the unpickler VM would, and reports what the
// stream WOULD do if run.
//
// Why this is the strong side of the arena (security/README.md spells it out):
// executing code through pickle is not optional at the byte level. The
// unpickler must be handed a callable -- via GLOBAL / STACK_GLOBAL / INST --
// and must be told to invoke it -- via REDUCE / INST / OBJ / NEWOBJ* / BUILD.
// Those opcodes are structural; no amount of string obfuscation hides them,
// because the unpickler itself has to read them to run the payload. A scanner
// that keys on that structure cannot be out-run by a scanner that keys on
// substrings. That asymmetry is the whole point of the demo.

// Opcode -> how many *literal* argument bytes follow it, or a reader tag.
// "line" means "read up to and including the next \n". A number means that
// many raw bytes. "len1"/"len4"/"len8" mean a length prefix of that many
// little-endian bytes, then that many payload bytes.
const OPCODES = {
  0x28: { name: "MARK" },
  0x2e: { name: "STOP" },
  0x30: { name: "POP" },
  0x31: { name: "POP_MARK" },
  0x32: { name: "DUP" },
  0x46: { name: "FLOAT", arg: "line" },
  0x47: { name: "BINFLOAT", arg: 8 },
  0x49: { name: "INT", arg: "line" },
  0x4a: { name: "BININT", arg: 4 },
  0x4b: { name: "BININT1", arg: 1 },
  0x4c: { name: "LONG", arg: "line" },
  0x4d: { name: "BININT2", arg: 2 },
  0x4e: { name: "NONE" },
  0x50: { name: "PERSID", arg: "line" },
  0x51: { name: "BINPERSID" },
  0x52: { name: "REDUCE" },
  0x53: { name: "STRING", arg: "line" },
  0x54: { name: "BINSTRING", arg: "len4" },
  0x55: { name: "SHORT_BINSTRING", arg: "len1" },
  0x56: { name: "UNICODE", arg: "line", push: "str" },
  0x58: { name: "BINUNICODE", arg: "len4", push: "str" },
  0x61: { name: "APPEND" },
  0x62: { name: "BUILD" },
  0x63: { name: "GLOBAL", arg: "line2" },
  0x64: { name: "DICT" },
  0x65: { name: "APPENDS" },
  0x67: { name: "GET", arg: "line" },
  0x68: { name: "BINGET", arg: 1 },
  0x69: { name: "INST", arg: "line2" },
  0x6a: { name: "LONG_BINGET", arg: 4 },
  0x6c: { name: "LIST" },
  0x6f: { name: "OBJ" },
  0x70: { name: "PUT", arg: "line" },
  0x71: { name: "BINPUT", arg: 1 },
  0x72: { name: "LONG_BINPUT", arg: 4 },
  0x73: { name: "SETITEM" },
  0x74: { name: "TUPLE" },
  0x75: { name: "SETITEMS" },
  0x42: { name: "BINBYTES", arg: "len4" },
  0x43: { name: "SHORT_BINBYTES", arg: "len1" },
  0x5d: { name: "EMPTY_LIST" },
  0x7d: { name: "EMPTY_DICT" },
  0x29: { name: "EMPTY_TUPLE" },
  0x80: { name: "PROTO", arg: 1 },
  0x81: { name: "NEWOBJ" },
  0x82: { name: "EXT1", arg: 1 },
  0x83: { name: "EXT2", arg: 2 },
  0x84: { name: "EXT4", arg: 4 },
  0x85: { name: "TUPLE1" },
  0x86: { name: "TUPLE2" },
  0x87: { name: "TUPLE3" },
  0x88: { name: "NEWTRUE" },
  0x89: { name: "NEWFALSE" },
  0x8a: { name: "LONG1", arg: "len1" },
  0x8b: { name: "LONG4", arg: "len4" },
  0x8c: { name: "SHORT_BINUNICODE", arg: "len1", push: "str" },
  0x8d: { name: "BINUNICODE8", arg: "len8", push: "str" },
  0x8e: { name: "BINBYTES8", arg: "len8" },
  0x8f: { name: "EMPTY_SET" },
  0x90: { name: "FROZENSET" },
  0x91: { name: "NEWOBJ_EX" },
  0x93: { name: "STACK_GLOBAL" },
  0x94: { name: "MEMOIZE" },
  0x95: { name: "FRAME", arg: 8 },
  0x96: { name: "BYTEARRAY8", arg: "len8" },
  0x97: { name: "NEXT_BUFFER" },
  0x98: { name: "READONLY_BUFFER" },
};

// Getting a callable onto the stack.
const GLOBAL_OPS = new Set(["GLOBAL", "STACK_GLOBAL", "INST"]);
// Invoking whatever is on the stack. Any one of these + a dangerous global
// is code execution.
const CALL_OPS = new Set(["REDUCE", "INST", "OBJ", "NEWOBJ", "NEWOBJ_EX", "BUILD"]);

// module -> the names on it that hand an attacker a shell, a process, a
// socket, or an eval. Kept small and explicit; `has(module)` alone (with no
// name filter) marks a module that has no safe surface at all.
const DANGEROUS = {
  os: new Set(["system", "popen", "execv", "execve", "execvp", "spawnl", "spawnv", "posix_spawn", "putenv", "remove", "unlink", "rmdir"]),
  posix: new Set(["system", "execv", "popen"]),
  nt: new Set(["system"]),
  subprocess: new Set(["Popen", "call", "run", "check_call", "check_output", "getoutput", "getstatusoutput"]),
  builtins: new Set(["eval", "exec", "compile", "__import__", "getattr", "open"]),
  __builtin__: new Set(["eval", "exec", "compile", "__import__", "getattr", "open"]),
  socket: null, // whole module is a network primitive in this context
  pty: new Set(["spawn"]),
  importlib: new Set(["import_module"]),
  webbrowser: new Set(["open"]),
  ctypes: null,
};

const readLine = (buf, i) => {
  let j = i;
  while (j < buf.length && buf[j] !== 0x0a) j++;
  return { text: buf.slice(i, j).toString("latin1"), next: j + 1 };
};

const readLenLE = (buf, i, n) => {
  let len = 0;
  for (let k = 0; k < n; k++) len += buf[i + k] * 2 ** (8 * k);
  return len;
};

const isDangerous = (module, name) => {
  if (!(module in DANGEROUS)) return false;
  const names = DANGEROUS[module];
  return names === null ? true : names.has(name);
};

/**
 * Disassemble a pickle byte stream into opcodes without executing it.
 * Returns { ops, truncated } where each op is { offset, name, arg? }.
 * Unknown opcodes stop the walk (and mark truncated) rather than guessing
 * an alignment -- a scanner that silently resynchronises can be fed a byte
 * that hides the opcodes after it.
 */
export function disassemble(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const ops = [];
  let i = 0;
  let truncated = false;
  while (i < buf.length) {
    const offset = i;
    const code = buf[i];
    const spec = OPCODES[code];
    i += 1;
    if (!spec) {
      truncated = true;
      ops.push({ offset, name: `UNKNOWN(0x${code.toString(16).padStart(2, "0")})` });
      break;
    }
    const op = { offset, name: spec.name };
    if (spec.arg === "line") {
      const r = readLine(buf, i);
      op.arg = r.text;
      i = r.next;
    } else if (spec.arg === "line2") {
      const a = readLine(buf, i);
      const b = readLine(buf, a.next);
      op.module = a.text;
      op.name2 = b.text;
      i = b.next;
    } else if (typeof spec.arg === "number") {
      i += spec.arg;
    } else if (spec.arg === "len1" || spec.arg === "len4" || spec.arg === "len8") {
      const n = spec.arg === "len1" ? 1 : spec.arg === "len4" ? 4 : 8;
      const len = readLenLE(buf, i, n);
      i += n;
      if (spec.push === "str") op.arg = buf.slice(i, i + len).toString("utf8");
      i += len;
    }
    if (spec.push === "str") op.pushedStr = op.arg;
    ops.push(op);
    if (spec.name === "STOP") break;
  }
  return { ops, truncated };
}

/**
 * Resolve every callable the stream loads (GLOBAL/STACK_GLOBAL/INST) to a
 * module.name pair, tracking the last two pushed strings so STACK_GLOBAL --
 * the proto-4 opcode that takes its module and name off the stack rather than
 * inline -- resolves too. This is the opcode a substring scanner misses.
 */
export function resolveGlobals(ops) {
  const globals = [];
  let recentStrings = [];
  for (const op of ops) {
    if (op.pushedStr !== undefined) {
      recentStrings.push(op.pushedStr);
      if (recentStrings.length > 8) recentStrings.shift();
    }
    if (op.name === "GLOBAL" || op.name === "INST") {
      globals.push({ offset: op.offset, module: op.module, name: op.name2, via: op.name });
    } else if (op.name === "STACK_GLOBAL") {
      const name = recentStrings[recentStrings.length - 1];
      const module = recentStrings[recentStrings.length - 2];
      globals.push({ offset: op.offset, module, name, via: "STACK_GLOBAL" });
    }
  }
  return globals;
}

/**
 * Classify a pickle stream. Returns
 *   { verdict: "clean"|"suspicious"|"critical", findings: [...], ops }
 * "critical" == a dangerous callable is loaded AND an invoke opcode is present.
 */
export function scanPickle(bytes) {
  const { ops, truncated } = disassemble(bytes);
  const globals = resolveGlobals(ops);
  const dangerous = globals.filter((g) => isDangerous(g.module, g.name));
  const hasCall = ops.some((op) => CALL_OPS.has(op.name));
  const hasGlobalOp = ops.some((op) => GLOBAL_OPS.has(op.name));

  const findings = [];
  for (const g of dangerous) {
    findings.push({
      kind: "dangerous-global",
      detail: `${g.module}.${g.name} loaded via ${g.via}`,
      offset: g.offset,
    });
  }
  if (dangerous.length && hasCall) {
    findings.push({ kind: "code-execution", detail: "dangerous callable is invoked (REDUCE/INST/BUILD/NEWOBJ)" });
  }
  if (truncated) {
    findings.push({ kind: "opcode-truncated", detail: "unknown opcode -- refusing to guess alignment; treat as suspicious" });
  }

  let verdict = "clean";
  if (dangerous.length && hasCall) verdict = "critical";
  else if (dangerous.length || truncated) verdict = "suspicious";
  // A callable-load + invoke to a module we don't recognise is still worth a
  // flag: unknown is not the same as safe.
  else if (hasGlobalOp && hasCall && globals.length) verdict = "suspicious";

  return { verdict, findings, globals, ops };
}
