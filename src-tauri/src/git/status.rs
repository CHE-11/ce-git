use std::fs;
use std::path::{Path, PathBuf};

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
    /// True when origin is GitHub, false for another host, none when origin is missing.
    pub github: Option<bool>,
    pub ahead: u32,
    pub behind: u32,
    pub dirty: bool,
    pub staged: u32,
    pub unstaged: u32,
    pub untracked: u32,
    pub default_branch: Option<String>,
    pub has_commits: bool,
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
            github: None,
            ahead: 0,
            behind: 0,
            dirty: false,
            staged: 0,
            unstaged: 0,
            untracked: 0,
            default_branch: None,
            has_commits: false,
            error: Some(error),
        },
    }
}

struct ScanStatus {
    branch: String,
    detached: bool,
    has_commits: bool,
    upstream: Option<String>,
    ahead: u32,
    behind: u32,
    staged: u32,
    unstaged: u32,
    untracked: u32,
}

fn read_status(path: &Path) -> Result<RepoStatus, String> {
    if !super::discover::is_repository(path) {
        return Err("Not a git repository".into());
    }

    // One process carries branch, upstream, ahead/behind, and the change counts.
    // `--no-optional-locks` is a git option, so it has to precede the subcommand.
    let porcelain = git(
        path,
        &[
            "--no-optional-locks",
            "status",
            "--porcelain=v2",
            "--branch",
            "--untracked-files=normal",
        ],
    )?;
    let scan = parse_scan_status(&porcelain);
    let github = origin_url_from_disk(path).map(|url| is_github_url(&url));

    Ok(RepoStatus {
        path: path.to_string_lossy().into_owned(),
        name: dir_name(path),
        branch: scan.branch,
        detached: scan.detached,
        upstream: scan.upstream,
        github,
        ahead: scan.ahead,
        behind: scan.behind,
        dirty: scan.staged + scan.unstaged + scan.untracked > 0,
        staged: scan.staged,
        unstaged: scan.unstaged,
        untracked: scan.untracked,
        default_branch: local_default_branch(path),
        has_commits: scan.has_commits,
        error: None,
    })
}

fn parse_scan_status(porcelain: &str) -> ScanStatus {
    let mut branch = String::from("unknown");
    let mut detached = false;
    let mut has_commits = false;
    let mut upstream = None;
    let mut ahead = 0;
    let mut behind = 0;
    let mut staged = 0;
    let mut unstaged = 0;
    let mut untracked = 0;

    for line in porcelain.lines() {
        if let Some(header) = line.strip_prefix("# ") {
            if let Some(value) = header.strip_prefix("branch.oid ") {
                has_commits = !value.is_empty() && !value.starts_with('(');
            } else if let Some(value) = header.strip_prefix("branch.head ") {
                if value == "(detached)" {
                    detached = true;
                    branch = "detached".into();
                } else if !value.is_empty() {
                    detached = false;
                    branch = value.to_string();
                }
            } else if let Some(value) = header.strip_prefix("branch.upstream ") {
                if !value.is_empty() {
                    upstream = Some(value.to_string());
                }
            } else if let Some(value) = header.strip_prefix("branch.ab ") {
                for part in value.split_whitespace() {
                    if let Some(number) = part.strip_prefix('+') {
                        ahead = number.parse().unwrap_or(0);
                    } else if let Some(number) = part.strip_prefix('-') {
                        behind = number.parse().unwrap_or(0);
                    }
                }
            }
            continue;
        }

        if line.starts_with("? ") {
            untracked += 1;
            continue;
        }

        let mut parts = line.splitn(3, ' ');
        let kind = parts.next();
        let xy = parts.next().unwrap_or("");
        if !matches!(kind, Some("1") | Some("2") | Some("u")) || xy.len() < 2 {
            continue;
        }
        let bytes = xy.as_bytes();
        if bytes[0] != b'.' && bytes[0] != b' ' && bytes[0] != b'?' {
            staged += 1;
        }
        if bytes[1] != b'.' && bytes[1] != b' ' && bytes[1] != b'?' {
            unstaged += 1;
        }
    }

    ScanStatus {
        branch,
        detached,
        has_commits,
        upstream,
        ahead,
        behind,
        staged,
        unstaged,
        untracked,
    }
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
    let git_dir = repo_git_dir(path)?;
    if let Some(name) = origin_head_from_disk(&git_dir) {
        return Some(name);
    }
    first_existing_branch_on_disk(&git_dir, &["main", "master"])
}

