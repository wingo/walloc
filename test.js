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

class LinearMemory {
    constructor({initial = 256, maximum = 256}) {
        this.memory = new WebAssembly.Memory({ initial, maximum });
    }
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

let bytes = readBinaryFile("test.wasm", "binary");
let mod = new WebAssembly.Module(bytes);
let memory = new LinearMemory({ initial: 2, maximum: 256 });
let imports = { env: memory.env() }
let instance = new WebAssembly.Instance(mod, imports);
let {walloc, wfree} = instance.exports;

for (let j = 0; j < 40; j++) {
    let allocs = [];
    for (let i = 0; i < 2000; i++) {
        allocs.push(walloc(i));
    }
    for (let o of allocs) {
        wfree(o)
    }
}
