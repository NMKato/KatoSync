// Created by NMKato Solutions
// Stage4AB.3.2B QA-only in-process AppKit / Wi-Fi event callback probe.
// Bounded five seconds; explicit opt-in; DENIAL HINTS only.
// No stdout, subprocess, listener, network mutation, keychain or remote jobs.
#import <AppKit/AppKit.h>
#import <Network/Network.h>
#import <CoreFoundation/CoreFoundation.h>
#import <dispatch/dispatch.h>
#import <string.h>

typedef void (*katosync_qa_event_fn)(void *context, const char *frame);

__attribute__((visibility("default")))
int katosync_stage4ab32b_native_events_qa(
    const char *permission, katosync_qa_event_fn emit, void *context) {
    if (permission == NULL ||
        strcmp(permission, "OWNER_LAUNCHED_PASSIVE_OS_OBSERVER_ONLY") != 0 ||
        emit == NULL || context == NULL) {
        return 64;
    }
    @autoreleasepool {
        NSObject *guard = [NSObject new];
        __block BOOL active = YES;
        __block NSString *lastWifi = nil;
        NSNotificationCenter *center = [[NSWorkspace sharedWorkspace] notificationCenter];

        id sleepToken = [center addObserverForName:NSWorkspaceWillSleepNotification
            object:nil queue:nil usingBlock:^(__unused NSNotification *note) {
                @synchronized (guard) {
                    if (active) emit(context, "KATOSYNC_OS_QA_EVENT_V1:SLEEP_BEGIN");
                }
            }];
        id wakeToken = [center addObserverForName:NSWorkspaceDidWakeNotification
            object:nil queue:nil usingBlock:^(__unused NSNotification *note) {
                @synchronized (guard) {
                    if (active) emit(context, "KATOSYNC_OS_QA_EVENT_V1:WAKE");
                }
            }];

        // Wi-Fi path is not evidence that any pinned peer can be reached.
        nw_path_monitor_t wifi = nw_path_monitor_create_with_type(nw_interface_type_wifi);
        if (wifi == NULL) {
            @synchronized (guard) { active = NO; }
            [center removeObserver:sleepToken];
            [center removeObserver:wakeToken];
            return 70;
        }
        dispatch_queue_t queue = dispatch_queue_create(
            "com.katoos.katosync.qa.ab32b.inprocess.path", DISPATCH_QUEUE_SERIAL);
        nw_path_monitor_set_queue(wifi, queue);
        nw_path_monitor_set_update_handler(wifi, ^(nw_path_t path) {
            BOOL available = nw_path_get_status(path) == nw_path_status_satisfied
                && nw_path_uses_interface_type(path, nw_interface_type_wifi);
            NSString *next = available ? @"WIFI_PATH_AVAILABLE" : @"WIFI_PATH_LOST";
            @synchronized (guard) {
                if (active && ![next isEqualToString:lastWifi]) {
                    lastWifi = next;
                    emit(context, available
                        ? "KATOSYNC_OS_QA_EVENT_V1:WIFI_PATH_AVAILABLE"
                        : "KATOSYNC_OS_QA_EVENT_V1:WIFI_PATH_LOST");
                }
            }
        });
        nw_path_monitor_start(wifi);
        emit(context, "KATOSYNC_OS_QA_EVENT_V1:OBSERVING");

        NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:5.0];
        while ([[NSDate date] compare:deadline] == NSOrderedAscending) {
            CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.2, false);
        }

        // Synchronize with all callbacks before returning the borrowed
        // Rust context. Later cancelled path callbacks see active == NO and
        // must never touch context. The test keeps this dylib loaded until
        // process exit, avoiding asynchronous code-unload hazards.
        @synchronized (guard) { active = NO; }
        nw_path_monitor_cancel(wifi);
        dispatch_sync(queue, ^{});
        [center removeObserver:sleepToken];
        [center removeObserver:wakeToken];
        emit(context, "KATOSYNC_OS_QA_EVENT_V1:STOPPED");
    }
    return 0;
}
