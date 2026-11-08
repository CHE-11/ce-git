use std::collections::HashSet;
use std::path::Path;

use serde::Serialize;

use super::command::git;
use super::diff::ensure_repo;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
pub enum BranchKind {
    #[serde(rename = "local")]
    Local,
    #[serde(rename = "remote")]
    Remote,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepoBranch {
    pub name: String,
    pub kind: BranchKind,
    pub current: bool,
    /// Short upstream of a local branch, such as `origin/main`.
    pub upstream: Option<String>,
}

/// Local branches, plus remote-tracking branches that have no local branch of the same name.
pub fn list_branches(repo: &Path) -> Result<Vec<RepoBranch>, String> {
    ensure_repo(repo)?;
    let output = git(
        repo,
        &[
            "-c",
            "color.ui=false",
            "-c",
            "core.quotepath=false",
            "for-each-ref",
            "--format=%(refname)%09%(upstream:short)",
            "refs/heads",
            "refs/remotes",
        ],
    )?;
    let mut branches = Vec::new();
    for line in output.lines() {
        if let Some(branch) = parse_ref_line(line) {
            branches.push(branch);
        }
    }
    hide_remotes_with_local_branch(&mut branches);
    mark_current(repo, &mut branches)?;
    sort_branches(&mut branches);
    Ok(branches)
}

/// Check out `name` and keep uncommitted changes when that branch can take them.
///
/// A remote name such as `origin/feature` creates the matching local branch and sets its upstream.
pub fn checkout_branch(repo: &Path, name: &str) -> Result<(), String> {
    ensure_repo(repo)?;
    let name = clean_branch_name(name)?;
    if ref_exists(repo, &format!("refs/heads/{name}")) {
        return switch_local(repo, &name);
    }
    if ref_exists(repo, &format!("refs/remotes/{name}")) {
        let Some(short) = remote_short_name(&name) else {
            return Err(format!("Branch {name} was not found."));
        };
        if ref_exists(repo, &format!("refs/heads/{short}")) {
            return switch_local(repo, short);
        }
        ensure_branch_idle(repo)?;
        return switch_tracking(repo, &name);
    }
    if current_name_is(repo, &name)? {
        return Ok(());
    }
    Err(format!("Branch {name} was not found."))
}

/// Create `name` at the current commit and check it out. The index and worktree stay as they are.
pub fn create_branch(repo: &Path, name: &str) -> Result<(), String> {
    ensure_repo(repo)?;
    let name = branch_name(repo, name)?;
    if ref_exists(repo, &format!("refs/heads/{name}")) {
        return Err("A branch with that name already exists.".into());
    }
    ensure_branch_idle(repo)?;
    // An unborn branch is only a name in HEAD. Point that name at the new branch
    // so the first commit lands there and untracked files stay put.
    if !has_commits(repo) {
        return point_unborn_branch(repo, &name);
    }
    // --no-track keeps a same-named remote branch from becoming the upstream.
    // The new branch still starts at the commit that is checked out now.
    git(repo, &["switch", "-c", &name, "--no-track"])
        .map(|_| ())
        .map_err(friendly_git_error)
}

fn parse_ref_line(line: &str) -> Option<RepoBranch> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }
    let (refname, upstream) = line.split_once('\t').unwrap_or((line, ""));
    let upstream = upstream.trim();
    if let Some(name) = refname.trim().strip_prefix("refs/heads/") {
        if name.is_empty() {
            return None;
        }
        return Some(RepoBranch {
            name: name.to_string(),
            kind: BranchKind::Local,
            current: false,
            upstream: if upstream.is_empty() {
                None
            } else {
                Some(upstream.to_string())
            },
        });
    }
    let name = remote_branch_name(refname.trim())?;
    Some(RepoBranch {
        name,
        kind: BranchKind::Remote,
        current: false,
        upstream: None,
    })
}

fn remote_branch_name(refname: &str) -> Option<String> {
    let rest = refname.strip_prefix("refs/remotes/")?;
    remote_short_name(rest)?;
    Some(rest.to_string())
}

