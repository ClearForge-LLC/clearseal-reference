# /// script
# requires-python = ">=3.12"
# dependencies = ["cryptography==46.0.3"]
# ///
"""CSR-WO-0102 test oracle: generates the cross-language vectors for options A, B and C.

A TEST ORACLE, not a control (northstar N1 scope note): its only job is to produce, in a second
runtime, the bytes the TypeScript side is checked against (N3). It shares no code with the
TypeScript modules: every byte is built here by hand from the written contracts: WO section 1.1
for A, RFC 9421 and RFC 9530 for B, RFC 7515 for C. The key is the WO's fake fixture key;
nothing else is ever signed (N8). Every sender_id is synthetic (N6).

    uv run spikes/0102-envelope/oracle/gen_vectors.py           # rewrite spikes/0102-envelope/vectors/
    uv run spikes/0102-envelope/oracle/gen_vectors.py --check   # regenerate and compare, write nothing
"""

import base64
import hashlib
import json
import pathlib
import struct
import sys

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

SEED = bytes([0x00] * 8 + [0xD0] * 8 + [0x0D] * 8 + [0x00] * 8)
KEY = Ed25519PrivateKey.from_private_bytes(SEED)
PUBLIC_B64 = base64.b64encode(KEY.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)).decode()

OUT = pathlib.Path(__file__).resolve().parent.parent / "vectors"

# ---- the inputs every option signs ----

BASE = {
    "v": 1,
    "sender_id": "node.alerter-example",
    "origin_class": "system",
    "key_id": "test-fixture-key",
    "issued_at": 1787700000,
}

CASES = [
    ("minimal", "AAAABBBBCCCCDDDD", "info", "all clear"),
    # M5: a payload string ending in U+00A0 NO-BREAK SPACE; it must be signed, not stripped.
    ("m5-nbsp", "AAAABBBBCCCCDDD1", "info", "all clear "),
    # M5: U+00E9 precomposed, and "e" followed by U+0301 COMBINING ACUTE ACCENT. They render the
    # same; they are different strings, and each must be signed as given, never normalized.
    ("m5-composed", "AAAABBBBCCCCDDD2", "warn", "café"),
    ("m5-decomposed", "AAAABBBBCCCCDDD3", "warn", "café"),
]


def inputs(nonce, severity, text):
    return {**BASE, "nonce": nonce, "alert": {"severity": severity, "text": text}}


def compact_json(obj):
    """UTF-8 JSON with no whitespace and no \\u escaping of non-ASCII: the bytes both sides emit."""
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def spaced_hex(b):
    return " ".join(f"{x:02x}" for x in b)


def b64(b):
    return base64.b64encode(b).decode()


