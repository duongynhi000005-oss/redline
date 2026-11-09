//! Sync against a large stand-in Redmine that rate limits: Redline should
//! show the newest issues first, keep to its pace, back off when told, and
//! finish without failing.

mod support;

use std::time::{Duration, Instant};

use redline_core::{Client, Error, RequestLimits, Store, Syncer, projects_needing_details};
use support::standin::{Config, StandIn};

/// Older pages read per sync pass, as the app does.
const PAGES_PER_PASS: usize = 5;
/// Projects whose versions and members are read per pass, as the app does.
const PROJECTS_PER_PASS: usize = 6;

/// What one run of the app's sync loop looked like.
#[derive(Debug)]
struct Run {
    /// When the 100 most recently changed issues were all cached.
    first_screen: Duration,
    /// When everything was cached.
    done: Duration,
    /// Passes that failed because the server stayed busy.
    busy_passes: u32,
}

/// Runs the app's sync loop until everything is cached: core metadata, then
/// passes that each read the changes, a few pages of older issues and a few
/// projects' versions and members.
async fn sync_like_the_app(syncer: &Syncer, newest: u64, retry_wait: Duration) -> Run {
    let started = Instant::now();
    // Watches the cache for the newest issues, as the screen would.
    let store = syncer.store().clone();
    let watcher = tokio::spawn(async move {
        loop {
            let cached = store.issue_ids().unwrap();
            if cached.iter().filter(|&&id| id > newest - 100).count() == 100 {
                return started.elapsed();
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    });
    let mut busy_passes = 0;
    let mut pending: Option<Vec<u64>> = None;
    loop {
        let pass = async {
            if pending.is_none() {
                let meta = syncer.sync_core_metadata().await?;
                pending = Some(projects_needing_details(&meta));
            }
            let report = syncer.sync_issues_paced(PAGES_PER_PASS, |_| {}).await?;
            let projects = pending.as_mut().expect("read above");
            let batch: Vec<u64> = projects
                .drain(..projects.len().min(PROJECTS_PER_PASS))
                .collect();
            if !batch.is_empty() {
                syncer.sync_project_details(&batch).await?;
            }
            Ok::<_, Error>(report.remaining || !projects.is_empty())
        };
        match pass.await {
            Ok(true) => {}
            Ok(false) => break,
            Err(Error::Busy) => {
                busy_passes += 1;
                tokio::time::sleep(retry_wait).await;
            }
            Err(e) => panic!("sync failed: {e}"),
        }
    }
    let done = started.elapsed();
    Run {
        first_screen: tokio::time::timeout(Duration::from_secs(1), watcher)
            .await
            .expect("the newest issues were cached")
            .unwrap(),
        done,
        busy_passes,
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn syncs_a_large_server_that_rate_limits_without_failing() {
    // Scaled down so it runs in a few seconds: 50 requests a second after a
    // burst of 10, no Retry-After, and Redline set to 3 at once and 6000 a
    // minute (more than the server allows, so it has to back off).
    let run = StandIn::start(Config {
        projects: 30,
        issues: 2500,
        burst: 10.0,
        per_second: 50.0,
        retry_after: false,
    })
    .await;
    let limits = RequestLimits {
        at_once: 3,
        per_minute: 6000,
    };
    let client = Client::new(&run.server.uri(), "key")
        .unwrap()
        .with_limits(limits)
        .with_retry_unit(Duration::from_millis(20));
    let syncer = Syncer::new(client, Store::in_memory().unwrap());
    let result = sync_like_the_app(&syncer, run.standin.newest(), Duration::from_millis(200)).await;
    let tally = run.standin.tally();

    // Everything arrived, metadata included.
    assert_eq!(syncer.store().count_issues().unwrap(), 2500);
    let meta = syncer.store().metadata().unwrap();
    assert_eq!(meta.projects.len(), 30);
    assert_eq!(meta.versions.len(), 30);
    assert_eq!(meta.memberships.len(), 30);
    // Never more in flight than allowed.
    assert!(tally.most_at_once <= 3, "{tally:?}");
    // The newest issues came well before the rest.
    assert!(result.first_screen < result.done / 2, "{result:?}");
    // It backed off instead of hammering: refusals stay a small share.
    assert!(tally.limited * 4 < tally.requests, "{tally:?}");
    // 2500 issues: one newest page, then open and closed pages of 100 that
    // overlap by 10, a few more for the overlap and passes.
    let issue_requests = tally.by_kind["issues"] - tally.limited.min(tally.by_kind["issues"]);
    assert!(issue_requests <= 35, "{tally:?}");
    assert_eq!(result.busy_passes, 0, "{result:?}");
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
        });
    let syncer = Syncer::new(client.clone(), Store::in_memory().unwrap());
    let slowed = client.pacer().slowed();
    let result = sync_like_the_app(&syncer, run.standin.newest(), Duration::from_secs(1)).await;
    let tally = run.standin.tally();
    assert_eq!(syncer.store().count_issues().unwrap(), 300);
    assert_eq!(result.busy_passes, 0, "{result:?}");
    // It was told to slow down, said so, and recovered.
    assert!(tally.limited > 0);
    assert!(slowed.has_changed().unwrap());
    assert!(!client.pacer().is_slowed());
    // After a refusal everyone waits for Retry-After, so refusals don't
    // pile up: far fewer than one per request.
    assert!(tally.limited * 3 < tally.requests, "{tally:?}");
}

/// Prints request counts and timings for a large server with a strict
/// limit, with Redline's default limits. Run with
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
    let result = sync_like_the_app(&syncer, run.standin.newest(), Duration::from_secs(45)).await;
    let tally = run.standin.tally();
    eprintln!(
        "RESULT: requests={} limited={} most_at_once={} cached={} first_screen={:?} done={:?} busy_passes={} by_kind={:?}",
        tally.requests,
        tally.limited,
        tally.most_at_once,
        syncer.store().count_issues().unwrap(),
        result.first_screen,
        result.done,
        result.busy_passes,
        tally.by_kind
    );
}
