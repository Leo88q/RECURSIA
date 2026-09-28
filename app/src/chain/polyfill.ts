import { Buffer } from "buffer";
// Some wallet-adapter internals expect a global Buffer. Only loaded with live mode.
(globalThis as unknown as { Buffer: typeof Buffer }).Buffer ??= Buffer;
