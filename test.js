if (typeof read !== 'undefined') {
    function readBinaryFile(f) { return read(f, 'binary'); }
} else if (typeof readFile !== 'undefined') {
    function readBinaryFile(f) { return readFile(f); }
} else if (typeof require !== 'undefined') {
    let fs = require('fs');
    function readBinaryFile(f) { return fs.readFileSync(f); }
} else {
    throw "no way to read a binary file";
}

function assert(c, msg) { if (!c) throw new Error(msg); }
function power_of_two(x) { return x && (x & (x - 1)) == 0; }
function assert_power_of_two(x) {
    assert(power_of_two(x), `not power of two: ${x}`);
}
function aligned(x, y) {
    assert_power_of_two(y);
    return (x & (y - 1)) == 0;
}
function assert_aligned(x, y) {
    assert(aligned(x, y), `bad alignment: ${x} % ${y}`);
}
function round_up(x, y) {
    assert_power_of_two(y);
    return (x + y - 1) & ~(y - 1);
}

let granule_size = 8;
let bits_per_byte = 8;
let bits_per_byte_log2 = 3;

class HeapVerifier {
    constructor(maxbytes) {
        this.maxwords = maxbytes / granule_size;
        this.state = new Uint8Array(this.maxwords / bits_per_byte);
        this.allocations = new Map;
    }
    acquire(offset, len) {
        assert_aligned(offset, granule_size);
        for (let i = 0; i < len; i += granule_size) {
            let bit = (offset + i) / granule_size;
            let byte = bit >> bits_per_byte_log2;
            let mask = 1 << (bit & (bits_per_byte - 1));
            assert((this.state[byte] & mask) == 0, "word in use");
            this.state[byte] |= mask;
        }
        this.allocations.set(offset, len);
    }
    release(offset) {
        assert(this.allocations.has(offset))
        let len = this.allocations.get(offset);
        this.allocations.delete(offset);
        for (let i = 0; i < len; i += granule_size) {
            let bit = (offset + i) / granule_size;
            let byte = bit >> bits_per_byte_log2;
            let mask = 1 << (bit & (bits_per_byte - 1));
            this.state[byte] &= ~mask;
        }
    }
}

class LinearMemory {
    constructor({initial = 256, maximum = 256}) {
        this.memory = new WebAssembly.Memory({ initial, maximum });
        this.verifier = new HeapVerifier(maximum * 65536);
    }
    record_malloc(ptr, len) { this.verifier.acquire(ptr, len); }
    record_free(ptr) { this.verifier.release(ptr); }
    read_string(offset) {
        let view = new Uint8Array(this.memory.buffer);
        let bytes = []
        for (let byte = view[offset]; byte; byte = view[++offset])
            bytes.push(byte);
        return String.fromCharCode(...bytes);
    }
    log(str)      { console.log(`wasm log: ${str}`) }
    log_i(str, i) { console.log(`wasm log: ${str}: ${i}`) }
    env() {
        return {
            memory: this.memory,
            wasm_log: (off) => this.log(this.read_string(off)),
            wasm_log_i: (off, i) => this.log_i(this.read_string(off), i)
        }
    }
}

function randu(x, max) { return Math.floor(x * max); }
function sys_rand32() { return randu(Math.random(), 2**32); }
function xoshiro128ss(a, b, c, d) {
    console.log(`Seeding RNG with [${a}, ${b}, ${c}, ${d}].`)
    return function() {
        var t = b << 9, r = a * 5; r = (r << 7 | r >>> 25) * 9;
        c ^= a; d ^= b;
        b ^= c; a ^= d; c ^= t;
        d = d << 11 | d >>> 21;
        return (r >>> 0) / 4294967296;
    }
}
let rand = xoshiro128ss(sys_rand32(), sys_rand32(), sys_rand32(),
                        sys_rand32());

let bytes = readBinaryFile("test.wasm", "binary");
let mod = new WebAssembly.Module(bytes);
let memory = new LinearMemory({ initial: 2, maximum: 256 });
let imports = { env: memory.env() }
let instance = new WebAssembly.Instance(mod, imports);
let {walloc, wfree} = instance.exports;

for (let j = 0; j < 40; j++) {
    let allocs = [];
    console.log(`Allocating 2 MB, iteration ${j}.`)
    let count = 0;
    for (let allocated = 0; allocated < 2e6; count++) {
        let size = randu(rand(), 2000);
        let free_priority = rand();
        let ptr = walloc(size);
        assert((ptr % 8) == 0, "unaligned result");
        memory.record_malloc(ptr, size);
        allocs.push([free_priority, ptr]);
        allocated += size;
    }
    console.log(`Freeing ${count} allocations.`)
    allocs.sort(([p1,ptr1], [p2,ptr2]) => (p1 - p2));
    for (let [p, ptr] of allocs) {
        memory.record_free(ptr);
        wfree(ptr)
    }
}
console.log(`Success.`)
