use std::path::Path;

use serde::Serialize;

use super::command::git;
use super::diff::ensure_repo;

const MAX_LIMIT: u32 = 2000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum GraphRefKind {
    Head,
    Branch,
    Remote,
    Tag,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphRef {
    pub name: String,
    pub kind: GraphRefKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphCommit {
    pub hash: String,
    pub parents: Vec<String>,
    pub subject: String,
    pub author: String,
    pub date: String,
    pub refs: Vec<GraphRef>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoGraph {
    pub head: Option<String>,
    pub commits: Vec<GraphCommit>,
    pub truncated: bool,
}

pub fn repo_graph(path: &Path, limit: u32) -> Result<RepoGraph, String> {
    ensure_repo(path)?;
    let limit = limit.clamp(1, MAX_LIMIT);
    let head = git(path, &["rev-parse", "--verify", "--quiet", "HEAD"])
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| is_hash(value));
    if head.is_none() {
        return Ok(RepoGraph {
            head: None,
            commits: Vec::new(),
            truncated: false,
        });
    }

    let count = (limit + 1).to_string();
    let output = git(
        path,
        &[
            "log",
            "--all",
            "--date-order",
            "-z",
            "-n",
            &count,
            "--pretty=format:%H%x1f%P%x1f%D%x1f%an%x1f%aI%x1f%s",
        ],
    )?;
    let mut commits = parse_log(&output);
    let truncated = commits.len() > limit as usize;
    if truncated {
        commits.truncate(limit as usize);
    }
    Ok(RepoGraph {
        head,
        commits,
        truncated,
    })
}

fn parse_log(output: &str) -> Vec<GraphCommit> {
    split_records(output)
        .into_iter()
        .filter_map(parse_record)
        .collect()
}

fn split_records(output: &str) -> Vec<&str> {
    let source = output.trim_matches('\0');
    if source.contains('\0') {
        source
            .split('\0')
            .map(str::trim)
            .filter(|record| !record.is_empty())
            .collect()
    } else {
        source
            .lines()
            .map(str::trim)
            .filter(|record| !record.is_empty())
            .collect()
    }
}

fn parse_record(record: &str) -> Option<GraphCommit> {
    let mut fields = record.split('\u{1f}');
    let hash = fields.next()?.trim();
    if !is_hash(hash) {
        return None;
    }
    let parents = fields
        .next()
        .unwrap_or("")
        .split_whitespace()
        .filter(|parent| is_hash(parent))
        .map(str::to_string)
        .collect();
    let decorate = fields.next().unwrap_or("");
    let author = fields.next().unwrap_or("").trim().to_string();
    let date = fields.next().unwrap_or("").trim().to_string();
    let subject = fields.next().unwrap_or("").trim().to_string();
    Some(GraphCommit {
        hash: hash.to_string(),
        parents,
        subject,
        author,
        date,
        refs: parse_decorate(decorate),
    })
}

fn parse_decorate(raw: &str) -> Vec<GraphRef> {
    let mut refs: Vec<GraphRef> = Vec::new();
    for token in raw.split(',') {
        let token = token.trim();
        if token.is_empty() {
            continue;
        }
        let parsed = if let Some(name) = token.strip_prefix("HEAD -> ") {
            GraphRef {
                name: name.trim().to_string(),
                kind: GraphRefKind::Head,
            }
        } else if token == "HEAD" {
            GraphRef {
                name: "HEAD".to_string(),
                kind: GraphRefKind::Head,
            }
        } else if let Some(name) = token.strip_prefix("tag: ") {
            GraphRef {
                name: name.trim().to_string(),
                kind: GraphRefKind::Tag,
            }
        } else {
            let name = token.rsplit(" -> ").next().unwrap_or(token).trim();
            if name.is_empty() {
                continue;
            }
            let kind = if name.contains('/') {
                GraphRefKind::Remote
            } else {
                GraphRefKind::Branch
            };
            GraphRef {
                name: name.to_string(),
                kind,
            }
        };
        if parsed.name.is_empty() {
            continue;
        }
        if refs
            .iter()
            .any(|existing| existing.kind == parsed.kind && existing.name == parsed.name)
        {
            continue;
        }
        refs.push(parsed);
    }

    let head_names: Vec<String> = refs
        .iter()
        .filter(|item| item.kind == GraphRefKind::Head && item.name != "HEAD")
        .map(|item| item.name.clone())
        .collect();
    refs.retain(|item| {
        item.kind != GraphRefKind::Branch || !head_names.iter().any(|name| name == &item.name)
    });
    refs
}

fn is_hash(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() >= 7 && bytes.iter().all(|byte| byte.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::{Command, Stdio};
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::super::command::git;
    use super::{GraphRefKind, parse_decorate, parse_log, repo_graph};

    #[test]
    fn decorate_field_splits_head_branches_remotes_and_tags() {
        let refs = parse_decorate("HEAD -> main, origin/main, tag: v1.0");
        assert_eq!(refs.len(), 3);
        assert_eq!(refs[0].kind, GraphRefKind::Head);
        assert_eq!(refs[0].name, "main");
        assert_eq!(refs[1].kind, GraphRefKind::Remote);
        assert_eq!(refs[1].name, "origin/main");
        assert_eq!(refs[2].kind, GraphRefKind::Tag);
        assert_eq!(refs[2].name, "v1.0");

        let branch = parse_decorate("feature, origin/feature");
        assert_eq!(branch[0].kind, GraphRefKind::Branch);
        assert_eq!(branch[0].name, "feature");
        assert_eq!(branch[1].kind, GraphRefKind::Remote);
        assert_eq!(branch[1].name, "origin/feature");

        let detached = parse_decorate("HEAD");
        assert_eq!(detached.len(), 1);
        assert_eq!(detached[0].kind, GraphRefKind::Head);
        assert_eq!(detached[0].name, "HEAD");

        let symbolic = parse_decorate("origin/main, origin/HEAD -> origin/main");
        assert_eq!(symbolic.len(), 1);
        assert_eq!(symbolic[0].kind, GraphRefKind::Remote);
        assert_eq!(symbolic[0].name, "origin/main");

        let current = parse_decorate("HEAD -> main, main");
        assert_eq!(current.len(), 1);
        assert_eq!(current[0].kind, GraphRefKind::Head);
        assert_eq!(current[0].name, "main");

        assert!(parse_decorate("").is_empty());
        assert!(parse_decorate("  ").is_empty());
    }

    #[test]
    fn log_records_keep_parents_and_refs() {
        let merge = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\u{1f}bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb cccccccccccccccccccccccccccccccccccccccc\u{1f}HEAD -> main, tag: v1.0\u{1f}Ada\u{1f}2020-01-04T00:00:04+00:00\u{1f}merge feature";
        let base = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\u{1f}\u{1f}feature\u{1f}Ada\u{1f}2020-01-01T00:00:01+00:00\u{1f}base";
        let output = format!("{merge}\0{base}\0");
        let commits = parse_log(&output);
        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].subject, "merge feature");
        assert_eq!(commits[0].parents.len(), 2);
        assert_eq!(commits[0].author, "Ada");
        assert_eq!(commits[0].refs[0].kind, GraphRefKind::Head);
        assert_eq!(commits[0].refs[0].name, "main");
        assert_eq!(commits[0].refs[1].kind, GraphRefKind::Tag);
        assert!(commits[1].parents.is_empty());
        assert_eq!(commits[1].refs[0].name, "feature");
        assert_eq!(commits[1].refs[0].kind, GraphRefKind::Branch);
    }

    #[test]
    fn graph_of_a_merge_lists_parents_head_and_branch() {
        let root = scratch("graph");
        init_repo(&root);
        fs::write(root.join("README.md"), "base\n").unwrap();
        git_ok(&root, &["add", "."]);
        git_dated(
            &root,
            &["commit", "-m", "base"],
            "2020-01-01T00:00:01+00:00",
        );

        git_ok(&root, &["checkout", "-b", "feature"]);
        fs::write(root.join("feature.txt"), "feature\n").unwrap();
        git_ok(&root, &["add", "."]);
        git_dated(
            &root,
            &["commit", "-m", "feature work"],
            "2020-01-01T00:00:02+00:00",
        );

        git_ok(&root, &["checkout", "main"]);
        fs::write(root.join("main.txt"), "main\n").unwrap();
        git_ok(&root, &["add", "."]);
        git_dated(
            &root,
            &["commit", "-m", "main work"],
            "2020-01-01T00:00:03+00:00",
        );
        git_dated(
            &root,
            &[
                "merge",
                "--no-ff",
                "--no-edit",
                "-m",
                "merge feature",
                "feature",
            ],
            "2020-01-01T00:00:04+00:00",
        );

        let graph = repo_graph(&root, 50).unwrap();
        assert!(!graph.truncated);
        assert_eq!(graph.commits.len(), 4);
        assert_eq!(graph.commits[0].subject, "merge feature");
        assert_eq!(graph.commits[0].parents.len(), 2);
        assert_eq!(graph.head.as_deref(), Some(graph.commits[0].hash.as_str()));
        assert!(
            graph.commits[0]
                .refs
                .iter()
                .any(|item| item.kind == GraphRefKind::Head && item.name == "main"),
            "{:?}",
            graph.commits[0].refs
        );

        let main_work = graph
            .commits
            .iter()
            .find(|commit| commit.subject == "main work")
            .unwrap();
        let feature = graph
            .commits
            .iter()
            .find(|commit| commit.subject == "feature work")
            .unwrap();
        assert_eq!(graph.commits[0].parents[0], main_work.hash);
        assert_eq!(graph.commits[0].parents[1], feature.hash);
        assert!(
            feature
                .refs
                .iter()
                .any(|item| item.kind == GraphRefKind::Branch && item.name == "feature"),
            "{:?}",
            feature.refs
        );

        let page = repo_graph(&root, 1).unwrap();
        assert!(page.truncated);
        assert_eq!(page.commits.len(), 1);
        assert_eq!(page.commits[0].subject, "merge feature");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn empty_repository_has_no_commits() {
        let root = scratch("graph-empty");
        init_repo(&root);
        let graph = repo_graph(&root, 20).unwrap();
        assert!(graph.head.is_none());
        assert!(graph.commits.is_empty());
        assert!(!graph.truncated);
        let _ = fs::remove_dir_all(root);
    }

    fn scratch(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("ce-git-{name}-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn git_ok(dir: &Path, args: &[&str]) {
        let result = git(dir, args);
        assert!(
            result.is_ok(),
            "git {args:?} in {} failed: {result:?}",
            dir.display()
        );
    }

    fn init_repo(path: &Path) {
        git_ok(path, &["init", "-b", "main"]);
        git_ok(path, &["config", "user.email", "ce-git@example.com"]);
        git_ok(path, &["config", "user.name", "ce-git"]);
        git_ok(path, &["config", "core.autocrlf", "false"]);
    }

    fn git_dated(dir: &Path, args: &[&str], date: &str) {
        let mut command = Command::new("git");
        command
            .args(args)
            .current_dir(dir)
            .env("GIT_AUTHOR_DATE", date)
            .env("GIT_COMMITTER_DATE", date)
            .env("GIT_AUTHOR_NAME", "ce-git")
            .env("GIT_AUTHOR_EMAIL", "ce-git@example.com")
            .env("GIT_COMMITTER_NAME", "ce-git")
            .env("GIT_COMMITTER_EMAIL", "ce-git@example.com")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000);
        }
        let output = command.output().expect("git");
        assert!(
            output.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
