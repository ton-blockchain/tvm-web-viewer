import { Buffer } from "buffer";

globalThis.Buffer = Buffer;

// polyfill for process
if (typeof globalThis.process === 'undefined') {
    globalThis.process = {
        env: {},
        version: '',
        versions: {},
        nextTick: (fn: Function, ...args: any[]) => setTimeout(() => fn(...args), 0),
    } as any;
}
