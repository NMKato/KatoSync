// Erstellt von NMKato Solutions
//! Ergänzt ausschließlich fehlende, konkret gebundene Listener; bestehende Verbindungen bleiben Eigentum des Aufrufers.
use std::{future::Future, net::Ipv4Addr};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum ListenerKind {
    Lan,
    Tailnet,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct ListenerBinding {
    pub kind: ListenerKind,
    pub local: Ipv4Addr,
}

pub(super) async fn bind_missing<T, Bind, BindingFuture, Identity>(
    existing: &[ListenerBinding],
    mut bind: Bind,
    identity: Identity,
) -> Vec<T>
where
    Bind: FnMut(ListenerKind) -> BindingFuture,
    BindingFuture: Future<Output = Option<T>>,
    Identity: Fn(&T) -> ListenerBinding,
{
    let mut occupied = existing.to_vec();
    let mut additions = Vec::new();
    for kind in [ListenerKind::Lan, ListenerKind::Tailnet] {
        if occupied.len() >= 2 || occupied.iter().any(|entry| entry.kind == kind) {
            continue;
        }
        let Some(listener) = bind(kind).await else {
            continue;
        };
        let candidate = identity(&listener);
        if candidate.kind != kind
            || candidate.local.is_unspecified()
            || occupied.iter().any(|entry| entry.local == candidate.local)
        {
            continue;
        }
        occupied.push(candidate);
        additions.push(listener);
    }
    additions
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        cell::RefCell,
        future::{ready, Future},
        pin::pin,
        sync::Arc,
        task::{Context, Poll, Wake, Waker},
    };

    fn complete<T>(future: impl Future<Output = T>) -> T {
        struct NoWake;
        impl Wake for NoWake {
            fn wake(self: Arc<Self>) {}
        }
        let waker = Waker::from(Arc::new(NoWake));
        match pin!(future).poll(&mut Context::from_waker(&waker)) {
            Poll::Ready(value) => value,
            Poll::Pending => panic!("Die Testbinder benötigen weder Netzwerk noch einen Executor"),
        }
    }
    fn lan() -> ListenerBinding {
        ListenerBinding {
            kind: ListenerKind::Lan,
            local: Ipv4Addr::new(192, 168, 1, 2),
        }
    }
    fn tailnet() -> ListenerBinding {
        ListenerBinding {
            kind: ListenerKind::Tailnet,
            local: Ipv4Addr::new(100, 64, 0, 2),
        }
    }

    #[test]
    fn transient_overlay_failure_is_retried_without_rebinding_the_existing_lan() {
        let existing = [lan()];
        let attempts = RefCell::new(Vec::new());
        let first = complete(bind_missing(
            &existing,
            |kind| {
                attempts.borrow_mut().push(kind);
                ready(None::<ListenerBinding>)
            },
            |entry| *entry,
        ));
        assert!(first.is_empty());
        let second = complete(bind_missing(
            &existing,
            |kind| {
                attempts.borrow_mut().push(kind);
                ready(Some(tailnet()))
            },
            |entry| *entry,
        ));
        assert_eq!(second, [tailnet()]);
        assert_eq!(existing, [lan()]);
        assert_eq!(
            *attempts.borrow(),
            [ListenerKind::Tailnet, ListenerKind::Tailnet]
        );
    }

    #[test]
    fn missing_lan_is_added_without_rebinding_the_existing_overlay() {
        let existing = [tailnet()];
        let additions = complete(bind_missing(
            &existing,
            |kind| {
                assert_eq!(kind, ListenerKind::Lan);
                ready(Some(lan()))
            },
            |entry| *entry,
        ));
        assert_eq!(additions, [lan()]);
        assert_eq!(existing, [tailnet()]);
    }

    #[test]
    fn two_bound_routes_never_start_another_discovery_or_bind() {
        let mut calls = 0;
        let additions = complete(bind_missing(
            &[lan(), tailnet()],
            |_| {
                calls += 1;
                ready(None::<ListenerBinding>)
            },
            |entry| *entry,
        ));
        assert!(additions.is_empty());
        assert_eq!(calls, 0);
    }

    #[test]
    fn initial_failures_leave_both_routes_available_for_a_later_attempt() {
        assert!(complete(bind_missing(
            &[],
            |_| ready(None::<ListenerBinding>),
            |entry| *entry
        ))
        .is_empty());
        let additions = complete(bind_missing(
            &[],
            |kind| {
                ready(Some(if kind == ListenerKind::Lan {
                    lan()
                } else {
                    tailnet()
                }))
            },
            |entry| *entry,
        ));
        assert_eq!(additions, [lan(), tailnet()]);
    }

    #[test]
    fn a_second_route_cannot_reuse_the_existing_address() {
        let duplicate = ListenerBinding {
            kind: ListenerKind::Tailnet,
            local: lan().local,
        };
        let additions = complete(bind_missing(
            &[lan()],
            |_| ready(Some(duplicate)),
            |entry| *entry,
        ));
        assert!(additions.is_empty());
    }

    #[test]
    fn wildcard_addresses_are_never_added() {
        let wildcard = ListenerBinding {
            kind: ListenerKind::Tailnet,
            local: Ipv4Addr::UNSPECIFIED,
        };
        let additions = complete(bind_missing(
            &[lan()],
            |_| ready(Some(wildcard)),
            |entry| *entry,
        ));
        assert!(additions.is_empty());
    }

    #[test]
    fn a_binder_cannot_replace_a_missing_kind_with_an_existing_kind() {
        let additions = complete(bind_missing(
            &[lan()],
            |_| ready(Some(lan())),
            |entry| *entry,
        ));
        assert!(additions.is_empty());
    }
}
