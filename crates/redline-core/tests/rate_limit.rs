//! Opening Redline against a large stand-in Redmine that rate limits:
//! Redline should ask only for what's on screen, the way Redmine's own
//! pages do, keep to its pace, back off when told, and not fail.

mod support;

use std::future::Future;
use std::time::{Duration, Instant};

use redline_core::{Client, Condition, Error, IssueFilter, RequestLimits, Result, Store, Syncer};
use support::standin::{Config, StandIn};

/// What opening the app looked like.
#[derive(Debug)]
struct Run {
    /// When the first page of the list was on screen.
    first_screen: Duration,
    /// When everything on screen had loaded.
    done: Duration,
    /// Steps that failed because the server stayed busy.
    busy: u32,
    /// Issues the first page and the next one showed.
    shown: usize,
    /// Changed issues the second check for changes read.
    changes: usize,
}

/// Tries a step again when the server stayed busy, as the app does.
async fn retrying<T, F, Fut>(busy: &mut u32, wait: Duration, mut step: F) -> T
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T>>,
{
    loop {
        match step().await {
            Ok(value) => return value,
            Err(Error::Busy) => {
                *busy += 1;
                tokio::time::sleep(wait).await;
            }
            Err(e) => panic!("failed: {e}"),
        }
    }
}

fn filter(project_id: Option<u64>, status: &str) -> IssueFilter {
    IssueFilter {
        project_id,
        conditions: vec![Condition::new("status_id", status, &[])],
        sort: None,
    }
}

