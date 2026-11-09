//! Keeps Redline polite to one server: how many requests are in flight, how
//! fast new ones start, and what happens when the server says "slow down".
//!
//! Every request to a server goes through that server's [`Pacer`]:
//!
//! - At most [`RequestLimits::at_once`] requests are in flight.
//! - New requests start at most [`RequestLimits::per_minute`] a minute, evenly
//!   spaced, so a long sync is a steady trickle instead of a burst.
//! - A 429 or 503 pauses *every* request to the server, not just the one that
//!   got it: for as long as `Retry-After` says, or with exponential backoff
//!   and jitter when it doesn't. The pace then halves and creeps back up as
//!   answers succeed, so Redline settles just under the server's limit.
//! - Requests the person is waiting on (opening an issue, saving a change)
//!   go ahead of background sync whenever both are waiting.

use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::sync::{Notify, watch};
use tokio::time::Instant;

/// Requests in flight at once, by default.
pub const DEFAULT_AT_ONCE: u32 = 2;
/// Requests started per minute, by default: two a second.
pub const DEFAULT_PER_MINUTE: u32 = 120;
/// The most requests in flight a server can be set to.
pub const MAX_AT_ONCE: u32 = 8;
/// The slowest a server can be set to.
pub const MIN_PER_MINUTE: u32 = 10;
/// The fastest a server can be set to.
pub const MAX_PER_MINUTE: u32 = 1200;

/// The longest Redline waits between two requests after being told to slow
/// down, however often it's told.
const MAX_INTERVAL: Duration = Duration::from_secs(10);
/// The longest one backoff lasts without a `Retry-After`.
const MAX_BACKOFF: Duration = Duration::from_secs(60);
/// The longest Redline honours a `Retry-After` for. Past this a request fails
/// with [`crate::Error::Busy`] and the next sync tries again.
pub const MAX_RETRY_AFTER: Duration = Duration::from_secs(120);

/// How hard Redline may use one server. Saved per server, under Advanced.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct RequestLimits {
    /// Requests in flight at the same time.
    pub at_once: u32,
    /// Requests started per minute.
    pub per_minute: u32,
}

impl Default for RequestLimits {
    fn default() -> Self {
        Self {
            at_once: DEFAULT_AT_ONCE,
            per_minute: DEFAULT_PER_MINUTE,
        }
    }
}

impl RequestLimits {
    /// Brings each number into the range Redline allows.
    pub fn clamped(self) -> Self {
        Self {
            at_once: self.at_once.clamp(1, MAX_AT_ONCE),
            per_minute: self.per_minute.clamp(MIN_PER_MINUTE, MAX_PER_MINUTE),
        }
    }

    /// No spacing and plenty in flight. For tests and local servers.
    #[doc(hidden)]
    pub fn unlimited() -> Self {
        Self {
            at_once: 16,
            per_minute: 0,
        }
    }

    fn interval(&self) -> Duration {
        if self.per_minute == 0 {
            Duration::ZERO
        } else {
            Duration::from_secs(60) / self.per_minute
        }
    }
}

/// Who's waiting on a request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Priority {
    /// Someone is looking at the screen waiting for it.
    #[default]
    Foreground,
    /// Sync, prefetching and anything else that can wait.
    Background,
}

#[derive(Debug)]
struct State {
    in_flight: u32,
    /// Foreground requests waiting for a turn. Background ones wait while
    /// there are any.
    foreground_waiting: u32,
    /// When the next request may start.
    next_start: Instant,
    /// Nothing starts before this, after the server said to slow down.
    paused_until: Instant,
    /// The current spacing between starts: the configured one, or more
    /// after being told to slow down.
    interval: Duration,
    /// Slow-down answers in a row, for the backoff.
    strikes: u32,
}

/// The gate every request to one server passes through. Cheap to clone;
/// clones share the same limits and state.
#[derive(Clone)]
pub struct Pacer {
    inner: Arc<Inner>,
}

struct Inner {
    limits: RequestLimits,
    /// The first backoff without `Retry-After`; it doubles with each strike.
    backoff_unit: Duration,
    state: Mutex<State>,
    turn: Notify,
    slowed: watch::Sender<bool>,
}

impl std::fmt::Debug for Pacer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Pacer")
            .field("limits", &self.inner.limits)
            .finish()
    }
}

/// A turn to send one request. Dropping it lets the next one in.
pub struct Turn {
    inner: Arc<Inner>,
}

impl Drop for Turn {
    fn drop(&mut self) {
        if let Ok(mut state) = self.inner.state.lock() {
            state.in_flight = state.in_flight.saturating_sub(1);
        }
        self.inner.turn.notify_waiters();
    }
}

/// Counts a foreground request as waiting until it gets its turn or gives
/// up, so a cancelled request never holds background sync back.
struct Waiting<'a> {
    inner: &'a Inner,
    counted: bool,
}

