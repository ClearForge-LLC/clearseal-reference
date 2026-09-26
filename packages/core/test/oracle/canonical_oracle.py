"""The canonical form, version 1: an independent implementation in a second language.

Written from docs/canonical-form.md (ratified 2026-09-26), rule by rule, and never translated
from the TypeScript canonicalizer. It is the oracle: generate.py uses it to write
packages/core/test/vectors/canonical-v1.json, and the TypeScript is checked against that file
and against this module (by subprocess, in the property tests). It never works the other way
round. The standard library only; Python 3.8 or later.

Usage:
    python canonical_oracle.py serve   JSON lines on stdin, one result per line on stdout.

Request: {"kind": ..., "input": ...} or {"kind": "json", "input_json_text": ...} or
{"kind": "json-special", "input_special": "NaN" | "Infinity" | "-Infinity"}.
Reply: {"ok": true, "hex": ..., "sha256": ...} or {"ok": false, "rule": ...}.
"""

import hashlib
import json
import math
import re
import sys
from decimal import Decimal

CANONICAL_FORM_VERSION = 1
MAX_MAGNITUDE = 2**53 - 1
# Version 1 of the specification sets no depth. This is an implementation limit on every input,
# text or value, counted in objects and arrays: beyond it the input is refused. Serialization
# recurses a few frames per level, so the interpreter's recursion limit is raised far enough that
# the limit, not the interpreter, decides.
MAX_NESTING = 512
sys.setrecursionlimit(max(sys.getrecursionlimit(), 10 * MAX_NESTING))

PINNED_FIELDS = (
    "name", "description", "input_schema", "capability_class", "untrusted_input_facing",
    "scope", "privacy_sensitive", "recoverability_basis", "elevated", "containment_domain",
)
CAPABILITY_CLASSES = ("read_only", "owned_state", "state_change", "arbitrary_exec")
NAME = re.compile(r"[a-z0-9][a-z0-9._-]{0,63}")


class Refused(Exception):
    def __init__(self, rule, message):
        super().__init__(rule + ": " + message)
        self.rule = rule


# A3: code points as given; no unpaired surrogate; no leading U+FEFF.
def check_string(s):
    if s[:1] == "﻿":
        raise Refused("A3", "a string begins with U+FEFF")
    for ch in s:
        if 0xD800 <= ord(ch) <= 0xDFFF:
            raise Refused("A3", "a lone surrogate")


# A1, RFC 8785's serialization of strings.
def serialize_string(s):
    check_string(s)
    short = {'"': '\\"', "\\": "\\\\", "\b": "\\b", "\t": "\\t", "\n": "\\n", "\f": "\\f", "\r": "\\r"}
    out = []
    for ch in s:
        if ch in short:
            out.append(short[ch])
        elif ord(ch) < 0x20:
            out.append("\\u%04x" % ord(ch))
        else:
            out.append(ch)
    return '"' + "".join(out) + '"'


# A2: ECMAScript Number::toString (RFC 8785's serialization of numbers), with the refusals.
def serialize_number(x):
    if isinstance(x, int):
        if abs(x) > MAX_MAGNITUDE:
            raise Refused("A2", "a magnitude over 2^53 - 1")
        return str(x)
    if math.isnan(x) or math.isinf(x):
        raise Refused("A2", "NaN or an infinity")
    if x == 0:
        if math.copysign(1.0, x) < 0:
            raise Refused("A2", "negative zero")
        return "0"
    if abs(x) > MAX_MAGNITUDE:
        raise Refused("A2", "a magnitude over 2^53 - 1")
    # The shortest decimal digits that round-trip (repr's guarantee), then ECMAScript's layout:
    # with k digits and the decimal point n places from the left of them, the value is
    # 0.d1..dk × 10^n.
    sign, digits, exponent = Decimal(repr(abs(x))).as_tuple()
    ds = "".join(str(d) for d in digits)
    n = len(ds) + exponent
    ds = ds.rstrip("0") or "0"
    k = len(ds)
    if k <= n <= 21:
        text = ds + "0" * (n - k)
    elif 0 < n <= 21:
        text = ds[:n] + "." + ds[n:]
    elif -6 < n <= 0:
        text = "0." + "0" * (-n) + ds
    else:
        e = n - 1
        text = ds[0] + ("." + ds[1:] if k > 1 else "") + "e" + ("+" if e >= 0 else "-") + str(abs(e))
    return ("-" if x < 0 else "") + text


