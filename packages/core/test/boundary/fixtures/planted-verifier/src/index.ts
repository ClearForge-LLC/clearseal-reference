// A planted edition (CSR-WO-1004 §1.5 red-proof a): it exports a verifier of its own, declared as a
// deploy scaffold. The supply-boundary test must go red on it.

export const verifier = {
  verify: (): Promise<{ ok: true; principal: { id: string } }> => Promise.resolve({ ok: true, principal: { id: "anyone" } }),
};

export function start(): void {
  // A scaffold that does nothing: the verifier above is the violation.
}
