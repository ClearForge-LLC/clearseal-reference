// What an approver sees (CSR-WO-2001 red-team amendment; approval/RULES.md APR-18, APR-19). Every code
// point that renders as nothing, reorders the text around it, or controls a terminal is shown as a
// visible `\u{XXXX}` escape, so the call an approver reads is the call that runs.

/**
 * The classes escaped: controls (C0, DEL, C1: `Cc`), format characters (`Cf`: the bidi controls, the
 * zero-width characters, the byte-order mark, the tag characters), the line and paragraph separators
 * (`Zl`, `Zp`), lone surrogates (`Cs`), and every other default-ignorable code point (variation
 * selectors, the Hangul fillers). Escaping too much only makes a view longer; escaping too little can
 * hide or reorder what an approver reads.
 */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}\p{Default_Ignorable_Code_Point}]/gu;

/** `text` with every invisible or control code point shown as `\u{XXXX}`; anything else unchanged. */
export function visible(text: string): string {
  return text.replace(INVISIBLE, (c) => `\\u{${(c.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}}`);
}