impl Waiting<'_> {
    fn done(&mut self, state: &mut State) {
        if self.counted {
            state.foreground_waiting -= 1;
            self.counted = false;
        }
    }
}

impl Drop for Waiting<'_> {
    fn drop(&mut self) {
        if self.counted {
            if let Ok(mut state) = self.inner.state.lock() {
                state.foreground_waiting -= 1;
            }
            self.inner.turn.notify_waiters();
        }
    }
}

impl Pacer {
    pub fn new(limits: RequestLimits, backoff_unit: Duration) -> Self {
        let now = Instant::now();
        let (slowed, _) = watch::channel(false);
        Self {
            inner: Arc::new(Inner {
                limits,
                backoff_unit,
                state: Mutex::new(State {
                    in_flight: 0,
                    foreground_waiting: 0,
                    next_start: now,
                    paused_until: now,
                    interval: limits.interval(),
                    strikes: 0,
                }),
                turn: Notify::new(),
                slowed,
            }),
        }
    }

    pub fn limits(&self) -> RequestLimits {
        self.inner.limits
    }

    /// True while the server has asked Redline to slow down and it hasn't
    /// caught up yet. Changes as that starts and ends.
    pub fn slowed(&self) -> watch::Receiver<bool> {
        self.inner.slowed.subscribe()
    }

    pub fn is_slowed(&self) -> bool {
        *self.inner.slowed.borrow()
    }

    /// Waits for a turn to send a request.
    pub async fn turn(&self, priority: Priority) -> Turn {
        let inner = &*self.inner;
        let mut waiting = Waiting {
            inner,
            counted: false,
        };
        if priority == Priority::Foreground {
            inner.state.lock().expect("pacer lock").foreground_waiting += 1;
            waiting.counted = true;
        }
        loop {
            // Listen before looking, so a turn freed in between isn't missed.
            let freed = inner.turn.notified();
            tokio::pin!(freed);
            freed.as_mut().enable();

            let wake_at = {
                let mut state = inner.state.lock().expect("pacer lock");
                let room = state.in_flight < inner.limits.at_once.max(1);
                let ahead = priority == Priority::Background && state.foreground_waiting > 0;
                if room && !ahead {
                    let now = Instant::now();
                    let start = state.next_start.max(state.paused_until);
                    if start <= now {
                        state.in_flight += 1;
                        state.next_start = now + state.interval;
                        let was_ahead = waiting.counted;
                        waiting.done(&mut state);
                        drop(state);
                        if was_ahead {
                            // Background requests may have been holding back for it.
                            inner.turn.notify_waiters();
                        }
                        return Turn {
                            inner: self.inner.clone(),
                        };
                    }
                    Some(start)
                } else {
                    None
                }
            };
            match wake_at {
                Some(at) => {
                    tokio::select! {
                        _ = tokio::time::sleep_until(at) => {}
                        _ = &mut freed => {}
                    }
                }
                None => freed.await,
            }
        }
    }

    /// The server answered normally: ease back toward the configured pace.
    pub fn succeeded(&self) {
        let inner = &*self.inner;
        let mut state = inner.state.lock().expect("pacer lock");
        state.strikes = 0;
        let base = inner.limits.interval();
        if state.interval > base {
            state.interval = (state.interval * 9 / 10).max(base);
        }
        let caught_up = Instant::now() >= state.paused_until;
        drop(state);
        if caught_up {
            inner
                .slowed
                .send_if_modified(|s| std::mem::replace(s, false));
        }
    }

    /// The server said to slow down (429 or 503). Pauses every request for
    /// `retry_after`, or a backoff when the server didn't say, and halves the
    /// pace. Returns how long the pause is.
    pub fn told_to_slow_down(&self, retry_after: Option<Duration>) -> Duration {
        let inner = &*self.inner;
        let mut state = inner.state.lock().expect("pacer lock");
        state.strikes += 1;
        let wait = match retry_after {
            Some(after) => after.min(MAX_RETRY_AFTER) + jitter(Duration::from_millis(250)),
            None => {
                let backoff = inner
                    .backoff_unit
                    .saturating_mul(2u32.saturating_pow(state.strikes.min(16) - 1))
                    .min(MAX_BACKOFF);
                // Up to a quarter more, so clients told to wait together
                // don't all come back together.
                backoff + jitter(backoff / 4)
            }
        };
        let until = Instant::now() + wait;
        state.paused_until = state.paused_until.max(until);
        let floor = inner.backoff_unit.max(Duration::from_millis(1));
        state.interval = (state.interval * 2).max(floor).min(MAX_INTERVAL);
        drop(state);
        inner
            .slowed
            .send_if_modified(|s| !std::mem::replace(s, true));
        wait
    }

