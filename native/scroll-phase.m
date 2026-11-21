#import <Cocoa/Cocoa.h>
#include <node_api.h>

static id monitor = nil;
static napi_ref callback_ref = NULL;
static napi_env callback_env = NULL;

static void cleanup(void *data) {
  (void)data;
  if (monitor) { [NSEvent removeMonitor:monitor]; monitor = nil; }
  if (callback_ref && callback_env) napi_delete_reference(callback_env, callback_ref);
  callback_ref = NULL; callback_env = NULL;
}

static napi_value start(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1], result;
  napi_valuetype type;
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);
  if (argc != 1 || napi_typeof(env, args[0], &type) != napi_ok || type != napi_function) {
    napi_throw_type_error(env, NULL, "Expected callback"); return NULL;
  }
  cleanup(NULL);
  callback_env = env;
  napi_create_reference(env, args[0], 1, &callback_ref);
  monitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskScrollWheel handler:^NSEvent *(NSEvent *event) {
    // Local monitors see only this app's events and do not require global input access.
    // Momentum events have their own phase; finger-up arrives before momentum begins.
    if (event.momentumPhase != NSEventPhaseNone) return event;
    NSString *phase = nil;
    if (event.phase & NSEventPhaseBegan) phase = @"begin";
    else if (event.phase & NSEventPhaseCancelled) phase = @"cancel";
    else if (event.phase & NSEventPhaseEnded) phase = @"end";
    if (phase && callback_ref && callback_env) {
      napi_handle_scope scope;
      if (napi_open_handle_scope(callback_env, &scope) == napi_ok) {
        napi_value callback, arg, global;
        napi_get_reference_value(callback_env, callback_ref, &callback);
        napi_get_global(callback_env, &global);
        napi_create_string_utf8(callback_env, phase.UTF8String, NAPI_AUTO_LENGTH, &arg);
        napi_call_function(callback_env, global, callback, 1, &arg, NULL);
        napi_close_handle_scope(callback_env, scope);
      }
    }
    return event;
  }];
  napi_get_boolean(env, monitor != nil, &result);
  return result;
}

static napi_value init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "start", NAPI_AUTO_LENGTH, start, NULL, &fn);
  napi_set_named_property(env, exports, "start", fn);
  napi_add_env_cleanup_hook(env, cleanup, NULL);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