def _utf16_key(s):
    return s.encode("utf-16-be")


# A1: RFC 8785. Members sorted by their names as UTF-16 code units, arrays in order, no whitespace.
def serialize(v, depth=0):
    if isinstance(v, (list, dict)) and depth >= MAX_NESTING:
        raise Refused("A1", "nested deeper than the implementation limit")
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, (int, float)):
        return serialize_number(v)
    if isinstance(v, str):
        return serialize_string(v)
    if isinstance(v, list):
        return "[" + ",".join(serialize(x, depth + 1) for x in v) + "]"
    if isinstance(v, dict):
        for name in v:
            if not isinstance(name, str):
                raise Refused("A1", "a member name that is not a string")
            check_string(name)
        names = sorted(v, key=_utf16_key)
        return "{" + ",".join(serialize_string(n) + ":" + serialize(v[n], depth + 1) for n in names) + "}"
    raise Refused("A1", "not a JSON value")


def canonical_bytes(v):
    return serialize(v).encode("utf-8")


def _depth(v):
    deepest, stack = 0, [(v, 0)]
    while stack:
        node, d = stack.pop()
        if isinstance(node, (list, dict)):
            deepest = max(deepest, d + 1)
            stack.extend((c, d + 1) for c in (node.values() if isinstance(node, dict) else node))
    return deepest


# The JSON text parser for vector inputs: duplicate keys refused (A1); negative zero kept so that
# A2 refuses it; NaN and Infinity are not JSON; numbers out of the double range refused (A2).
def parse_json_text(text):
    def members(pairs):
        obj = {}
        for k, v in pairs:
            if k in obj:
                raise Refused("A1", "a duplicate key")
            obj[k] = v
        return obj

    def integer(s):
        if s.lstrip("-").strip("0") == "" and s.startswith("-"):
            return -0.0
        return int(s)

    def fraction(s):
        f = float(s)
        if math.isinf(f):
            raise Refused("A2", "a number out of range")
        return f

    def constant(s):
        raise Refused("A1", "not JSON text (" + s + ")")

    try:
        value = json.loads(text, object_pairs_hook=members, parse_int=integer, parse_float=fraction, parse_constant=constant)
    except RecursionError:
        raise Refused("A1", "nested deeper than the parser allows")
    except ValueError as err:
        if isinstance(err, Refused):
            raise
        raise Refused("A1", "not JSON text")
    if _depth(value) > MAX_NESTING:
        raise Refused("A1", "nested deeper than the parser allows")
    return value


# A4: the top-level description only.
def normalize_description(d):
    check_string(d)
    text = d.replace("\r\n", "\n").replace("\r", "\n")
    text = "\n".join(line.rstrip(" \t\f\v") for line in text.split("\n"))
    return text.strip("\n")


# A5: the whole name must match.
def check_name(n):
    if not isinstance(n, str) or NAME.fullmatch(n) is None:
        raise Refused("A5", "a tool name outside the pattern")
    return n


# A7: distinct strings in UTF-16 order, or null.
def canonical_set(v):
    if v is None:
        return None
    if not isinstance(v, list) or not all(isinstance(x, str) for x in v):
        raise Refused("A7", "a set must be an array of strings or null")
    for x in v:
        check_string(x)
    return sorted(set(v), key=_utf16_key)


def _boolean(t, field):
    if not isinstance(t[field], bool):
        raise Refused("A6", field + " must be true or false")
    return t[field]


