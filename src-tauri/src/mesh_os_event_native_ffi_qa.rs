// Created by NMKato Solutions
//! Stage4AB.3.2B: native AppKit callback -> Rust lease fence, QA-only.
//! No stdout sidecar, remote jobs, runtime IPC, or device mutations.
//! Library path is set explicitly by an isolated native CI test; the
//! library stays loaded until the short-lived QA test process exits.
//! All identities and TLS leases in this fixture are synthetic.

use crate::{
    mesh_durable_lease_qa::LiveTlsLease, mesh_os_event_channel_qa::heartbeat_or_fail_closed,
    mesh_os_event_fence_qa::OsEventLeaseFence,
};
use std::{
    ffi::{c_char, c_int, c_void, CStr, CString},
    ptr,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::{
    io::{duplex, AsyncReadExt, AsyncWriteExt},
    sync::mpsc,
    time::timeout,
};

const LIB_ENV: &str = "KATOSYNC_STAGE4AB32B_OS_OBSERVER_DYLIB";
const OPT_IN: &str = "OWNER_LAUNCHED_PASSIVE_OS_OBSERVER_ONLY";
const PREFIX: &str = "KATOSYNC_OS_QA_EVENT_V1:";
const LEASE_DENIED: &str = "MESH_STAGE4AB32B_OS_OBSERVER_LEASE_DENIED";
const BAD_FRAME: &str = "INVALID_NATIVE_OS_EVENT_FRAME";

type NativeCallback = extern "C" fn(*mut c_void, *const c_char);
type NativeObserver =
    unsafe extern "C" fn(*const c_char, Option<NativeCallback>, *mut c_void) -> c_int;

#[link(name = "System")]
extern "C" {
    fn dlopen(file: *const c_char, mode: c_int) -> *mut c_void;
    fn dlsym(handle: *mut c_void, name: *const c_char) -> *mut c_void;
}

fn observer() -> NativeObserver {
    let path = std::env::var(LIB_ENV)
        .expect("owner QA requires a newly compiled, temporary native dylib path");
    let path = CString::new(path).expect("observer library path cannot contain NUL");
    let symbol = CString::new("katosync_stage4ab32b_native_events_qa").unwrap();
    // Safety: CI builds the exact reviewed .m in an isolated temporary folder
    // and only calls this exported signature in ignored-by-default QA tests.
    // Intentionally no dlclose: an Apple dispatch callback must never run
    // after unloading code. This only retains the library for the test process.
    let handle = unsafe { dlopen(path.as_ptr(), 2) };
    assert!(!handle.is_null(), "QA native observer dylib failed to load");
    let address = unsafe { dlsym(handle, symbol.as_ptr()) };
    assert!(!address.is_null(), "native QA callback symbol is missing");
    unsafe { std::mem::transmute::<*mut c_void, NativeObserver>(address) }
}

struct CallbackSink {
    sender: mpsc::Sender<String>,
    observed: Arc<Mutex<Vec<String>>>,
}

/// C may invoke this on the observing worker or Apple's serial NWPath queue.
/// NEVER panic/unwind across FFI. The native function synchronizes callbacks
/// before it returns, so this stack-borrowed context remains valid.
extern "C" fn receive(context: *mut c_void, frame: *const c_char) {
    if context.is_null() || frame.is_null() {
        return;
    }
    let sink = unsafe { &*(context.cast::<CallbackSink>()) };
    let bytes = unsafe { CStr::from_ptr(frame) }.to_bytes();
    let event = match std::str::from_utf8(bytes) {
        Ok(value) if value.len() <= 80 && value.is_ascii() => value.to_string(),
        _ => BAD_FRAME.to_string(),
    };
    if let Ok(mut frames) = sink.observed.lock() {
        frames.push(event.clone());
    }
    // This is deliberately a STOPPED test. A headless macOS runner can
    // announce WIFI_PATH_LOST immediately, which is separately covered by
    // the canonical native event-fence/channel unit tests. The actual event
    // is still recorded; the STOPPED assertion must not be preempted.
    if event == format!("{PREFIX}OBSERVING")
        || event == format!("{PREFIX}STOPPED")
        || event == BAD_FRAME
    {
        let _ = sink.sender.blocking_send(event);
    }
}

fn live_lease() -> LiveTlsLease {
    let now = Instant::now();
    let mut lease =
        LiveTlsLease::after_verified_open_channel([1u8; 16], [2; 32], [3; 32], [4; 32], now)
            .unwrap();
    lease.verified_in_channel_heartbeat(1, now).unwrap();
    assert!(lease.is_live(Instant::now()));
    lease
}

#[tokio::test]
#[ignore = "requires owner-isolated, freshly compiled native QA dylib"]
async fn ffi_callback_rejects_missing_owner_local_opt_in() {
    let entry = observer();
    let (sender, mut receiver) = mpsc::channel(4);
    let observed = Arc::new(Mutex::new(Vec::new()));
    let status = tokio::task::spawn_blocking(move || {
        let mut context = CallbackSink { sender, observed };
        unsafe {
            entry(
                ptr::null(),
                Some(receive),
                (&mut context as *mut CallbackSink).cast(),
            )
        }
    })
    .await
    .expect("QA native negative test must join");
    assert_eq!(status, 64);
    assert!(receiver.try_recv().is_err());
}

#[tokio::test]
#[ignore = "requires owner-isolated, freshly compiled native QA dylib"]
async fn native_inprocess_callback_stopped_denies_pending_heartbeat() {
    let entry = observer();
    let (sender, mut receiver) = mpsc::channel::<String>(8);
    let observed = Arc::new(Mutex::new(Vec::new()));
    let observed_copy = Arc::clone(&observed);
    let worker = tokio::task::spawn_blocking(move || {
        let mut context = CallbackSink { sender, observed };
        let permission = CString::new(OPT_IN).unwrap();
        unsafe {
            entry(
                permission.as_ptr(),
                Some(receive),
                (&mut context as *mut CallbackSink).cast(),
            )
        }
    });

    let mut lease = live_lease();
    let mut fence = OsEventLeaseFence::default();
    let (mut io, _silent_peer) = duplex(128);
    let pending = async move {
        io.write_all(b"PING")
            .await
            .map_err(|_| "HEARTBEAT_WRITE_FAILED".to_string())?;
        let mut response = [0; 4];
        io.read_exact(&mut response)
            .await
            .map(|_| ())
            .map_err(|_| "HEARTBEAT_READ_FAILED".to_string())
    };
    let result = timeout(
        Duration::from_secs(14),
        heartbeat_or_fail_closed(&mut lease, &mut fence, &mut receiver, pending),
    )
    .await
    .expect("native callback must end pending heartbeat within bounded deadline");
    assert_eq!(result.err().as_deref(), Some(LEASE_DENIED));
    assert!(!lease.is_live(Instant::now()));
    assert!(lease
        .verified_in_channel_heartbeat(2, Instant::now())
        .is_err());
    let exit = timeout(Duration::from_secs(8), worker)
        .await
        .expect("native QA callback worker must return")
        .expect("callback worker join failed");
    assert_eq!(exit, 0);
    let frames = observed_copy.lock().unwrap();
    assert!(frames.iter().any(|x| x == &format!("{PREFIX}OBSERVING")));
    assert!(frames.iter().any(|x| x == &format!("{PREFIX}STOPPED")));
    assert!(frames.iter().all(|x| x.len() <= 80 && x.is_ascii()));
}