    /// The current spacing between request starts.
    #[doc(hidden)]
    pub fn interval(&self) -> Duration {
        self.inner.state.lock().expect("pacer lock").interval
    }
}

/// A random duration from zero up to `max`.
fn jitter(max: Duration) -> Duration {
    if max.is_zero() {
        return Duration::ZERO;
    }
    let mut hasher = RandomState::new().build_hasher();
    hasher.write_u64(0);
    let fraction = (hasher.finish() % 10_000) as u32;
    max * fraction / 10_000
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    #[tokio::test(start_paused = true)]
    async fn spaces_starts_by_the_per_minute_limit() {
        let pacer = Pacer::new(
            RequestLimits {
                at_once: 4,
                per_minute: 60,
            },
            Duration::from_millis(500),
        );
        let start = Instant::now();
        for _ in 0..3 {
            drop(pacer.turn(Priority::Background).await);
        }
        // The first starts at once, then one a second.
        assert_eq!(start.elapsed().as_secs(), 2);
    }

    #[tokio::test(start_paused = true)]
    async fn keeps_no_more_than_at_once_in_flight() {
        let pacer = Pacer::new(
            RequestLimits {
                at_once: 2,
                per_minute: 0,
            },
            Duration::from_millis(500),
        );
        let in_flight = Arc::new(AtomicU32::new(0));
        let most = Arc::new(AtomicU32::new(0));
        let mut tasks = tokio::task::JoinSet::new();
        for _ in 0..8 {
            let pacer = pacer.clone();
            let in_flight = in_flight.clone();
            let most = most.clone();
            tasks.spawn(async move {
                let _turn = pacer.turn(Priority::Background).await;
                let now = in_flight.fetch_add(1, Ordering::SeqCst) + 1;
                most.fetch_max(now, Ordering::SeqCst);
                tokio::time::sleep(Duration::from_millis(100)).await;
                in_flight.fetch_sub(1, Ordering::SeqCst);
            });
        }
        while tasks.join_next().await.is_some() {}
        assert_eq!(most.load(Ordering::SeqCst), 2);
    }

    #[tokio::test(start_paused = true)]
    async fn a_slow_down_pauses_everyone_for_retry_after() {
        let pacer = Pacer::new(RequestLimits::unlimited(), Duration::from_millis(500));
        let mut slowed = pacer.slowed();
        let wait = pacer.told_to_slow_down(Some(Duration::from_secs(3)));
        assert!(wait >= Duration::from_secs(3));
        assert!(*slowed.borrow_and_update());
        let start = Instant::now();
        drop(pacer.turn(Priority::Foreground).await);
        assert!(start.elapsed() >= Duration::from_secs(3));
        pacer.succeeded();
        assert!(!*slowed.borrow_and_update());
    }

    #[tokio::test(start_paused = true)]
    async fn backs_off_exponentially_and_recovers_the_pace() {
        let limits = RequestLimits {
            at_once: 2,
            per_minute: 120,
        };
        let pacer = Pacer::new(limits, Duration::from_millis(500));
        let first = pacer.told_to_slow_down(None);
        let second = pacer.told_to_slow_down(None);
        let third = pacer.told_to_slow_down(None);
        assert!(first >= Duration::from_millis(500) && first <= Duration::from_millis(625));
        assert!(second >= Duration::from_secs(1) && second <= Duration::from_millis(1250));
        assert!(third >= Duration::from_secs(2) && third <= Duration::from_millis(2500));
        assert_eq!(pacer.interval(), Duration::from_secs(4));
        for _ in 0..100 {
            pacer.succeeded();
        }
        assert_eq!(pacer.interval(), Duration::from_millis(500));
    }

    #[tokio::test(start_paused = true)]
    async fn foreground_requests_go_before_background_ones() {
        let pacer = Pacer::new(
            RequestLimits {
                at_once: 1,
                per_minute: 0,
            },
            Duration::from_millis(500),
        );
        let held = pacer.turn(Priority::Background).await;
        let order = Arc::new(Mutex::new(Vec::new()));
        let mut tasks = tokio::task::JoinSet::new();
        for (name, priority) in [
            ("background", Priority::Background),
            ("foreground", Priority::Foreground),
        ] {
            let pacer = pacer.clone();
            let order = order.clone();
            tasks.spawn(async move {
                let _turn = pacer.turn(priority).await;
                order.lock().unwrap().push(name);
            });
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        drop(held);
        while tasks.join_next().await.is_some() {}
        assert_eq!(*order.lock().unwrap(), vec!["foreground", "background"]);
    }

    #[test]
    fn limits_are_kept_in_range() {
        let limits = RequestLimits {
            at_once: 0,
            per_minute: 100_000,
        }
        .clamped();
        assert_eq!(limits.at_once, 1);
        assert_eq!(limits.per_minute, MAX_PER_MINUTE);
    }
}
