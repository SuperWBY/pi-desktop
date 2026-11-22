#import <AVFoundation/AVFoundation.h>
#import <Speech/Speech.h>
#import <Foundation/Foundation.h>
#include <math.h>
#include <node_api.h>
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>

static const unsigned MeterScale = 10000;

@interface PiDictationMeter : NSObject {
  _Atomic(unsigned) peak;
}
- (void)sample:(AVAudioPCMBuffer *)buffer;
- (double)readAndReset;
@end

@implementation PiDictationMeter
- (instancetype)init {
  self = [super init];
  if (self) atomic_init(&peak, 0);
  return self;
}

- (void)sample:(AVAudioPCMBuffer *)buffer {
  const float *samples = buffer.floatChannelData ? buffer.floatChannelData[0] : NULL;
  const AVAudioFrameCount frames = buffer.frameLength;
  if (!samples || !frames) return;
  float sum = 0;
  const NSUInteger stride = buffer.stride;
  for (AVAudioFrameCount index = 0; index < frames; index++) {
    float sample = samples[index * stride];
    sum += sample * sample;
  }
  unsigned current = (unsigned)(fminf(1, sqrtf(sum / frames)) * MeterScale);
  unsigned previous = atomic_load_explicit(&peak, memory_order_relaxed);
  while (current > previous && !atomic_compare_exchange_weak_explicit(
    &peak, &previous, current, memory_order_relaxed, memory_order_relaxed)) {}
}

- (double)readAndReset {
  return (double)atomic_exchange_explicit(&peak, 0, memory_order_relaxed) / MeterScale;
}
@end

@interface PiDictation : NSObject
@property(nonatomic) napi_threadsafe_function callback;
@property(nonatomic, strong) AVAudioEngine *engine;
@property(nonatomic, strong) PiDictationMeter *meter;
@property(nonatomic, strong) SFSpeechAudioBufferRecognitionRequest *request;
@property(nonatomic, strong) SFSpeechRecognitionTask *task;
@property(nonatomic, strong) SFSpeechRecognizer *recognizer;
@property(nonatomic, strong) id engineObserver;
@property(nonatomic) BOOL tapping;
- (void)begin;
- (void)stopCapture;
- (void)emit:(const char *)type detail:(NSString *)detail;
- (void)complete:(const char *)type detail:(NSString *)detail;
- (void)dispose;
@end

// The current operation and its control methods are confined to the main thread.
static PiDictation *active;

typedef struct {
  const char *type;
  char *detail;
} DictationMessage;

static void deliver(napi_env env, napi_value callback, void *context, void *data) {
  (void)context;
  DictationMessage *message = data;
  if (env && callback) {
    napi_value args[2], receiver;
    napi_get_undefined(env, &receiver);
    napi_create_string_utf8(env, message->type, NAPI_AUTO_LENGTH, &args[0]);
    napi_create_string_utf8(env, message->detail ?: "", NAPI_AUTO_LENGTH, &args[1]);
    napi_call_function(env, receiver, callback, 2, args, NULL);
  }
  free(message->detail);
  free(message);
}

@implementation PiDictation
- (void)begin {
  if (active != self) return;
  if (SFSpeechRecognizer.authorizationStatus != SFSpeechRecognizerAuthorizationStatusAuthorized) {
    [self complete:"error" detail:@"speech"];
    return;
  }
  if (!self.recognizer.isAvailable || !self.recognizer.supportsOnDeviceRecognition) {
    [self complete:"error" detail:@"unavailable"];
    return;
  }

  self.recognizer.queue = NSOperationQueue.mainQueue;
  self.engine = [[AVAudioEngine alloc] init];
  self.request = [[SFSpeechAudioBufferRecognitionRequest alloc] init];
  self.request.requiresOnDeviceRecognition = YES;
  self.request.taskHint = SFSpeechRecognitionTaskHintDictation;
  self.request.shouldReportPartialResults = NO;
  if (@available(macOS 13.0, *)) self.request.addsPunctuation = YES;

  __weak PiDictation *weakSelf = self;
  self.task = [self.recognizer recognitionTaskWithRequest:self.request resultHandler:^(SFSpeechRecognitionResult *result, NSError *error) {
    PiDictation *session = weakSelf;
    if (!session || active != session) return;
    if (result.isFinal) {
      NSString *text = result.bestTranscription.formattedString;
      [session complete:text.length ? "result" : "error" detail:text.length ? text : @"no-speech"];
    } else if (error) {
      // Speech uses 1110 when an otherwise valid recording contains no speech.
      BOOL empty = [error.domain isEqualToString:@"kAFAssistantErrorDomain"] && error.code == 1110;
      [session complete:"error" detail:empty ? @"no-speech" : @"failed"];
    }
  }];

  @try {
    AVAudioInputNode *input = self.engine.inputNode;
    AVAudioFormat *format = [input outputFormatForBus:0];
    if (!format.channelCount || !format.sampleRate || !self.task) {
      [self complete:"error" detail:@"failed"];
      return;
    }
    SFSpeechAudioBufferRecognitionRequest *request = self.request;
    PiDictationMeter *meter = [[PiDictationMeter alloc] init];
    self.meter = meter;
    [input installTapOnBus:0 bufferSize:1024 format:format block:^(AVAudioPCMBuffer *buffer, AVAudioTime *time) {
      [meter sample:buffer];
      [request appendAudioPCMBuffer:buffer];
    }];
    self.tapping = YES;
    [self.engine prepare];
    if (![self.engine startAndReturnError:NULL]) {
      [self complete:"error" detail:@"failed"];
      return;
    }
    self.engineObserver = [NSNotificationCenter.defaultCenter addObserverForName:AVAudioEngineConfigurationChangeNotification object:self.engine queue:nil usingBlock:^(NSNotification *notification) {
      // Tearing down the engine inside its notification can deadlock.
      dispatch_async(dispatch_get_main_queue(), ^{
        PiDictation *session = weakSelf;
        if (session && active == session && session.tapping) [session complete:"error" detail:@"failed"];
      });
    }];
    [self emit:"recording" detail:nil];
  } @catch (NSException *exception) {
    [self complete:"error" detail:@"failed"];
  }
}
- (void)stopCapture {
  if (self.engineObserver) [NSNotificationCenter.defaultCenter removeObserver:self.engineObserver];
  self.engineObserver = nil;
  [self.engine stop];
  if (self.tapping) [self.engine.inputNode removeTapOnBus:0];
  self.tapping = NO;
  self.engine = nil;
  self.meter = nil;
  [self.request endAudio];
}
- (void)emit:(const char *)type detail:(NSString *)detail {
  DictationMessage *message = malloc(sizeof(DictationMessage));
  if (!message) return;
  message->type = type;
  message->detail = detail ? strdup(detail.UTF8String) : NULL;
  if (napi_call_threadsafe_function(self.callback, message, napi_tsfn_nonblocking) != napi_ok) {
    free(message->detail);
    free(message);
  }
}
- (void)complete:(const char *)type detail:(NSString *)detail {
  [self emit:type detail:detail];
  [self dispose];
}
- (void)dispose {
  if (active != self) return;
  __attribute__((objc_precise_lifetime)) PiDictation *session = active;
  active = nil;
  [session stopCapture];
  [self.task cancel];
  self.task = nil;
  self.request = nil;
  napi_release_threadsafe_function(self.callback, napi_tsfn_release);
}
@end

