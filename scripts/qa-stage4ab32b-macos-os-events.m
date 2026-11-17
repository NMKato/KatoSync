// Created by NMKato Solutions
// Stage4AB.3.2B passive macOS power and Wi-Fi path observation.
// Explicit owner-local QA opt-in, bounded 5 seconds, no network changes,
// no system settings, no persisted process, no token or peer information.
// This observer supplies denial hints ONLY, not an authenticated Mesh proof.
#import <AppKit/AppKit.h>
#import <Network/Network.h>
#import <dispatch/dispatch.h>
#import <CoreFoundation/CoreFoundation.h>
#import <stdio.h>
#import <stdlib.h>
#import <string.h>

static void qa_emit(const char *name) {
    printf("KATOSYNC_OS_QA_EVENT_V1:%s\n", name);
    fflush(stdout);
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        const char *permission = getenv("KATOSYNC_STAGE4AB32B_OS_EVENT_QA_READ_ONLY");
        if (argc != 1 || permission == NULL ||
            strcmp(permission, "OWNER_LAUNCHED_PASSIVE_OS_OBSERVER_ONLY") != 0) {
            fputs("MESH_STAGE4AB32B_OS_EVENT_QA_OPT_IN_REQUIRED\n", stderr);
            return 64;
        }
        NSObject *guard = [NSObject new];
        __block NSString *lastWifi = nil;
        NSNotificationCenter *center = [[NSWorkspace sharedWorkspace] notificationCenter];
        id sleepToken = [center addObserverForName:NSWorkspaceWillSleepNotification
            object:nil queue:[NSOperationQueue mainQueue]
            usingBlock:^(__unused NSNotification *note) { qa_emit("SLEEP_BEGIN"); }];
        id wakeToken = [center addObserverForName:NSWorkspaceDidWakeNotification
            object:nil queue:[NSOperationQueue mainQueue]
            usingBlock:^(__unused NSNotification *note) { qa_emit("WAKE"); }];

        // Conservative Wi-Fi-specific path status, NOT proof that a pinned
        // peer or the user's remote management link is reachable.
        nw_path_monitor_t wifi = nw_path_monitor_create_with_type(nw_interface_type_wifi);
        dispatch_queue_t queue = dispatch_queue_create(
            "com.katoos.katosync.qa.ab32b.path", DISPATCH_QUEUE_SERIAL);
        nw_path_monitor_set_queue(wifi, queue);
        nw_path_monitor_set_update_handler(wifi, ^(nw_path_t path) {
            BOOL available = nw_path_get_status(path) == nw_path_status_satisfied
                && nw_path_uses_interface_type(path, nw_interface_type_wifi);
            NSString *next = available ? @"WIFI_PATH_AVAILABLE" : @"WIFI_PATH_LOST";
            @synchronized (guard) {
                if (![next isEqualToString:lastWifi]) {
                    lastWifi = next;
                    qa_emit([next UTF8String]);
                }
            }
        });
        nw_path_monitor_start(wifi);
        qa_emit("OBSERVING");

        NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:5.0];
        while ([[NSDate date] compare:deadline] == NSOrderedAscending) {
            CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.2, false);
        }

        nw_path_monitor_cancel(wifi);
        [center removeObserver:sleepToken];
        [center removeObserver:wakeToken];
        qa_emit("STOPPED");
    }
    return 0;
}