fn repo_git_dir(repo: &Path) -> Option<PathBuf> {
    let dot_git = repo.join(".git");
    dot_git.is_dir().then_some(dot_git)
}

fn origin_url_from_disk(repo: &Path) -> Option<String> {
    let git_dir = repo_git_dir(repo)?;
    let config = fs::read_to_string(git_dir.join("config")).ok()?;
    parse_origin_url(&config)
}

fn parse_origin_url(config: &str) -> Option<String> {
    let mut in_origin = false;
    for line in config.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with(';') {
            continue;
        }
        if trimmed.starts_with('[') {
            in_origin = is_origin_remote(trimmed);
            continue;
        }
        if !in_origin {
            continue;
        }
        let Some((key, value)) = trimmed.split_once('=') else {
            continue;
        };
        if !key.trim().eq_ignore_ascii_case("url") {
            continue;
        }
        let url = git_config_value(value.trim());
        if !url.is_empty() {
            return Some(url);
        }
    }
    None
}

fn is_origin_remote(header: &str) -> bool {
    let Some(inner) = header.trim().strip_prefix('[') else {
        return false;
    };
    let Some(end) = inner.find(']') else {
        return false;
    };
    let inner = inner[..end].trim();
    let Some((name, subsection)) = inner.split_once(char::is_whitespace) else {
        return false;
    };
    if !name.trim().eq_ignore_ascii_case("remote") {
        return false;
    }
    git_config_value(subsection.trim()) == "origin"
}

fn git_config_value(value: &str) -> String {
    let value = value.trim();
    if let Some(quoted) = value.strip_prefix('"') {
        let mut decoded = String::new();
        let mut chars = quoted.chars();
        while let Some(ch) = chars.next() {
            if ch == '"' {
                break;
            }
            if ch == '\\' {
                if let Some(next) = chars.next() {
                    decoded.push(next);
                }
                continue;
            }
            decoded.push(ch);
        }
        return decoded;
    }
    match value.find(['#', ';']) {
        Some(index) if value[..index].ends_with(' ') || value[..index].ends_with('\t') => {
            value[..index].trim().to_string()
        }
        _ => value.to_string(),
    }
}

fn origin_head_from_disk(git_dir: &Path) -> Option<String> {
    let text = fs::read_to_string(git_dir.join("refs/remotes/origin/HEAD")).ok()?;
    let name = text.trim().strip_prefix("ref:")?.trim();
    let name = name.strip_prefix("refs/remotes/origin/")?;
    let name = name.trim();
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}

fn first_existing_branch_on_disk(git_dir: &Path, candidates: &[&str]) -> Option<String> {
    let packed = packed_ref_names(git_dir);
    for candidate in candidates {
        let local = format!("refs/heads/{candidate}");
        let remote = format!("refs/remotes/origin/{candidate}");
        if git_dir.join(&local).is_file()
            || git_dir.join(&remote).is_file()
            || packed.iter().any(|name| name == &local || name == &remote)
        {
            return Some((*candidate).to_string());
        }
    }
    None
}

fn packed_ref_names(git_dir: &Path) -> Vec<String> {
    let Ok(text) = fs::read_to_string(git_dir.join("packed-refs")) else {
        return Vec::new();
    };
    let mut names = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with('^') {
            continue;
        }
        let Some((_, name)) = line.split_once(' ') else {
            continue;
        };
        let name = name.trim();
        if !name.is_empty() {
            names.push(name.to_string());
        }
    }
    names
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

