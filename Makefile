all: test

CC?=clang
LD?=wasm-ld
JS?=node

.PHONY: test

test: test.js test.wasm
	$(JS) $<

%.o: %.c
	$(CC) -DNDEBUG -Oz --target=wasm32 -nostdlib -c -o $@ $<

test.wasm: test.o walloc.o
	$(LD) --no-entry --import-memory -o $@ $^

.PHONY: clean
clean:
	rm -f *.o *.wasm
