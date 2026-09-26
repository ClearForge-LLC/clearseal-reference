// The part of oidc-provider's API the dev harness uses, declared here rather than adding
// @types/oidc-provider and its tree for one file that is not part of the product.
declare module "oidc-provider" {
  import type { IncomingMessage, ServerResponse } from "node:http";

  export default class Provider {
    constructor(issuer: string, configuration: Record<string, unknown>);
    callback(): (req: IncomingMessage, res: ServerResponse) => void;
  }
}