pub fn origin_url(path: &Path) -> Option<String> {
    git(path, &["remote", "get-url", "origin"])
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub fn is_github_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.contains("://github.com/")
        || lower.contains("@github.com:")
        || lower.contains("@github.com/")
        || lower.starts_with("github.com/")
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

#[cfg(test)]
mod tests {
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{local_default_branch, parse_origin_url, parse_scan_status};

    #[test]
    fn porcelain_v2_counts_branch_staged_and_untracked_directory() {
        let porcelain = "\
# branch.oid abcdef0123456789abcdef0123456789abcdef01
# branch.head feature
# branch.upstream origin/feature
# branch.ab +2 -1
1 M. N... 100644 100644 100644 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb staged.txt
1 .M N... 100644 100644 100644 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb unstaged.txt
1 MM N... 100644 100644 100644 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb both.txt
? vendor-dir/
";
        let scan = parse_scan_status(porcelain);
        assert_eq!(scan.branch, "feature");
        assert!(!scan.detached);
        assert!(scan.has_commits);
        assert_eq!(scan.upstream.as_deref(), Some("origin/feature"));
        assert_eq!(scan.ahead, 2);
        assert_eq!(scan.behind, 1);
        assert_eq!(scan.staged, 2);
        assert_eq!(scan.unstaged, 2);
        assert_eq!(scan.untracked, 1);
    }

    #[test]
    fn porcelain_v2_reads_detached_and_unborn_branches() {
        let detached = parse_scan_status(
            "# branch.oid abcdef0123456789abcdef0123456789abcdef01\n# branch.head (detached)\n",
        );
        assert!(detached.detached);
        assert_eq!(detached.branch, "detached");
        assert!(detached.has_commits);
        assert!(detached.upstream.is_none());
        assert_eq!(detached.ahead, 0);
        assert_eq!(detached.behind, 0);

        let unborn = parse_scan_status("# branch.oid (initial)\n# branch.head main\n");
        assert!(!unborn.has_commits);
        assert!(!unborn.detached);
        assert_eq!(unborn.branch, "main");
        assert_eq!(unborn.staged, 0);
        assert_eq!(unborn.untracked, 0);
    }

    #[test]
    fn origin_url_comes_from_the_origin_remote() {
        let config = "\
[remote \"upstream\"]
	url = https://example.com/nope.git
[remote \"origin\"]
	url = \"git@github.com:acme/widget.git\" # primary
[branch \"main\"]
	remote = origin
";
        assert_eq!(
            parse_origin_url(config).as_deref(),
            Some("git@github.com:acme/widget.git")
        );
        assert_eq!(parse_origin_url("[core]\n\tbare = false\n"), None);
    }

    #[test]
    fn default_branch_prefers_origin_head_then_packed_refs() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let repo = std::env::temp_dir().join(format!("ce-git-default-branch-{nanos}"));
        let git_dir = repo.join(".git");
        fs::create_dir_all(git_dir.join("refs/remotes/origin")).unwrap();
        fs::create_dir_all(git_dir.join("refs/heads")).unwrap();
        fs::write(
            git_dir.join("refs/remotes/origin/HEAD"),
            "ref: refs/remotes/origin/develop\n",
        )
        .unwrap();
        fs::write(git_dir.join("refs/heads/main"), "abc\n").unwrap();
        assert_eq!(local_default_branch(&repo).as_deref(), Some("develop"));

        fs::remove_file(git_dir.join("refs/remotes/origin/HEAD")).unwrap();
        fs::remove_dir_all(git_dir.join("refs")).unwrap();
        fs::write(
            git_dir.join("packed-refs"),
            "# pack-refs with: peeled fully-peeled sorted\n0123456789abcdef0123456789abcdef01234567 refs/remotes/origin/master\n",
        )
        .unwrap();
        assert_eq!(local_default_branch(&repo).as_deref(), Some("master"));

        let _ = fs::remove_dir_all(repo);
    }
}