# A6, A8: the ten fields, all present, nothing else.
def canonical_tool_object(t):
    if not isinstance(t, dict):
        raise Refused("A6", "a tool must be an object")
    for field in PINNED_FIELDS:
        if field not in t:
            raise Refused("A8", "the field " + field + " is missing")
    for field in t:
        if field not in PINNED_FIELDS:
            raise Refused("A6", "the field " + field + " is not one of the ten")
    if not isinstance(t["description"], str):
        raise Refused("A6", "description must be a string")
    if not isinstance(t["input_schema"], dict):
        raise Refused("A6", "input_schema must be an object")
    if t["capability_class"] not in CAPABILITY_CLASSES or not isinstance(t["capability_class"], str):
        raise Refused("A5", "capability_class outside the four rungs")
    if not isinstance(t["scope"], str):
        raise Refused("A6", "scope must be a string")
    basis = t["recoverability_basis"]
    if basis is not None and not isinstance(basis, str):
        raise Refused("A6", "recoverability_basis must be a string or null")
    return {
        "name": check_name(t["name"]),
        "description": normalize_description(t["description"]),
        "input_schema": t["input_schema"],
        "capability_class": t["capability_class"],
        "untrusted_input_facing": _boolean(t, "untrusted_input_facing"),
        "scope": t["scope"],
        "privacy_sensitive": _boolean(t, "privacy_sensitive"),
        "recoverability_basis": basis,
        "elevated": _boolean(t, "elevated"),
        "containment_domain": canonical_set(t["containment_domain"]),
    }


def sha256(b):
    return hashlib.sha256(b).hexdigest()


def tool_hash(t):
    return sha256(canonical_bytes(canonical_tool_object(t)))


# A9, A10: {canonical_form_version, tools: [{name, tool_hash}] sorted by name}.
def canonical_manifest_bytes(m):
    version = m.get("canonical_form_version") if isinstance(m, dict) else None
    if isinstance(version, bool) or not isinstance(version, (int, float)) or version != CANONICAL_FORM_VERSION:
        raise Refused("A10", "a canonical_form_version this implementation does not implement")
    tools = m.get("tools")
    if not isinstance(tools, list):
        raise Refused("A9", "tools must be an array")
    entries = []
    for t in tools:
        obj = canonical_tool_object(t)
        entries.append({"name": obj["name"], "tool_hash": sha256(canonical_bytes(obj))})
    entries.sort(key=lambda e: _utf16_key(e["name"]))
    for a, b in zip(entries, entries[1:]):
        if a["name"] == b["name"]:
            raise Refused("A9", "two tools with one name")
    return canonical_bytes({"canonical_form_version": CANONICAL_FORM_VERSION, "tools": entries})


SPECIAL = {"NaN": float("nan"), "Infinity": float("inf"), "-Infinity": float("-inf")}


def evaluate(request):
    """The canonical bytes for one request, or Refused."""
    kind = request["kind"]
    if kind == "json":
        return canonical_bytes(parse_json_text(request["input_json_text"]))
    if kind == "json-special":
        return canonical_bytes(SPECIAL[request["input_special"]])
    value = request["input"]
    if kind == "description":
        if not isinstance(value, str):
            raise Refused("A4", "a description must be a string")
        return normalize_description(value).encode("utf-8")
    if kind == "name":
        return check_name(value).encode("utf-8")
    if kind == "set":
        return canonical_bytes(canonical_set(value))
    if kind == "tool":
        return canonical_bytes(canonical_tool_object(value))
    if kind == "manifest":
        return canonical_manifest_bytes(value)
    raise ValueError("unknown kind " + kind)


def answer(request):
    try:
        b = evaluate(request)
    except Refused as r:
        return {"ok": False, "rule": r.rule}
    return {"ok": True, "hex": b.hex(), "sha256": sha256(b)}


def serve():
    # Bytes in and out, so the platform's console encoding never touches the data.
    # Split on LF only: str.splitlines() would also split inside a string at U+2028 and others.
    for line in sys.stdin.buffer.read().decode("utf-8").split("\n"):
        if line.strip():
            sys.stdout.buffer.write((json.dumps(answer(json.loads(line)), ensure_ascii=True) + "\n").encode("ascii"))
    sys.stdout.buffer.flush()


if __name__ == "__main__":
    if sys.argv[1:] != ["serve"]:
        sys.stderr.write("usage: canonical_oracle.py serve\n")
        sys.exit(2)
    serve()