/// `origin/feature` -> `feature`. `origin/HEAD` is the remote's default pointer, not a branch.
fn remote_short_name(name: &str) -> Option<&str> {
    let (remote, branch) = name.split_once('/')?;
    if remote.is_empty() || branch.is_empty() || branch == "HEAD" {
        None
    } else {
        Some(branch)
    }
}

fn hide_remotes_with_local_branch(branches: &mut Vec<RepoBranch>) {
    let locals: HashSet<String> = branches
        .iter()
        .filter(|branch| branch.kind == BranchKind::Local)
        .map(|branch| branch.name.clone())
        .collect();
    branches.retain(|branch| match branch.kind {
        BranchKind::Local => true,
        BranchKind::Remote => remote_short_name(&branch.name)
            .is_some_and(|short| !locals.contains(short)),
    });
}

fn mark_current(repo: &Path, branches: &mut Vec<RepoBranch>) -> Result<(), String> {
    let current = super::status::current_branch(repo)?;
    if current.detached {
        return Ok(());
    }
    if let Some(found) = branches
        .iter_mut()
        .find(|branch| branch.kind == BranchKind::Local && branch.name == current.name)
    {
        found.current = true;
        return Ok(());
    }
    branches.push(RepoBranch {
        name: current.name,
        kind: BranchKind::Local,
        current: true,
        upstream: None,
    });
    Ok(())
}

fn sort_branches(branches: &mut [RepoBranch]) {
    branches.sort_by(|left, right| {
        branch_order(left)
            .cmp(&branch_order(right))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
            .then_with(|| left.name.cmp(&right.name))
    });
}

fn branch_order(branch: &RepoBranch) -> u8 {
    if branch.current {
        0
    } else if branch.kind == BranchKind::Local {
        1
    } else {
        2
    }
}

fn switch_local(repo: &Path, name: &str) -> Result<(), String> {
    if current_name_is(repo, name)? {
        return Ok(());
    }
    ensure_branch_idle(repo)?;
    git(repo, &["switch", name])
        .map(|_| ())
        .map_err(friendly_git_error)
}

fn switch_tracking(repo: &Path, name: &str) -> Result<(), String> {
    git(repo, &["switch", "--track", name])
        .map(|_| ())
        .map_err(friendly_git_error)
}

fn point_unborn_branch(repo: &Path, name: &str) -> Result<(), String> {
    let current = super::status::current_branch(repo)?;
    if current.detached {
        return Err(
            "Commit once before creating a branch from a detached HEAD with no commits.".into(),
        );
    }
    if current.name == name {
        return Err("You are already on that branch.".into());
    }
    git(repo, &["symbolic-ref", "HEAD", &format!("refs/heads/{name}")]).map(|_| ())
}

fn current_name_is(repo: &Path, name: &str) -> Result<bool, String> {
    let current = super::status::current_branch(repo)?;
    Ok(!current.detached && current.name == name)
}

fn has_commits(repo: &Path) -> bool {
    git(repo, &["rev-parse", "--verify", "--quiet", "HEAD"]).is_ok()
}

fn ref_exists(repo: &Path, refname: &str) -> bool {
    git(repo, &["show-ref", "--verify", "--quiet", refname]).is_ok()
}

fn ensure_branch_idle(repo: &Path) -> Result<(), String> {
    let busy = git(repo, &["rev-parse", "-q", "--verify", "MERGE_HEAD"]).is_ok()
        || git(repo, &["rev-parse", "-q", "--verify", "CHERRY_PICK_HEAD"]).is_ok()
        || git(repo, &["rev-parse", "-q", "--verify", "REVERT_HEAD"]).is_ok()
        || git_path_exists(repo, "rebase-merge")
        || git_path_exists(repo, "rebase-apply");
    if busy {
        Err(
            "Finish or abort the merge, rebase, cherry-pick, or revert before switching branches."
                .into(),
        )
    } else {
        Ok(())
    }
}