def b64url(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


# ---- option A: the field contract (WO section 1.1) ----

A_CONTEXT = b"ClearSeal/M6-alert-envelope/v1\x00"


def a_canonical(i):
    fields = [str(i["v"]), i["sender_id"], i["origin_class"], i["key_id"], str(i["issued_at"]), i["nonce"],
              i["alert"]["severity"], i["alert"]["text"]]
    out = bytearray(A_CONTEXT)
    for f in fields:
        b = f.encode("utf-8")  # strict: a lone surrogate raises here
        out += struct.pack(">I", len(b)) + b
    return bytes(out)


def option_a(i):
    canonical = a_canonical(i)
    signature = b64(KEY.sign(canonical))
    envelope = {k: i[k] for k in ("v", "sender_id", "origin_class", "key_id", "issued_at", "nonce", "alert")}
    wire = compact_json({"envelope": envelope, "signature": signature})
    return {"signed_bytes_b64": b64(canonical), "signed_len": len(canonical), "wire_b64": b64(wire), "wire_len": len(wire)}


# ---- option B: RFC 9421 over a POST with a JSON body ----

B_TARGET_HOST = "receiver.example"
B_TARGET_PATH = "/v1/provenance"
B_LABEL = "sig1"
B_TAG = "clearseal-class5-v1"
B_COMPONENTS = ["@method", "@authority", "@path", "content-type", "content-digest"]


def body(i):
    return compact_json({"v": i["v"], "sender_id": i["sender_id"], "origin_class": i["origin_class"], "alert": i["alert"]})


def option_b(i):
    payload = body(i)
    digest = f"sha-256=:{b64(hashlib.sha256(payload).digest())}:"
    # RFC 9421 section 2.3: the inner list of covered components, then parameters, serialized per
    # RFC 8941 (sf-string for text, sf-integer for times).
    params = (
        "(" + " ".join(f'"{c}"' for c in B_COMPONENTS) + ")"
        + f";created={i['issued_at']};expires={i['issued_at'] + 300}"
        + f';nonce="{i["nonce"]}";keyid="{i["key_id"]}";alg="ed25519";tag="{B_TAG}"'
    )
    values = {
        "@method": "POST",
        "@authority": B_TARGET_HOST,
        "@path": B_TARGET_PATH,
        "content-type": "application/json",
        "content-digest": digest,
    }
    # RFC 9421 section 2.5: one line per component, "@signature-params" last, LF, no trailing LF.
    base = "\n".join([f'"{c}": {values[c]}' for c in B_COMPONENTS] + [f'"@signature-params": {params}'])
    signature = KEY.sign(base.encode("ascii"))
    headers = [
        ["content-type", "application/json"],
        ["content-digest", digest],
        ["Signature", f"{B_LABEL}=:{b64(signature)}:"],
        ["Signature-Input", f"{B_LABEL}={params}"],
    ]
    lines = [f"POST {B_TARGET_PATH} HTTP/1.1", f"Host: {B_TARGET_HOST}"]
    lines += [f"{n}: {v}" for n, v in headers] + [f"Content-Length: {len(payload)}", "", ""]
    wire = "\r\n".join(lines).encode("ascii") + payload
    return {
        "signed_bytes_b64": b64(base.encode("ascii")),
        "signed_len": len(base),
        "request": {"method": "POST", "url": f"https://{B_TARGET_HOST}{B_TARGET_PATH}", "headers": headers, "body_b64": b64(payload)},
        "wire_b64": b64(wire),
        "wire_len": len(wire),
    }


# ---- option C: detached JWS, EdDSA ----

C_TYP = "clearseal-class5+jws"


def option_c(i):
    payload = body(i)
    header = {"alg": "EdDSA", "typ": C_TYP, "kid": i["key_id"], "iat": i["issued_at"], "exp": i["issued_at"] + 300, "jti": i["nonce"]}
    h = b64url(compact_json(header))
    signing_input = f"{h}.{b64url(payload)}".encode("ascii")
    s = b64url(KEY.sign(signing_input))
    jws = f"{h}..{s}"
    wire = f"{jws}\n".encode("ascii") + payload
    return {
        "signed_bytes_b64": b64(signing_input),
        "signed_len": len(signing_input),
        "jws": jws,
        "payload_b64": b64(payload),
        "wire_b64": b64(wire),
        "wire_len": len(wire),
    }


def generate():
    files = {}
    for name, fn in (("option-a", option_a), ("option-b", option_b), ("option-c", option_c)):
        vectors = []
        for case, nonce, severity, text in CASES:
            i = inputs(nonce, severity, text)
            vectors.append({
                "name": case,
                "input": i,
                "now": i["issued_at"],
                "text_utf8": spaced_hex(text.encode("utf-8")),
                **fn(i),
            })
        doc = {
            "oracle": "spikes/0102-envelope/oracle/gen_vectors.py (Python test oracle; not a control)",
            "fixture_public_key_b64": PUBLIC_B64,
            "vectors": vectors,
        }
        files[f"{name}.json"] = json.dumps(doc, indent=2, ensure_ascii=True) + "\n"
    return files


def main():
    files = generate()
    if "--check" in sys.argv[1:]:
        stale = [n for n, text in files.items() if not (OUT / n).exists() or (OUT / n).read_text(encoding="utf-8") != text]
        for n in sorted(files):
            print(f"{'DIFFERS' if n in stale else 'same   '} {n} sha256={hashlib.sha256(files[n].encode()).hexdigest()[:16]}")
        sys.exit(1 if stale else 0)
    OUT.mkdir(exist_ok=True)
    for n, text in files.items():
        (OUT / n).write_text(text, encoding="utf-8", newline="\n")
        print(f"wrote {n}")


if __name__ == "__main__":
    main()
