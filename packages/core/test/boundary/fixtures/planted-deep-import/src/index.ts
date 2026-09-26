// A planted edition (CSR-WO-1004 §1.5 red-proof b): it imports the core's transport by a relative
// path into packages/core/src instead of through the package entry.

import { startTransport } from "../../../../../src/transport/server.ts";

export const start = startTransport;
