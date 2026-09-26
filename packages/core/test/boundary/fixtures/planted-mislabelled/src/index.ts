// A planted edition: exports whose declared kind does not fit, a kind the core does not define yet,
// and an export it never declared. No control is carried, so only the kind rules can catch it.

export const definitions = [{ name: "x" }];

export const notifier = { notify: (): void => undefined };

export const extra = "an undeclared export";