/// Opens the app: metadata, a list of issues and its next page as the
/// list scrolls, the sidebar's counts alongside, three recently opened
/// issues, and two checks for changes.
async fn open_like_the_app(syncer: &Syncer, wait: Duration) -> Run {
    let started = Instant::now();
    let mut busy = 0;
    retrying(&mut busy, wait, || syncer.sync_metadata()).await;

    let team = filter(None, "*");
    let counts = [
        filter(Some(1), "c"),
        filter(Some(2), "o"),
        filter(None, "*"),
    ];
    let mut count_busy = 0;
    let ((first, first_screen), ()) = tokio::join!(
        async {
            let first = retrying(&mut busy, wait, || syncer.find_issues(&team, 0)).await;
            (first, started.elapsed())
        },
        async {
            for filter in &counts {
                retrying(&mut count_busy, wait, || syncer.count_issues(filter)).await;
            }
        }
    );
    let offset = first.items.len() as u64;
    let next = retrying(&mut busy, wait, || syncer.find_issues(&team, offset)).await;
    retrying(&mut busy, wait, || syncer.issues_by_id(&[1, 2, 3])).await;
    retrying(&mut busy, wait, || syncer.poll_changes()).await;
    let changes = retrying(&mut busy, wait, || syncer.poll_changes()).await;
    Run {
        first_screen,
        done: started.elapsed(),
        busy: busy + count_busy,
        shown: first.items.len() + next.items.len(),
        changes: changes.len(),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn opens_a_large_server_that_rate_limits_with_few_requests() {
    // 50 requests a second after a burst of 10, no Retry-After, and Redline
    // set to 3 at once and 6000 a minute (more than the server allows, so it
    // has to back off).
    let run = StandIn::start(Config {
        projects: 30,
        issues: 2500,
        burst: 10.0,
        per_second: 50.0,
        retry_after: false,
    })
    .await;
    let client = Client::new(&run.server.uri(), "key")
        .unwrap()
        .with_limits(RequestLimits {
            at_once: 3,
            per_minute: 6000,
        })
        .with_retry_unit(Duration::from_millis(20));
    let syncer = Syncer::new(client, Store::in_memory().unwrap());
    let result = open_like_the_app(&syncer, Duration::from_millis(200)).await;
    let tally = run.standin.tally();

    // Two pages of the list showed.
    assert_eq!(result.shown, 200, "{result:?}");
    // Only issues opened are kept, not the lists.
    assert_eq!(syncer.store().count_issues().unwrap(), 3);
    // Versions and members only for the projects the user is in, not all 30.
    let meta = syncer.store().metadata().unwrap();
    assert_eq!(meta.projects.len(), 30);
    assert_eq!(meta.versions.len(), 5);
    assert_eq!(tally.by_kind["versions"], 5, "{tally:?}");
    // Never more in flight than allowed.
    assert!(tally.most_at_once <= 3, "{tally:?}");
    // It backed off instead of hammering: refusals stay a small share.
    assert!(tally.limited * 4 < tally.requests, "{tally:?}");
    // Issues: two list pages, three counts, the opened issues and two
    // checks for changes; nothing like reading all 2500.
    assert!(tally.by_kind["issues"] <= 8 + tally.limited, "{tally:?}");
    assert!(tally.requests - tally.limited <= 32, "{tally:?}");
    assert_eq!(result.busy, 0, "{result:?}");
    assert!(result.first_screen <= result.done);
    // Nothing changed between the two checks.
    assert_eq!(result.changes, 0, "{result:?}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn honours_retry_after_for_every_request() {
    let run = StandIn::start(Config {
        projects: 4,
        issues: 300,
        burst: 4.0,
        per_second: 4.0,
        retry_after: true,
    })
    .await;
    let client = Client::new(&run.server.uri(), "key")
        .unwrap()
        .with_limits(RequestLimits {
            at_once: 4,
            per_minute: 1200,
        })
        // Retry-After sets the waits; this only shortens how long the
        // pacer keeps saying it is slowed after the last refusal (1s).
        .with_retry_unit(Duration::from_millis(50));
    let syncer = Syncer::new(client.clone(), Store::in_memory().unwrap());
    let slowed = client.pacer().slowed();
    let result = open_like_the_app(&syncer, Duration::from_secs(1)).await;
    let tally = run.standin.tally();
    assert_eq!(result.busy, 0, "{result:?}");
    // It was told to slow down, said so, and recovered.
    assert!(tally.limited > 0);
    assert!(slowed.has_changed().unwrap());
    tokio::time::sleep(Duration::from_millis(1100)).await;
    client.check_key().await.unwrap();
    assert!(!client.pacer().is_slowed());
    // After a refusal everyone waits for Retry-After, so refusals don't
    // pile up: far fewer than one per request.
    assert!(tally.limited * 3 < tally.requests, "{tally:?}");
}

/// Prints request counts and timings for opening the app on a large server
/// with a strict limit, with Redline's default limits. Run with
/// `cargo test -p redline-core --test rate_limit -- --ignored --nocapture`.
/// `STANDIN_PER_SECOND`, `STANDIN_BURST` and `STANDIN_RETRY_AFTER=0` change
/// the server's limit.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore]
async fn measure_a_large_server() {
    let env = |name: &str, default: f64| {
        std::env::var(name)
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(default)
    };
    let run = StandIn::start(Config {
        projects: 40,
        issues: 5000,
        burst: env("STANDIN_BURST", 10.0),
        per_second: env("STANDIN_PER_SECOND", 3.0),
        retry_after: env("STANDIN_RETRY_AFTER", 1.0) != 0.0,
    })
    .await;
    let client = Client::new(&run.server.uri(), "key").unwrap();
    let syncer = Syncer::new(client, Store::in_memory().unwrap());
    let result = open_like_the_app(&syncer, Duration::from_secs(45)).await;
    let tally = run.standin.tally();
    eprintln!(
        "RESULT: requests={} limited={} most_at_once={} cached={} first_screen={:?} done={:?} busy={} by_kind={:?}",
        tally.requests,
        tally.limited,
        tally.most_at_once,
        syncer.store().count_issues().unwrap(),
        result.first_screen,
        result.done,
        result.busy,
        tally.by_kind
    );
}
