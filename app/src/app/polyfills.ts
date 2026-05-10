import { Buffer } from "buffer";
if (typeof window !== "undefined") {
  (window as any).Buffer = Buffer;
  (globalThis as any).Buffer = Buffer;
}
