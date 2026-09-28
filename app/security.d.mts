type Env = Record<string, string | undefined>;
export function rpcOrigins(env?: Env): string[];
export function buildCsp(env?: Env, opts?: { meta?: boolean }): string;
export function securityHeaders(env?: Env): Record<string, string>;
export function headersFile(env?: Env): string;