static napi_value available(napi_env env, napi_callback_info info) {
  NSDictionary *metadata = NSBundle.mainBundle.infoDictionary;
  napi_value value;
  napi_get_boolean(env, metadata[@"NSMicrophoneUsageDescription"] != nil &&
    metadata[@"NSSpeechRecognitionUsageDescription"] != nil, &value);
  return value;
}

static napi_value supportsLocale(napi_env env, napi_callback_info info) {
  size_t count = 1;
  napi_value args[1], value;
  char locale[16];
  napi_get_cb_info(env, info, &count, args, NULL, NULL);
  if (count != 1 || napi_get_value_string_utf8(env, args[0], locale, sizeof(locale), NULL) != napi_ok) {
    napi_throw_type_error(env, NULL, "Expected dictation locale");
    return NULL;
  }
  SFSpeechRecognizer *recognizer = [[SFSpeechRecognizer alloc] initWithLocale:[NSLocale localeWithLocaleIdentifier:@(locale)]];
  napi_get_boolean(env, recognizer.supportsOnDeviceRecognition, &value);
  return value;
}

static napi_value start(napi_env env, napi_callback_info info) {
  size_t count = 2;
  napi_value args[2], name;
  char locale[16];
  napi_get_cb_info(env, info, &count, args, NULL, NULL);
  if (count != 2 || napi_get_value_string_utf8(env, args[0], locale, sizeof(locale), NULL) != napi_ok) {
    napi_throw_type_error(env, NULL, "Expected dictation locale and callback");
    return NULL;
  }
  if (active) {
    napi_throw_error(env, NULL, "Dictation already running");
    return NULL;
  }
  PiDictation *session = [[PiDictation alloc] init];
  session.recognizer = [[SFSpeechRecognizer alloc] initWithLocale:[NSLocale localeWithLocaleIdentifier:@(locale)]];
  napi_create_string_utf8(env, "Pi Dictation", NAPI_AUTO_LENGTH, &name);
  napi_threadsafe_function callback;
  if (napi_create_threadsafe_function(env, args[1], NULL, name, 0, 1, NULL, NULL, NULL, deliver, &callback) != napi_ok) {
    napi_throw_error(env, NULL, "Could not start dictation callback");
    return NULL;
  }
  session.callback = callback;
  napi_unref_threadsafe_function(env, callback);
  active = session;
  if (!session.recognizer.supportsOnDeviceRecognition) {
    [session complete:"error" detail:@"unavailable"];
  } else if (SFSpeechRecognizer.authorizationStatus == SFSpeechRecognizerAuthorizationStatusNotDetermined) {
    [SFSpeechRecognizer requestAuthorization:^(SFSpeechRecognizerAuthorizationStatus status) {
      dispatch_async(dispatch_get_main_queue(), ^{ [session begin]; });
    }];
  } else {
    [session begin];
  }
  return NULL;
}

static napi_value readLevel(napi_env env, napi_callback_info info) {
  napi_value result;
  PiDictationMeter *meter = active.meter;
  napi_create_double(env, meter ? [meter readAndReset] : 0, &result);
  return result;
}

static napi_value stop(napi_env env, napi_callback_info info) {
  [active stopCapture];
  return NULL;
}
static napi_value cancel(napi_env env, napi_callback_info info) {
  [active dispose];
  return NULL;
}
static void cleanup(void *data) { [active dispose]; }

static napi_value init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
    { "available", NULL, available, NULL, NULL, NULL, napi_default, NULL },
    { "supportsLocale", NULL, supportsLocale, NULL, NULL, NULL, napi_default, NULL },
    { "start", NULL, start, NULL, NULL, NULL, napi_default, NULL },
    { "readLevel", NULL, readLevel, NULL, NULL, NULL, napi_default, NULL },
    { "stop", NULL, stop, NULL, NULL, NULL, napi_default, NULL },
    { "cancel", NULL, cancel, NULL, NULL, NULL, napi_default, NULL }
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
  napi_add_env_cleanup_hook(env, cleanup, NULL);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
