use std::path::Path;
use std::sync::Arc;

use futures::stream::{self, StreamExt};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::git::{Outcome, PublishOptions, commit_repo, pull_default, publish_repo, push_repo};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchProgress {
    pub repo: String,
    pub action: String,
    pub status: String,
    pub message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitRequest {
    pub path: String,
    pub message: String,
}

pub async fn batch_pull(app: AppHandle, paths: Vec<String>) -> Vec<BatchProgress> {
    run_batch(
        app,
        "pull",
        paths,
        |path| base_name(path),
        |path| pull_default(Path::new(&path)),
    )
    .await
}

pub async fn batch_push(app: AppHandle, paths: Vec<String>) -> Vec<BatchProgress> {
    run_batch(
        app,
        "push",
        paths,
        |path| base_name(path),
        |path| push_repo(Path::new(&path)),
    )
    .await
}

pub async fn run_publish(app: AppHandle, path: String, options: PublishOptions) -> Result<(), String> {
    let repo = base_name(&path);
    let _ = app.emit(
        "batch-progress",
        BatchProgress {
            repo: repo.clone(),
            action: "publish".into(),
            status: "running".into(),
            message: "Working…".into(),
        },
    );

    let outcome = tauri::async_runtime::spawn_blocking(move || publish_repo(Path::new(&path), &options))
        .await
        .unwrap_or_else(|error| Outcome::Failed(error.to_string()));
    let (status, message, failed) = match &outcome {
        Outcome::Ok(message) => ("ok", message.clone(), false),
        Outcome::Skipped(message) => ("skipped", message.clone(), true),
        Outcome::Failed(message) => ("failed", message.clone(), true),
    };
    let _ = app.emit(
        "batch-progress",
        BatchProgress {
            repo,
            action: "publish".into(),
            status: status.into(),
            message: message.clone(),
        },
    );
    if failed { Err(message) } else { Ok(()) }
}

pub async fn batch_commit(app: AppHandle, commits: Vec<CommitRequest>) -> Vec<BatchProgress> {
    run_batch(
        app,
        "commit",
        commits,
        |commit| base_name(&commit.path),
        |commit| match commit_repo(Path::new(&commit.path), &commit.message) {
            Ok(()) => {
                let subject = commit
                    .message
                    .lines()
                    .find(|line| !line.trim().is_empty())
                    .unwrap_or("Committed");
                Outcome::Ok(format!("Committed: {subject}"))
            }
            Err(error) if error == "Nothing to commit" => Outcome::Skipped(error),
            Err(error) => Outcome::Failed(error),
        },
    )
    .await
}

async fn run_batch<T, F, L>(
    app: AppHandle,
    action: &str,
    items: Vec<T>,
    label: L,
    work: F,
) -> Vec<BatchProgress>
where
    T: Send + 'static,
    F: Fn(T) -> Outcome + Send + Sync + 'static,
    L: Fn(&T) -> String + Send + Sync + 'static,
{
    let work = Arc::new(work);
    let label = Arc::new(label);
    let action = action.to_string();

    let mut results = stream::iter(items.into_iter().map(|item| {
        let app = app.clone();
        let work = work.clone();
        let label = label.clone();
        let action = action.clone();
        async move {
            let repo = label(&item);
            let _ = app.emit(
                "batch-progress",
                BatchProgress {
                    repo: repo.clone(),
                    action: action.clone(),
                    status: "running".into(),
                    message: "Working…".into(),
                },
            );

            let outcome = tauri::async_runtime::spawn_blocking(move || work(item))
                .await
                .unwrap_or_else(|error| Outcome::Failed(error.to_string()));
            let (status, message) = match outcome {
                Outcome::Ok(message) => ("ok", message),
                Outcome::Skipped(message) => ("skipped", message),
                Outcome::Failed(message) => ("failed", message),
            };
            let progress = BatchProgress {
                repo,
                action,
                status: status.into(),
                message,
            };
            let _ = app.emit("batch-progress", &progress);
            progress
        }
    }))
    .buffer_unordered(4)
    .collect::<Vec<_>>()
    .await;

    results.sort_by(|left, right| {
        left.repo
            .cmp(&right.repo)
            .then(left.action.cmp(&right.action))
    });
    results
}

fn base_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| path.to_string())
}