fn git_path_exists(repo: &Path, name: &str) -> bool {
    let Ok(relative) = git(repo, &["rev-parse", "--git-path", name]) else {
        return false;
    };
    let relative = relative.trim();
    !relative.is_empty() && repo.join(relative).exists()
}

fn branch_name(repo: &Path, name: &str) -> Result<String, String> {
    let name = clean_branch_name(name)?;
    let canonical = git(repo, &["check-ref-format", "--branch", &name])
        .map_err(|_| "That branch name is not valid.".to_string())?;
    if canonical.trim() != name {
        return Err("That branch name is not valid.".into());
    }
    Ok(name)
}

fn clean_branch_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Enter a branch name.".into());
    }
    if !plausible_branch_name(name) {
        return Err("That branch name is not valid.".into());
    }
    Ok(name.to_string())
}

fn plausible_branch_name(name: &str) -> bool {
    if name.is_empty()
        || name.starts_with('-')
        || name.starts_with('/')
        || name.ends_with('/')
        || name.ends_with('.')
        || name.ends_with(".lock")
        || name.contains("//")
        || name.contains("..")
        || name.contains('@')
        || name.contains('\\')
    {
        return false;
    }
    name.chars()
        .all(|ch| !ch.is_control() && !ch.is_whitespace() && !matches!(ch, '~' | '^' | ':' | '?' | '*' | '['))
}

