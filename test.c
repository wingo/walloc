typedef __SIZE_TYPE__ size_t;

#define WASM_EXPORT(name) \
  __attribute__((export_name(#name))) \
  name

// Pull these in from walloc.c.
void *malloc(size_t size);
void free(void *p);
                          
void* WASM_EXPORT(walloc)(size_t size) {
  return malloc(size);
}

void WASM_EXPORT(wfree)(void* ptr) {
  free(ptr);
}
