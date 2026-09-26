"""Regenerates packages/core/test/vectors/canonical-v1.json from the oracle.

This is the only writer of that file (N3): every expected result in it is computed here by
canonical_oracle.py, the Python implementation. CI runs this script and fails on any difference
from the committed file, so the file and the oracle cannot drift apart unnoticed.

The inputs and notes below are the vectors of docs/canonical-form.md, rule by rule.

Usage: python generate.py   (writes the file next to the repository's vectors directory)
"""

import json
import os
import sys

sys.dont_write_bytecode = True  # no __pycache__ beside a committed file
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import canonical_oracle as oracle  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, "vectors", "canonical-v1.json")

ECHO = {
    "name": "echo",
    "description": "Returns its text.",
    "input_schema": {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"], "additionalProperties": False},
    "capability_class": "read_only",
    "untrusted_input_facing": False,
    "scope": "echo",
    "privacy_sensitive": False,
    "recoverability_basis": None,
    "elevated": False,
    "containment_domain": None,
}
NOTE = {
    "name": "note.append",
    "description": "Appends one line to the operator's notes.\nNever rewrites earlier lines.",
    "input_schema": {"type": "object", "properties": {"line": {"type": "string", "maxLength": 500}}, "required": ["line"], "additionalProperties": False},
    "capability_class": "owned_state",
    "untrusted_input_facing": True,
    "scope": "notes",
    "privacy_sensitive": True,
    "recoverability_basis": "append-only",
    "elevated": False,
    "containment_domain": ["notes-file"],
}


def with_(tool, **changes):
    t = dict(tool)
    t.update(changes)
    return t


def without(tool, field):
    return {k: v for k, v in tool.items() if k != field}


V = []


def json_case(id, rule, text, note):
    V.append({"id": id, "rule": rule, "kind": "json", "input_json_text": text, "note": note})


def case(id, rule, kind, value, note):
    V.append({"id": id, "rule": rule, "kind": kind, "input": value, "note": note})


# A1
json_case("A1-1", "A1", ' { "b" : [3, 1, 2], "a" : { "d" : 1, "c" : 2 } } ', "Insignificant whitespace removed; keys sorted at every level; array order kept.")
json_case("A1-2", "A1", '{"\\ufb01":1,"\\ud83d\\ude00":2}', "Keys sort by UTF-16 code units: U+1F600 (D83D DE00) sorts before U+FB01. Code-point order, the fleet Python's, puts U+FB01 first.")
json_case("A1-3", "A1", '{"9":1,"10":2,"a":3,"B":4}', 'Keys are strings, sorted as strings: "10" before "9", upper case before lower.')
json_case("A1-4", "A1", '["\\u0000\\b\\t\\n\\f\\r\\u001f\\"\\\\\\/\\u007f\\u2028\\u00e9"]', "String escapes: the five short forms, \\u00XX in lower-case hex for other controls, quote and backslash escaped; solidus, U+007F, U+2028 and non-ASCII emitted raw as UTF-8.")
json_case("A1-5", "A1", '{"a":1,"a":2}', "A duplicate key is refused: JCS requires I-JSON, which has none.")
json_case("A1-6", "A1", "[true,false,null,{},[]]", "Literals and empty containers are emitted as given.")
# A2
json_case("A2-1", "A2", "1.0", '1.0 is the number one: "1".')
json_case("A2-2", "A2", "1e21", "Refused: magnitude over 2^53-1 (every such double is integral, so this is the prior's integer bound). JCS's positive-exponent form is therefore unreachable.")
json_case("A2-3", "A2", "1e-7", 'Below 1e-6 the ECMAScript form uses an exponent: "1e-7".')
json_case("A2-4", "A2", "0.30000000000000004", "0.1+0.2: the shortest round-trip digits, never rounded for display.")
json_case("A2-5", "A2", "0.000001", "At 1e-6 the ECMAScript form is still positional.")
json_case("A2-6", "A2", '{"multipleOf":0.01}', "A schema number of the kind the rule exists for.")
json_case("A2-7", "A2", "9007199254740991", "2^53-1, the largest accepted magnitude.")
json_case("A2-8", "A2", "9007199254740992", "2^53: refused.")
json_case("A2-9", "A2", "-0", 'Negative zero is refused (JCS would print it as "0"; two inputs, one hash).')
json_case("A2-10", "A2", "-0.0", "Negative zero written as a fraction: refused too.")
json_case("A2-11", "A2", "1E2", 'Exponent input, integral value: "100".')
json_case("A2-12", "A2", "12.50", 'Trailing zeros are not significant: "12.5".')
for i, special in enumerate(["NaN", "Infinity", "-Infinity"]):
    V.append({"id": "A2-%d" % (13 + i), "rule": "A2", "kind": "json-special", "input_special": special, "note": "Not a JSON value; a native value that reaches the canonicalizer is refused."})
# A3
json_case("A3-1", "A3", '"\\u00e9"', "Composed e-acute (NFC).")
json_case("A3-2", "A3", '"e\\u0301"', "Decomposed e-acute (NFD): different bytes and a different hash from A3-1. No normalization.")
json_case("A3-3", "A3", '"\\ufeffabc"', "A string that begins with U+FEFF is refused, not stripped.")
json_case("A3-4", "A3", '"a\\ufeffb"', "U+FEFF inside a string is preserved (bytes as given).")
json_case("A3-5", "A3", '"\\ud800"', "A lone surrogate is refused.")
json_case("A3-6", "A3", '{"\\udc00":1}', "A lone surrogate in a key is refused.")
json_case("A3-7", "A3", '"\\ud83d\\ude00"', "A well-formed surrogate pair is one code point, emitted as 4 bytes of UTF-8.")
# A4
case("A4-1", "A4", "description", "Reads a file. ", "M5: a trailing U+00A0 is preserved.")
case("A4-2", "A4", "description", "line one\r\nline two\rline three", "CRLF and a lone CR become LF.")
case("A4-3", "A4", "description", "a \t\f\u000b\nb", "Trailing space, tab, form feed and vertical tab are stripped per line.")
case("A4-4", "A4", "description", "\n\n  \nText\n\n\nMore\n\n", "Leading and trailing newlines stripped (after the per-line strip); internal blank lines kept.")
case("A4-5", "A4", "description", "one two ", "U+2028 is neither a line break nor strippable here: preserved.")
case("A4-6", "A4", "description", "  indented　", "Leading spaces and a trailing U+3000 are preserved.")
case("A4-7", "A4", "description", "\n\n\n", "Only newlines: the empty string.")
case("A4-8", "A4", "tool", with_(ECHO, description="Echo.  ", input_schema={"type": "object", "properties": {"text": {"type": "string", "description": "Text.  "}}}), "Only the top-level description is normalized: its trailing spaces go; the schema's inner description keeps them.")
# A5
for id, name, note in [
    ("A5-1", "echo", "Accepted."),
    ("A5-2", "Echo", "Upper case refused."),
    ("A5-3", "note.append_v2-x", "Dot, underscore and hyphen allowed after the first character."),
    ("A5-4", "_hidden", "Must begin with a lower-case letter or digit."),
    ("A5-5", "z" * 64, "64 characters: accepted."),
    ("A5-6", "z" * 65, "65 characters: refused."),
    ("A5-7", "écho", "Non-ASCII refused."),
    ("A5-8", "echo\n", "A trailing newline is refused: the pattern must match the whole string (an end anchor that also matches before a final newline is the trap)."),
]:
    case(id, "A5", "name", name, note)
# A6
case("A6-1", "A6", "tool", ECHO, "The ten-field object, keys in JCS order; sha256 is tool_hash.")
case("A6-2", "A6", "tool", with_(ECHO, title="Echo"), "A field outside the ten is refused, not dropped.")
case("A6-3", "A6", "tool", with_(ECHO, elevated="false"), "A boolean field given a string is refused: no truthiness coercion.")
case("A6-4", "A6", "tool", with_(ECHO, capability_class="admin"), "capability_class outside the four rungs is refused.")
# A7
case("A7-1", "A7", "set", ["b", "a", "b", "B"], "Deduplicated, sorted by UTF-16 code units, case preserved.")
case("A7-2", "A7", "set", [], "The empty set: contained to nothing. Distinct from null.")
case("A7-3", "A7", "set", None, "null: no containment claimed.")
case("A7-4", "A7", "set", ["ﬁ", "\U0001F600"], "UTF-16 order, as A1-2.")
json_case("A7-5", "A7", '{"required":["b","a"],"enum":[2,1]}', "Arrays inside input_schema are not sets: order kept.")
# A8
json_case("A8-1", "A8", '{"type":"object"}', "Absent.")
json_case("A8-2", "A8", '{"type":"object","default":null}', "null.")
json_case("A8-3", "A8", '{"type":"object","default":{}}', "Empty object.")
json_case("A8-4", "A8", '{"type":"object","default":[]}', "Empty array. Four inputs, four hashes.")
case("A8-5", "A8", "tool", without(ECHO, "containment_domain"), "A top-level field that is absent is refused: all ten are always present, null where they do not apply.")
# A9, A10
case("A9-1", "A9", "tool", NOTE, "The second tool; sha256 is its tool_hash.")
case("A9-2", "A9", "manifest", {"canonical_form_version": 1, "tools": [NOTE, ECHO]}, "Two tools given out of order: entries sorted by name; sha256 is manifest_hash.")
case("A9-3", "A9", "manifest", {"canonical_form_version": 1, "tools": [ECHO, with_(NOTE, name="echo")]}, "Two tools with one name: refused.")
case("A10-1", "A10", "manifest", {"canonical_form_version": 2, "tools": [ECHO]}, "A version this implementation does not implement is refused.")
case("A10-2", "A10", "manifest", {"canonical_form_version": 1, "tools": [ECHO]}, "The version is inside the manifest hash.")


def build():
    vectors = []
    for v in V:
        entry = {k: v[k] for k in ("id", "rule", "kind") if k in v}
        for k in ("input_json_text", "input_special", "input"):
            if k in v:
                entry[k] = v[k]
        result = oracle.answer(v)
        if result["ok"]:
            entry["expect"] = "canonical"
            entry["canonical_hex"] = result["hex"]
            entry["sha256"] = result["sha256"]
        else:
            entry["expect"] = "refuse"
        entry["note"] = v["note"]
        vectors.append(entry)
    return {
        "canonical_form_version": oracle.CANONICAL_FORM_VERSION,
        "specification": "docs/canonical-form.md",
        "status": "Ratified 2026-09-26 (CSR-WO-1000 stage A, deltas D-1 and D-2 adopted). This file is written only by the Python oracle's generator (packages/core/test/oracle/); CI regenerates it and fails on any difference. The TypeScript canonicalizer is checked against it, never the reverse.",
        "format": {
            "canonical_hex": "the canonical bytes as lower-case hex",
            "sha256": "SHA-256 of the canonical bytes as lower-case hex",
            "expect": "canonical: the input canonicalizes to canonical_hex; refuse: a conforming implementation refuses the input and produces no bytes",
            "kinds": {
                "json": "input_json_text is JSON text; parse it (duplicate keys and negative zero must be detectable at parse time), then canonicalize the value (A1-A3)",
                "json-special": "input_special names a native number with no JSON form (NaN, Infinity, -Infinity) handed to the canonicalizer as a value",
                "description": "input is a description string; the canonical bytes are the UTF-8 of the normalized string (A4), not a JSON string",
                "name": "input is a tool name; the canonical bytes are its UTF-8 when accepted (A5)",
                "set": "input is a set-valued field's value; the canonical bytes are the JCS of the canonical array or null (A7)",
                "tool": "input is a tool's ten fields; the canonical bytes are the JCS of the canonical tool object, and sha256 is tool_hash (A6, A9)",
                "manifest": "input is {canonical_form_version, tools}; the canonical bytes are the JCS of the manifest hash object, and sha256 is manifest_hash (A9, A10)",
            },
        },
        "vectors": vectors,
    }


if __name__ == "__main__":
    text = json.dumps(build(), ensure_ascii=True, indent=2) + "\n"
    with open(OUT, "w", encoding="ascii", newline="\n") as f:
        f.write(text)
    print("wrote packages/core/test/vectors/canonical-v1.json: %d vectors" % len(V))
