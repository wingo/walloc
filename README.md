# walloc

walloc is a bare-bones implementation of `malloc` for use by C
programs when targetting WebAssembly.  It is a single-file
implementation with no dependencies: no stdlib, no JavaScript imports,
no emscripten.

Emscripten includes a couple of good malloc implementations; perhaps
consider using one of those?  But if you are really looking for a
bare-bones malloc, walloc is fine.

## Test

```
$ make CC=$LLVM/clang LD=$LLVM/wasm-ld JS=node test
clang -DNDEBUG -Oz --target=wasm32 -nostdlib -c -o test.o test.c
clang -DNDEBUG -Oz --target=wasm32 -nostdlib -c -o walloc.o walloc.c
wasm-ld --no-entry --import-memory -o test.wasm test.o walloc.o
node test.js
node test.js
wasm log: walloc bytes: 0
wasm log: allocated ptr: 131328
wasm log: walloc bytes: 1
wasm log: allocated ptr: 131336
wasm log: walloc bytes: 2
wasm log: allocated ptr: 131344
wasm log: walloc bytes: 3
wasm log: allocated ptr: 131352
wasm log: walloc bytes: 4
wasm log: allocated ptr: 131360
...
```

You can link `walloc.c` into your program just by adding it to your link
line, as above.

## Size

The resulting wasm file is about 1.5 kB.

## Design

When a C program is compiled to WebAssembly, the resulting wasm module
(usually) has associated linear memory.  It can be compiled in a way
that the memory is created by the module when it's instantiated, or such
that the module is given a memory by its host.  By default, wasm modules
import their memory.

The linear memory has the usual data, stack, and heap segments.  The
data and stack are placed first.  The heap starts at the `&__heap_base`
symbol.  All bytes above `&__heap_base` can be used by the wasm program
as it likes.  So `&__heap_base` is the lower bound of memory managed by
walloc.

```
                                              memory growth ->
+----------------+-----------+-------------+-------------+----
| data and stack | alignment | walloc page | walloc page | ...
+----------------+-----------+-------------+-------------+----
^ 0              ^ &__heap_base            ^ 64 kB aligned
```

The upper bound of memory managed by walloc is the total size of the
memory, which is aligned on 64-kilobyte boundaries.  (WebAssembly
ensures this alignment.)  Walloc manages memory in 64-kb pages as well.
It starts with whatever memory is initially given to the module, and
will expand the memory if it runs out.  The host can specify a maximum
memory size, in pages; if no more pages are available, walloc's `malloc`
will simply return `NULL`; handling out-of-memory is up to the caller.

If you really care about the allocator's design, probably you should use
some other allocator whose characteristics are more well known!

That said, walloc has two allocation strategies: small and large
objects.

### Large objects

A large object is more than 256 bytes.

There is a global freelist of available large objects, each of which has
a header indicating its size.  When allocating, walloc does a best-fit
search through that list.  

```c
struct large_object {
  struct large_object *next;
  size_t size;
  char payload[0];
};
struct large_object* large_object_free_list;
```

Large object allocations are rounded up to 256-byte boundaries,
including the header.

If there is no object on the freelist that can satisfy an allocation,
walloc will expand the heap by the size of the allocation, or by half of
the current walloc heap size, whichever is larger.  The resulting page
or pages form a large object that can satisfy the allocation.

If the best object on the freelist has more than a chunk of space on the
end, it is split, and the tail put back on the freelist.  A chunk is 256
bytes.

```
+-------------+---------+---------+-----+-----------+
| page header | chunk 1 | chunk 2 | ... | chunk 255 |
+-------------+---------+---------+-----+-----------+
^ +0          ^ +256    ^ +512                      ^ +64 kB
```

So each page is 65536 bytes, and each chunk is 256 bytes, meaning there
are 256 chunks in a page.  So the first chunk in a page that begins an
allocated object, large or small, contains a header chunk.  The page
header has a byte for each chunk in the page.  The byte is 255 if the
corresponding chunk starts a large object; otherwise the byte indicates
the size class for packed small-object allocations (see below).

```
+-------------+---------+---------+----------+-----------+
| page header | large object 1    | large object 2 ...   |
+-------------+---------+---------+----------+-----------+
^ +0          ^ +256    ^ +512                           ^ +64 kB
```

When splitting large objects, we avoid starting a new large object on a
page header chunk.  A large object can only span where a page header
chunk would be if it includes the entire page.

Freeing a large object pushes it on the global freelist.  We know a
pointer is a large object by looking at the page header.  We know the
size of the allocation, because the large object header precedes the
allocation.  When the next large object allocation happens after a free,
the freelist will be compacted by merging adjacent large objects.

### Small objects

Small objects are allocated from segregated freelists.  The granule size
is 8 bytes.  Small object allocations are packed in a chunk of uniform
allocation size.  There are size classes for allocations of each size
from 1 to 6 granules, then 8, 10, 16, and 32 granules; 10 sizes in all.
For example, an allocation of e.g. 12 granules will be satisfied from a
16-granule chunk.  Each size class has its own free list.

```c
struct small_object_freelist {
  struct small_object_freelist *next;
};
struct small_object_freelist small_object_freelists[10];
```

When allocating, if there is nothing on the corresponding freelist,
walloc will allocate a new large object, then change its chunk kind in
the page header to the size class.  It then goes through the fresh
chunk, threading the objects through each other onto a free list.

```
+-------------+---------+---------+------------+---------------------+
| page header | large object 1    | granules=4 | large object 2' ... |
+-------------+---------+---------+------------+---------------------+
^ +0          ^ +256    ^ +512    ^ +768       + +1024              ^ +64 kB
```

In this example, we imagine that the 4-granules freelist was empty, and
that the large object freelist contained only large object 2, running
all the way to the end of the page.  We allocated a new 4-granules
chunk, splitting the first chunk off the large object, and pushing the
newly trimmed large object back onto the large object freelist, updating
the page header appropriately.  We then thread the 4-granules (32-byte)
allocations in the fresh chunk together (the chunk has room for 8 of
them), treating them as if they were instances of `struct freelist`,
pushing them onto the global freelist for 4-granules allocations.

```
           in fresh chunk, next link for object N points to object N+1
                                 /--------\                     
                                 |        |
            +------------------+-^--------v-----+----------+
granules=4: | (padding, maybe) | object 0 | ... | object 7 |
            +------------------+----------+-----+----------+
                               ^ 4-granule freelist now points here 
```

The size classes were chosen so that any wasted space (padding) is less
than the size class.

Freeing a small object pushes it back on its size class's free list.
Given a pointer, we know its size class by looking in the chunk kind in
the page header.

## License

`walloc` is available under a permissive MIT-style license.  See
[LICENSE.md](./LICENSE.md) for full details.
