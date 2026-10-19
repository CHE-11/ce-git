use std::path::Path;

use serde::Serialize;

use super::command::{dir_name, git};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoStatus {
    pub path: String,
    pub name: String,
    pub branch: String,
    pub detached: bool,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub dirty: bool,
    pub staged: u32,
    pub unstaged: u32,
    pub untracked: u32,
    pub default_branch: Option<String>,
    pub error: Option<String>,
}

pub struct CurrentBranch {
    pub name: String,
    pub detached: bool,
    pub has_commits: bool,
}

pub fn status_of(path: &Path) -> RepoStatus {
    let path_string = path.to_string_lossy().into_owned();
    let name = dir_name(path);
    match read_status(path) {
        Ok(status) => status,
        Err(error) => RepoStatus {
            path: path_string,
            name,
            branch: "unknown".into(),
            detached: false,
            upstream: None,
            ahead: 0,
            behind: 0,
            dirty: false,
            staged: 0,
            unstaged: 0,
            untracked: 0,
            default_branch: None,
            error: Some(error),
        },
    }
}

fn read_status(path: &Path) -> Result<RepoStatus, String> {
    if !path.join(".git").exists() {
        return Err("Not a git repository".into());
    }

    let current = current_branch(path)?;
    let porcelain = git(path, &["status", "--porcelain=v1", "-uall"])?;
    let (staged, unstaged, untracked) = count_changes(&porcelain);
    let upstream = if current.has_commits {
        git(
            path,
            &[
                "rev-parse",
                "--abbrev-ref",
                "--symbolic-full-name",
                "@{upstream}",
            ],
        )
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    } else {
        None
    };
    let (ahead, behind) = match &upstream {
        Some(_) => ahead_behind(path),
        None => (0, 0),
    };

    Ok(RepoStatus {
        path: path.to_string_lossy().into_owned(),
        name: dir_name(path),
        branch: if current.detached {
            "detached".into()
        } else {
            current.name
        },
        detached: current.detached,
        upstream,
        ahead,
        behind,
        dirty: staged + unstaged + untracked > 0,
        staged,
        unstaged,
        untracked,
        default_branch: local_default_branch(path),
        error: None,
    })
}

pub fn current_branch(path: &Path) -> Result<CurrentBranch, String> {
    let has_commits = git(path, &["rev-parse", "--verify", "--quiet", "HEAD"]).is_ok();
    match git(path, &["symbolic-ref", "--short", "HEAD"]) {
        Ok(name) => Ok(CurrentBranch {
            name: name.trim().to_string(),
            detached: false,
            has_commits,
        }),
        Err(_) => Ok(CurrentBranch {
            name: "detached".into(),
            detached: true,
            has_commits,
        }),
    }
}

pub fn is_dirty(path: &Path) -> Result<bool, String> {
    let output = git(path, &["status", "--porcelain=v1", "-uall"])?;
    Ok(output.lines().any(|line| !line.trim().is_empty()))
}

pub fn ahead_behind(path: &Path) -> (u32, u32) {
    let Ok(output) = git(
        path,
        &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
    ) else {
        return (0, 0);
    };
    let mut parts = output.split_whitespace();
    let ahead = parts
        .next()
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    let behind = parts
        .next()
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    (ahead, behind)
}

pub fn local_default_branch(path: &Path) -> Option<String> {
    if let Some(name) = origin_head(path) {
        return Some(name);
    }
    first_existing_branch(path, &["main", "master"])
}

pub fn resolve_default_branch(path: &Path) -> Result<String, String> {
    if let Some(name) = origin_head(path) {
        return Ok(name);
    }
    if let Some(name) = remote_head_from_network(path) {
        return Ok(name);
    }
    first_existing_branch(path, &["main", "master"])
        .ok_or_else(|| "Could not find a main or master branch".to_string())
}

fn origin_head(path: &Path) -> Option<String> {
    let symbolic = git(
        path,
        &[
            "symbolic-ref",
            "--quiet",
            "--short",
            "refs/remotes/origin/HEAD",
        ],
    )
    .ok()?;
    let name = symbolic.trim().strip_prefix("origin/")?.trim();
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}

fn remote_head_from_network(path: &Path) -> Option<String> {
    let listing = git(path, &["ls-remote", "--symref", "origin", "HEAD"]).ok()?;
    for line in listing.lines() {
        let Some(rest) = line.trim().strip_prefix("ref:") else {
            continue;
        };
        let Some(name) = rest
            .trim()
            .split(['\t', ' '])
            .next()
            .and_then(|item| item.strip_prefix("refs/heads/"))
        else {
            continue;
        };
        if !name.is_empty() {
            return Some(name.to_string());
        }
    }
    None
}

fn first_existing_branch(path: &Path, candidates: &[&str]) -> Option<String> {
    for candidate in candidates {
        let local = format!("refs/heads/{candidate}");
        let remote = format!("refs/remotes/origin/{candidate}");
        if git(path, &["show-ref", "--verify", "--quiet", &local]).is_ok()
            || git(path, &["show-ref", "--verify", "--quiet", &remote]).is_ok()
        {
            return Some((*candidate).to_string());
        }
    }
    None
}

fn count_changes(porcelain: &str) -> (u32, u32, u32) {
    let mut staged = 0;
    let mut unstaged = 0;
    let mut untracked = 0;

    for line in porcelain.lines() {
        if line.len() < 2 {
            continue;
        }
        let bytes = line.as_bytes();
        if bytes[0] == b'?' && bytes[1] == b'?' {
            untracked += 1;
            continue;
        }
        if bytes[0] != b' ' && bytes[0] != b'?' {
            staged += 1;
        }
        if bytes[1] != b' ' && bytes[1] != b'?' {
            unstaged += 1;
        }
    }

    (staged, unstaged, untracked)
}
