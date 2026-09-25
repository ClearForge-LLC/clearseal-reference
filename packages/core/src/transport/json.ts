// A strict JSON parser (RFC 8259) for request bodies. `JSON.parse` cannot be used on its own: it
// keeps the last of two duplicate keys silently, and it has no depth bound. A duplicate key is a
// parser-dependent answer, where a component that reads the first value and one that reads the
// last disagree about what was asked. So it is refused here, as a parse error.
//
// Also refused: a lone surrogate written as a `\u` escape, because a UTF-8 encoding of the value
// would differ from the string the client sent (the same reason a signer refuses one). Nesting
// deeper than `maxDepth` is refused as well. Objects are built with own properties only; a
// `__proto__` key becomes an ordinary property, never a prototype.

export class JsonParseError extends Error {
  override name = "JsonParseError";
  /** "syntax" for malformed text, "duplicate-key", "lone-surrogate", or "depth". */
  readonly kind: "syntax" | "duplicate-key" | "lone-surrogate" | "depth";
  constructor(message: string, kind: JsonParseError["kind"]) {
    super(message);
    this.kind = kind;
  }
}

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const WS = new Set([0x20, 0x09, 0x0a, 0x0d]);

export function parseJsonStrict(text: string, maxDepth: number): JsonValue {
  let i = 0;

  const fail = (what: string): never => {
    throw new JsonParseError(`${what} at offset ${String(i)}`, "syntax");
  };
  const skipWs = (): void => {
    while (i < text.length && WS.has(text.charCodeAt(i))) i++;
  };
  const expect = (literal: string): void => {
    if (text.startsWith(literal, i)) i += literal.length;
    else fail(`expected ${literal}`);
  };

  const parseString = (): string => {
    // At the opening quote.
    i++;
    let out = "";
    let start = i;
    for (;;) {
      if (i >= text.length) fail("unterminated string");
      const c = text.charCodeAt(i);
      if (c === 0x22) {
        out += text.slice(start, i);
        i++;
        return out;
      }
      if (c < 0x20) fail("control character in string");
      if (c === 0x5c) {
        out += text.slice(start, i);
        i++;
        const e = text[i];
        i++;
        switch (e) {
          case '"':
            out += '"';
            break;
          case "\\":
            out += "\\";
            break;
          case "/":
            out += "/";
            break;
          case "b":
            out += "\b";
            break;
          case "f":
            out += "\f";
            break;
          case "n":
            out += "\n";
            break;
          case "r":
            out += "\r";
            break;
          case "t":
            out += "\t";
            break;
          case "u": {
            const unit = readHex4();
            if (unit >= 0xd800 && unit <= 0xdbff) {
              // A high surrogate must be followed by an escaped low surrogate.
              if (text[i] !== "\\" || text[i + 1] !== "u") throw new JsonParseError(`lone surrogate at offset ${String(i)}`, "lone-surrogate");
              i += 2;
              const low = readHex4();
              if (low < 0xdc00 || low > 0xdfff) throw new JsonParseError(`lone surrogate at offset ${String(i)}`, "lone-surrogate");
              out += String.fromCharCode(unit, low);
            } else if (unit >= 0xdc00 && unit <= 0xdfff) {
              throw new JsonParseError(`lone surrogate at offset ${String(i)}`, "lone-surrogate");
            } else {
              out += String.fromCharCode(unit);
            }
            break;
          }
          default:
            fail("invalid escape");
        }
        start = i;
        continue;
      }
      // Raw surrogate code units cannot reach here from strictly decoded UTF-8, but a caller may
      // hand in any string: check pairs anyway.
      if (c >= 0xd800 && c <= 0xdfff) {
        const next = text.charCodeAt(i + 1);
        if (c <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
          i += 2;
          continue;
        }
        throw new JsonParseError(`lone surrogate at offset ${String(i)}`, "lone-surrogate");
      }
      i++;
    }
  };

  const readHex4 = (): number => {
    const hex = text.slice(i, i + 4);
    if (!/^[0-9A-Fa-f]{4}$/.test(hex)) fail("invalid \\u escape");
    i += 4;
    return parseInt(hex, 16);
  };

  const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
  const parseNumber = (): number => {
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(text);
    if (m === null) return fail("invalid number");
    i += m[0].length;
    const n = Number(m[0]);
    if (!Number.isFinite(n)) fail("number out of range");
    return n;
  };

  const parseValue = (depth: number): JsonValue => {
    skipWs();
    const c = text[i];
    switch (c) {
      case "{": {
        if (depth >= maxDepth) throw new JsonParseError(`nesting deeper than ${String(maxDepth)}`, "depth");
        i++;
        const obj: { [key: string]: JsonValue } = {};
        const seen = new Set<string>();
        skipWs();
        if (text[i] === "}") {
          i++;
          return obj;
        }
        for (;;) {
          skipWs();
          if (text[i] !== '"') fail("expected a string key");
          const key = parseString();
          if (seen.has(key)) throw new JsonParseError(`duplicate key at offset ${String(i)}`, "duplicate-key");
          seen.add(key);
          skipWs();
          expect(":");
          const value = parseValue(depth + 1);
          Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
          skipWs();
          if (text[i] === ",") {
            i++;
            continue;
          }
          if (text[i] === "}") {
            i++;
            return obj;
          }
          fail("expected , or }");
        }
      }
      case "[": {
        if (depth >= maxDepth) throw new JsonParseError(`nesting deeper than ${String(maxDepth)}`, "depth");
        i++;
        const arr: JsonValue[] = [];
        skipWs();
        if (text[i] === "]") {
          i++;
          return arr;
        }
        for (;;) {
          arr.push(parseValue(depth + 1));
          skipWs();
          if (text[i] === ",") {
            i++;
            continue;
          }
          if (text[i] === "]") {
            i++;
            return arr;
          }
          fail("expected , or ]");
        }
      }
      case '"':
        return parseString();
      case "t":
        expect("true");
        return true;
      case "f":
        expect("false");
        return false;
      case "n":
        expect("null");
        return null;
      default:
        if (c === "-" || (c !== undefined && c >= "0" && c <= "9")) return parseNumber();
        return fail("unexpected character");
    }
  };

  const value = parseValue(0);
  skipWs();
  if (i !== text.length) fail("trailing content");
  return value;
}

/** The nesting depth of a parsed JSON value (a scalar is depth 0; `{}` and `[]` are depth 1). */
export function jsonDepth(value: unknown): number {
  let max = 0;
  const stack: [unknown, number][] = [[value, 0]];
  while (stack.length > 0) {
    const [v, d] = stack.pop() as [unknown, number];
    if (typeof v === "object" && v !== null) {
      const depth = d + 1;
      if (depth > max) max = depth;
      for (const child of Object.values(v)) stack.push([child, depth]);
    }
  }
  return max;
}
