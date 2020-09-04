typedef __SIZE_TYPE__ size_t;
typedef __UINTPTR_TYPE__ uintptr_t;

#define WASM_EXPORT(name) \
  __attribute__((export_name(#name))) \
  name
#define WASM_IMPORT(name) \
  __attribute__((import_module("env"))) \
  __attribute__((import_name(#name))) \
  name

// Debugging helpers.
void WASM_IMPORT(wasm_log)(const char*);
void WASM_IMPORT(wasm_log_i)(const char*, int);
static void wasm_log_p(const char *str, void* p) {
  wasm_log_i(str, (uintptr_t) p);
}

// Pull these in from walloc.c.
void *malloc(size_t size);
void free(void *p);
                          
void* WASM_EXPORT(walloc)(size_t size) {
  wasm_log_i("walloc bytes", size);
  void *ret = malloc(size);
  wasm_log_p("allocated ptr", ret);
  return ret;
}

void WASM_EXPORT(wfree)(void* ptr) {
  wasm_log_p("wfree ptr", ptr);
  free(ptr);
}
