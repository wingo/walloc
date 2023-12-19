all: test

CC?=clang
LD?=wasm-ld
AR?=llvm-ar
RANLIB?=llvm-ranlib
JS?=node

.PHONY: test

test: test.js test.wasm
	$(JS) $<

%.o: %.c
	$(CC) -DNDEBUG -Oz --target=wasm32 -nostdlib -c -o $@ $<

test.wasm: test.o walloc.o
	$(LD) --no-entry --import-memory -o $@ $^

libwalloc.a: walloc.o
	$(AR) rc $@ $<
	$(RANLIB) $@

.PHONY: clean
clean:
	rm -f *.o *.a *.wasm