fn friendly_git_error(error: String) -> String {
    let lower = error.to_ascii_lowercase();
    if lower.contains("would be overwritten")
        || lower.contains("please commit your changes or stash")
        || (lower.contains("local changes") && lower.contains("switch"))
    {
        return "Those changes overlap files on that branch. Commit or stash them before switching."
            .into();
    }
    if lower.contains("already exists") {
        return "A branch with that name already exists.".into();
    }
    if lower.contains("not a valid branch name") || lower.contains("is not a valid") {
        return "That branch name is not valid.".into();
    }
    error
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::super::command::git;
    use super::super::status::current_branch;
    use super::{BranchKind, checkout_branch, create_branch, list_branches};

    fn scratch(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("ce-git-{name}-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn run_git(dir: &Path, args: &[&str]) {
        let result = git(dir, args);
        assert!(
            result.is_ok(),
            "git {args:?} in {} failed: {result:?}",
            dir.display()
        );
    }

    fn configure(repo: &Path) {
        run_git(repo, &["config", "user.email", "ce-git@example.com"]);
        run_git(repo, &["config", "user.name", "ce-git"]);
        run_git(repo, &["config", "core.autocrlf", "false"]);
    }

    fn init_repo(path: &Path) {
        fs::create_dir_all(path).unwrap();
        run_git(path, &["init", "-b", "main"]);
        configure(path);
    }

    fn commit_file(repo: &Path, name: &str, contents: &str, message: &str) {
        fs::write(repo.join(name), contents).unwrap();
        run_git(repo, &["add", name]);
        run_git(repo, &["commit", "-m", message]);
    }

    #[test]
    fn create_branch_keeps_current_changes() {
        let root = scratch("branch-create");
        let repo = root.join("repo");
        init_repo(&repo);
        commit_file(&repo, "README.md", "one\n", "initial");
        fs::write(repo.join("README.md"), "one\nedited\n").unwrap();
        fs::write(repo.join("staged.txt"), "staged\n").unwrap();
        run_git(&repo, &["add", "staged.txt"]);
        fs::write(repo.join("notes.txt"), "note\n").unwrap();

        create_branch(&repo, "feature/login").unwrap();

        let current = current_branch(&repo).unwrap();
        assert_eq!(current.name, "feature/login");
        assert!(!current.detached);
        assert_eq!(
            fs::read_to_string(repo.join("README.md")).unwrap(),
            "one\nedited\n"
        );
        let porcelain = git(&repo, &["status", "--porcelain=v1"]).unwrap();
        assert!(
            porcelain.lines().any(|line| line.ends_with("README.md")),
            "{porcelain}"
        );
        assert!(
            porcelain
                .lines()
                .any(|line| line.starts_with("A") && line.ends_with("staged.txt")),
            "{porcelain}"
        );
        assert!(
            porcelain
                .lines()
                .any(|line| line.starts_with("??") && line.ends_with("notes.txt")),
            "{porcelain}"
        );
        let main = git(&repo, &["rev-parse", "main"]).unwrap();
        let created = git(&repo, &["rev-parse", "feature/login"]).unwrap();
        assert_eq!(main, created);

        let listed = list_branches(&repo).unwrap();
        let created_row = listed
            .iter()
            .find(|branch| branch.name == "feature/login")
            .unwrap();
        assert!(created_row.current);
        assert_eq!(created_row.kind, BranchKind::Local);
        assert!(created_row.upstream.is_none());
        assert!(listed.iter().any(|branch| branch.name == "main" && !branch.current));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn checkout_keeps_changes_that_do_not_overlap() {
        let root = scratch("branch-carry");
        let repo = root.join("repo");
        init_repo(&repo);
        commit_file(&repo, "README.md", "one\n", "initial");
        run_git(&repo, &["checkout", "-b", "feature"]);
        commit_file(&repo, "FEATURE.md", "feature\n", "feature");
        run_git(&repo, &["checkout", "main"]);
        fs::write(repo.join("README.md"), "one\nedited\n").unwrap();
        fs::write(repo.join("staged.txt"), "staged\n").unwrap();
        run_git(&repo, &["add", "staged.txt"]);
        fs::write(repo.join("notes.txt"), "note\n").unwrap();

        let before = list_branches(&repo).unwrap();
        assert_eq!(before.first().map(|branch| branch.name.as_str()), Some("main"));
        assert!(before.iter().any(|branch| branch.name == "feature" && !branch.current));

        checkout_branch(&repo, "feature").unwrap();

        assert_eq!(current_branch(&repo).unwrap().name, "feature");
        assert_eq!(
            fs::read_to_string(repo.join("README.md")).unwrap(),
            "one\nedited\n"
        );
        assert_eq!(fs::read_to_string(repo.join("notes.txt")).unwrap(), "note\n");
        assert_eq!(fs::read_to_string(repo.join("FEATURE.md")).unwrap(), "feature\n");
        let porcelain = git(&repo, &["status", "--porcelain=v1"]).unwrap();
        assert!(
            porcelain
                .lines()
                .any(|line| line.starts_with("A") && line.ends_with("staged.txt")),
            "{porcelain}"
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn checkout_refuses_when_changes_would_be_overwritten() {
        let root = scratch("branch-overlap");
        let repo = root.join("repo");
        init_repo(&repo);
        commit_file(&repo, "README.md", "one\n", "initial");
        run_git(&repo, &["checkout", "-b", "feature"]);
        commit_file(&repo, "README.md", "feature\n", "feature");
        run_git(&repo, &["checkout", "main"]);
        fs::write(repo.join("README.md"), "dirty\n").unwrap();

        let error = checkout_branch(&repo, "feature").unwrap_err();
        assert!(error.contains("Commit or stash"), "{error}");
        assert_eq!(current_branch(&repo).unwrap().name, "main");
        assert_eq!(fs::read_to_string(repo.join("README.md")).unwrap(), "dirty\n");

        checkout_branch(&repo, "main").unwrap();
        assert_eq!(current_branch(&repo).unwrap().name, "main");
        assert_eq!(fs::read_to_string(repo.join("README.md")).unwrap(), "dirty\n");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn create_branch_rejects_invalid_and_existing_names() {
        let root = scratch("branch-invalid");
        let repo = root.join("repo");
        init_repo(&repo);
        commit_file(&repo, "README.md", "one\n", "initial");
        fs::write(repo.join("README.md"), "dirty\n").unwrap();

        for name in ["", "  ", "-bad", "bad name", "HEAD", "has..dots", "feature.lock", "--orphan"] {
            assert!(create_branch(&repo, name).is_err(), "{name}");
        }
        let exists = create_branch(&repo, "main").unwrap_err();
        assert!(exists.contains("already exists"), "{exists}");
        assert!(checkout_branch(&repo, "--orphan").is_err());
        let missing = checkout_branch(&repo, "missing").unwrap_err();
        assert!(missing.contains("not found"), "{missing}");
        assert_eq!(current_branch(&repo).unwrap().name, "main");
        assert_eq!(fs::read_to_string(repo.join("README.md")).unwrap(), "dirty\n");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn create_branch_renames_an_unborn_branch_and_keeps_files() {
        let root = scratch("branch-unborn");
        let repo = root.join("repo");
        init_repo(&repo);
        fs::write(repo.join("notes.txt"), "note\n").unwrap();

        create_branch(&repo, "feature").unwrap();

        assert_eq!(current_branch(&repo).unwrap().name, "feature");
        assert!(!current_branch(&repo).unwrap().detached);
        assert_eq!(fs::read_to_string(repo.join("notes.txt")).unwrap(), "note\n");
        let listed = list_branches(&repo).unwrap();
        assert!(listed.iter().any(|branch| branch.name == "feature" && branch.current));
        assert!(!listed.iter().any(|branch| branch.name == "main"));

        let same = create_branch(&repo, "feature").unwrap_err();
        assert!(same.contains("already"), "{same}");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn checkout_remote_branch_keeps_untracked_work() {
        let root = scratch("branch-remote");
        let origin = root.join("origin");
        init_repo(&origin);
        commit_file(&origin, "README.md", "one\n", "initial");
        run_git(&origin, &["checkout", "-b", "feature"]);
        commit_file(&origin, "FEATURE.md", "feature\n", "feature");
        run_git(&origin, &["checkout", "main"]);

        let clone = root.join("clone");
        run_git(&root, &["clone", origin.to_str().unwrap(), "clone"]);
        fs::write(clone.join("notes.txt"), "note\n").unwrap();

        let listed = list_branches(&clone).unwrap();
        let main = listed.iter().find(|branch| branch.name == "main").unwrap();
        assert!(main.current);
        assert_eq!(main.upstream.as_deref(), Some("origin/main"));
        assert!(listed.iter().any(|branch| {
            branch.name == "origin/feature" && branch.kind == BranchKind::Remote
        }));
        assert!(!listed.iter().any(|branch| branch.name == "origin/main" || branch.name == "origin/HEAD"));
        let main_at = listed.iter().position(|branch| branch.name == "main").unwrap();
        let remote_at = listed
            .iter()
            .position(|branch| branch.name == "origin/feature")
            .unwrap();
        assert!(main_at < remote_at);

        checkout_branch(&clone, "origin/feature").unwrap();

        assert_eq!(current_branch(&clone).unwrap().name, "feature");
        assert_eq!(fs::read_to_string(clone.join("notes.txt")).unwrap(), "note\n");
        let feature_text = fs::read_to_string(clone.join("FEATURE.md"))
            .unwrap()
            .replace("\r\n", "\n");
        assert_eq!(feature_text, "feature\n");
        let after = list_branches(&clone).unwrap();
        let feature = after.iter().find(|branch| branch.name == "feature").unwrap();
        assert!(feature.current);
        assert_eq!(feature.kind, BranchKind::Local);
        assert_eq!(feature.upstream.as_deref(), Some("origin/feature"));
        assert!(!after.iter().any(|branch| branch.name == "origin/feature"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn create_branch_from_detached_head_keeps_the_edit() {
        let root = scratch("branch-detached");
        let repo = root.join("repo");
        init_repo(&repo);
        commit_file(&repo, "README.md", "one\n", "initial");
        run_git(&repo, &["checkout", "--detach"]);
        fs::write(repo.join("README.md"), "two\n").unwrap();

        let listed = list_branches(&repo).unwrap();
        assert!(listed.iter().all(|branch| !branch.current));

        create_branch(&repo, "saved").unwrap();

        let current = current_branch(&repo).unwrap();
        assert_eq!(current.name, "saved");
        assert!(!current.detached);
        assert_eq!(fs::read_to_string(repo.join("README.md")).unwrap(), "two\n");

        let _ = fs::remove_dir_all(root);
    }
}
