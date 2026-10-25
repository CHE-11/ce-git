mod changes;
mod command;
mod commit;
mod diff;
mod discover;
mod github;
mod graph;
mod search;
mod settings;
mod status;
mod sync;

pub use changes::{contained_path, discard_change, ignore_change};
pub use command::git_available;

pub fn init_repo(path: &std::path::Path) -> Result<(), String> {
    if !path.is_dir() {
        return Err(format!("Folder does not exist: {}", path.display()));
    }
    if discover::is_repository(path) {
        return Err("That folder is already a git repository.".to_string());
    }
    command::git(path, &["init", "-b", "main"])?;
    Ok(())
}

pub fn clone_repo(url: &str, destination: &std::path::Path) -> Result<(), String> {
    let url = url.trim();
    if url.is_empty() || url.chars().any(|ch| ch.is_control()) {
        return Err("Enter a repository URL.".to_string());
    }
    if url.starts_with('-') {
        return Err("Repository URL cannot start with '-'.".to_string());
    }

    let parent = destination
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| "Choose a parent folder.".to_string())?;
    if !parent.is_dir() {
        return Err(format!("Folder does not exist: {}", parent.display()));
    }

    let name = destination
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .ok_or_else(|| "Enter a folder name.".to_string())?;
    if name == "." || name == ".." || name.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|'])
    {
        return Err("Folder name contains invalid characters.".to_string());
    }

    let destination = parent.join(name);
    if destination.exists() {
        return Err(format!(
            "A folder named {name} already exists in that location."
        ));
    }

    command::git(parent, &["clone", "--", url, name])?;
    if !discover::is_repository(&destination) {
        return Err("Clone finished but the folder is not a git repository.".to_string());
    }
    Ok(())
}
pub use commit::commit_repo;
pub use diff::{RepoDiff, collect_ai_context, repo_diff};
pub use discover::{TreeNode, discover};
pub use github::GithubRepos;
pub(crate) use github::{clone_url_for_account, fetch_github_repos, prepare_github_repos};
pub use graph::{RepoGraph, repo_graph};
pub use search::{RepoSearchResult, search_repos};
pub use settings::{
    GitSettings, git_cancel_sign_in, git_sign_in, git_sign_out, read_git_settings,
    save_git_settings,
};
pub use status::{RepoStatus, status_of};
pub use sync::{
    Outcome, PublishOptions, abort_merge, conflict_files, continue_merge, publish_repo,
    pull_default, push_repo,
};

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::command::git;
    use super::discover::{NodeKind, discover};
    use super::status::{is_github_url, status_of};
    use super::sync::{
        Outcome, PublishOptions, abort_merge, continue_merge, publish_repo, pull_default, push_repo,
    };
    use super::{TreeNode, commit_repo};

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

    fn repo_paths(node: &TreeNode) -> Vec<String> {
        let mut paths = Vec::new();
        if node.kind == NodeKind::Repo {
            paths.push(node.path.clone());
        }
        for child in &node.children {
            paths.extend(repo_paths(child));
        }
        paths
    }

    #[test]
    fn discovers_nested_repos_and_skips_node_modules() {
        let root = scratch("discover");
        let alpha = root.join("alpha");
        let beta = root.join("group").join("beta");
        init_repo(&alpha);
        init_repo(&beta);
        fs::write(alpha.join("README.md"), "alpha\n").unwrap();
        run_git(&alpha, &["add", "."]);
        run_git(&alpha, &["commit", "-m", "alpha"]);

        let hidden = alpha.join("node_modules").join("secret");
        fs::create_dir_all(hidden.join(".git")).unwrap();

        let tree = discover(&root).unwrap();
        let paths = repo_paths(&tree);
        assert!(
            paths.iter().any(|path| path.ends_with("alpha")),
            "{paths:?}"
        );
        assert!(paths.iter().any(|path| path.ends_with("beta")), "{paths:?}");
        assert!(
            !paths.iter().any(|path| path.contains("node_modules")),
            "{paths:?}"
        );
        assert!(
            tree.children
                .iter()
                .any(|child| child.name == "group" && child.kind == NodeKind::Folder)
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn a_git_file_does_not_make_a_repository() {
        let root = scratch("git-file");
        let decoy = root.join("decoy");
        fs::create_dir_all(&decoy).unwrap();
        fs::write(decoy.join(".git"), "gitdir: /nowhere\n").unwrap();
        let real = root.join("real");
        init_repo(&real);

        let tree = discover(&root).unwrap();
        let paths = repo_paths(&tree);
        assert!(paths.iter().any(|path| path.ends_with("real")), "{paths:?}");
        assert!(
            !paths.iter().any(|path| path.ends_with("decoy")),
            "{paths:?}"
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn status_and_commit_a_dirty_repo() {
        let root = scratch("commit");
        let beta = root.join("group").join("beta");
        init_repo(&beta);
        fs::write(beta.join("README.md"), "beta\n").unwrap();
        run_git(&beta, &["add", "."]);
        run_git(&beta, &["commit", "-m", "initial"]);
        fs::write(beta.join("note.txt"), "hello\n").unwrap();

        let before = status_of(&beta);
        assert!(before.error.is_none(), "{:?}", before.error);
        assert!(before.dirty);
        assert_eq!(before.branch, "main");
        assert_eq!(before.untracked, 1);
        assert_eq!(before.github, None);

        commit_repo(&beta, "chore: add note").unwrap();

        let after = status_of(&beta);
        assert!(!after.dirty, "{:?}", after);
        let subject = git(&beta, &["log", "-1", "--pretty=%s"]).unwrap();
        assert_eq!(subject.trim(), "chore: add note");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn status_reports_branch_ahead_and_behind() {
        let (tmp, seed, clone) = tracking_clone("status-ahead-behind");
        fs::write(clone.join("LOCAL.md"), "local\n").unwrap();
        run_git(&clone, &["add", "."]);
        run_git(&clone, &["commit", "-m", "local"]);

        fs::write(seed.join("REMOTE.md"), "remote\n").unwrap();
        run_git(&seed, &["add", "."]);
        run_git(&seed, &["commit", "-m", "remote"]);
        run_git(&seed, &["push"]);
        run_git(&clone, &["fetch"]);

        let status = status_of(&clone);
        assert!(status.error.is_none(), "{:?}", status.error);
        assert_eq!(status.branch, "main");
        assert!(!status.detached);
        assert!(status.has_commits);
        assert_eq!(status.upstream.as_deref(), Some("origin/main"));
        assert_eq!(status.ahead, 1);
        assert_eq!(status.behind, 1);
        assert_eq!(status.default_branch.as_deref(), Some("main"));
        assert_eq!(status.github, Some(false));
        assert!(!status.dirty);

        let _ = fs::remove_dir_all(tmp);
    }

    #[test]
    fn status_counts_an_untracked_directory_once() {
        let root = scratch("untracked-dir");
        let repo = root.join("repo");
        init_repo(&repo);
        fs::write(repo.join("README.md"), "one\n").unwrap();
        run_git(&repo, &["add", "."]);
        run_git(&repo, &["commit", "-m", "initial"]);
        let nested = repo.join("scratch");
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join("a.txt"), "a\n").unwrap();
        fs::write(nested.join("b.txt"), "b\n").unwrap();

        let status = status_of(&repo);
        assert!(status.error.is_none(), "{:?}", status.error);
        assert!(status.dirty);
        assert_eq!(status.untracked, 1);
        assert_eq!(status.staged, 0);
        assert_eq!(status.unstaged, 0);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn clone_repo_copies_a_local_repository() {
        let tmp = scratch("clone");
        let origin = tmp.join("origin");
        init_repo(&origin);
        fs::write(origin.join("README.md"), "cloned\n").unwrap();
        run_git(&origin, &["add", "."]);
        run_git(&origin, &["commit", "-m", "initial"]);

        let dest = tmp.join("copy");
        super::clone_repo(origin.to_str().unwrap(), &dest).unwrap();
        assert!(dest.join(".git").is_dir());
        let readme = fs::read_to_string(dest.join("README.md")).unwrap();
        assert!(readme.contains("cloned"));

        let again = super::clone_repo(origin.to_str().unwrap(), &dest);
        assert!(
            matches!(again, Err(ref message) if message.contains("already exists")),
            "{again:?}"
        );

        let missing_parent =
            super::clone_repo(origin.to_str().unwrap(), &tmp.join("missing").join("copy"));
        assert!(
            matches!(missing_parent, Err(ref message) if message.contains("does not exist")),
            "{missing_parent:?}"
        );

        let empty = super::clone_repo("  ", &tmp.join("empty"));
        assert!(
            matches!(empty, Err(ref message) if message.contains("URL")),
            "{empty:?}"
        );

        let _ = fs::remove_dir_all(tmp);
    }

    #[test]
    fn pull_fast_forwards_default_branch_without_switching() {
        let tmp = scratch("pull");
        let bare = tmp.join("origin.git");
        let seed = tmp.join("seed");
        let alpha = tmp.join("alpha");

        run_git(&tmp, &["init", "--bare", "-b", "main", "origin.git"]);
        init_repo(&seed);
        fs::write(seed.join("README.md"), "one\n").unwrap();
        run_git(&seed, &["add", "."]);
        run_git(&seed, &["commit", "-m", "initial"]);
        run_git(&seed, &["remote", "add", "origin", bare.to_str().unwrap()]);
        run_git(&seed, &["push", "-u", "origin", "HEAD"]);
        run_git(
            &tmp,
            &[
                "-c",
                "core.autocrlf=false",
                "clone",
                bare.to_str().unwrap(),
                "alpha",
            ],
        );
        configure(&alpha);
        run_git(&alpha, &["checkout", "-b", "feature"]);

        fs::write(seed.join("README.md"), "two\n").unwrap();
        run_git(&seed, &["add", "."]);
        run_git(&seed, &["commit", "-m", "second"]);
        run_git(&seed, &["push"]);

        let outcome = pull_default(&alpha);
        assert!(matches!(outcome, Outcome::Ok(_)), "{outcome:?}");
        let head = git(&alpha, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap();
        assert_eq!(head.trim(), "feature");
        let local_main = git(&alpha, &["rev-parse", "main"]).unwrap();
        let seed_main = git(&seed, &["rev-parse", "main"]).unwrap();
        assert_eq!(local_main.trim(), seed_main.trim());

        fs::write(alpha.join("dirty.txt"), "wip\n").unwrap();
        let skipped = pull_default(&alpha);
        assert!(
            matches!(skipped, Outcome::Skipped(ref message) if message.contains("Dirty")),
            "{skipped:?}"
        );

        let _ = fs::remove_dir_all(tmp);
    }

    #[test]
    fn pull_fast_forwards_checked_out_default_branch() {
        let tmp = scratch("pull-main");
        let bare = tmp.join("origin.git");
        let seed = tmp.join("seed");
        let alpha = tmp.join("alpha");

        run_git(&tmp, &["init", "--bare", "-b", "main", "origin.git"]);
        init_repo(&seed);
        fs::write(seed.join("README.md"), "one\n").unwrap();
        run_git(&seed, &["add", "."]);
        run_git(&seed, &["commit", "-m", "initial"]);
        run_git(&seed, &["remote", "add", "origin", bare.to_str().unwrap()]);
        run_git(&seed, &["push", "-u", "origin", "HEAD"]);
        run_git(
            &tmp,
            &[
                "-c",
                "core.autocrlf=false",
                "clone",
                bare.to_str().unwrap(),
                "alpha",
            ],
        );
        configure(&alpha);

        fs::write(seed.join("README.md"), "two\n").unwrap();
        run_git(&seed, &["add", "."]);
        run_git(&seed, &["commit", "-m", "second"]);
        run_git(&seed, &["push"]);

        let outcome = pull_default(&alpha);
        assert!(
            matches!(outcome, Outcome::Ok(ref message) if message.contains("main") && message.contains("1 commit")),
            "{outcome:?}"
        );
        let local_main = git(&alpha, &["rev-parse", "HEAD"]).unwrap();
        let seed_main = git(&seed, &["rev-parse", "HEAD"]).unwrap();
        assert_eq!(local_main.trim(), seed_main.trim());

        let again = pull_default(&alpha);
        assert!(
            matches!(again, Outcome::Skipped(ref message) if message.contains("already up to date")),
            "{again:?}"
        );

        let _ = fs::remove_dir_all(tmp);
    }

    fn tracking_clone(name: &str) -> (PathBuf, PathBuf, PathBuf) {
        let tmp = scratch(name);
        let bare = tmp.join("origin.git");
        let seed = tmp.join("seed");
        let clone = tmp.join("clone");
        run_git(&tmp, &["init", "--bare", "-b", "main", "origin.git"]);
        init_repo(&seed);
        fs::write(seed.join("README.md"), "one\n").unwrap();
        run_git(&seed, &["add", "."]);
        run_git(&seed, &["commit", "-m", "initial"]);
        run_git(&seed, &["remote", "add", "origin", bare.to_str().unwrap()]);
        run_git(&seed, &["push", "-u", "origin", "HEAD"]);
        run_git(
            &tmp,
            &[
                "-c",
                "core.autocrlf=false",
                "clone",
                bare.to_str().unwrap(),
                "clone",
            ],
        );
        configure(&clone);
        (tmp, seed, clone)
    }

    #[test]
    fn pull_merges_when_the_checked_out_branch_is_ahead() {
        let (tmp, seed, clone) = tracking_clone("pull-ahead");
        fs::write(clone.join("LOCAL.md"), "local\n").unwrap();
        run_git(&clone, &["add", "."]);
        run_git(&clone, &["commit", "-m", "local"]);

        fs::write(seed.join("REMOTE.md"), "remote\n").unwrap();
        run_git(&seed, &["add", "."]);
        run_git(&seed, &["commit", "-m", "remote"]);
        run_git(&seed, &["push"]);

        let outcome = pull_default(&clone);
        assert!(
            matches!(outcome, Outcome::Ok(ref message) if message.contains("Merged") && message.contains("main")),
            "{outcome:?}"
        );
        assert_eq!(
            fs::read_to_string(clone.join("LOCAL.md")).unwrap(),
            "local\n"
        );
        assert_eq!(
            fs::read_to_string(clone.join("REMOTE.md")).unwrap(),
            "remote\n"
        );
        let parents = git(&clone, &["rev-list", "--parents", "-n", "1", "HEAD"]).unwrap();
        assert_eq!(parents.split_whitespace().count(), 3, "{parents}");

        let _ = fs::remove_dir_all(tmp);
    }

    #[test]
    fn pull_merges_main_into_an_ahead_feature_branch() {
        let (tmp, seed, clone) = tracking_clone("pull-feature");
        run_git(&clone, &["checkout", "-b", "feature"]);
        fs::write(clone.join("FEATURE.md"), "feature\n").unwrap();
        run_git(&clone, &["add", "."]);
        run_git(&clone, &["commit", "-m", "feature"]);

        fs::write(seed.join("REMOTE.md"), "remote\n").unwrap();
        run_git(&seed, &["add", "."]);
        run_git(&seed, &["commit", "-m", "remote"]);
        run_git(&seed, &["push"]);

        let outcome = pull_default(&clone);
        assert!(
            matches!(outcome, Outcome::Ok(ref message) if message.contains("Merged") && message.contains("feature")),
            "{outcome:?}"
        );
        let head = git(&clone, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap();
        assert_eq!(head.trim(), "feature");
        let local_main = git(&clone, &["rev-parse", "main"]).unwrap();
        let seed_main = git(&seed, &["rev-parse", "main"]).unwrap();
        assert_eq!(local_main.trim(), seed_main.trim());
        assert!(clone.join("FEATURE.md").is_file());
        assert!(clone.join("REMOTE.md").is_file());

        let _ = fs::remove_dir_all(tmp);
    }

    #[test]
    fn pull_conflict_can_be_finished_after_the_markers_are_gone() {
        let (tmp, seed, clone) = tracking_clone("pull-conflict");
        fs::write(clone.join("README.md"), "local\n").unwrap();
        run_git(&clone, &["add", "."]);
        run_git(&clone, &["commit", "-m", "local"]);
        fs::write(seed.join("README.md"), "remote\n").unwrap();
        run_git(&seed, &["add", "."]);
        run_git(&seed, &["commit", "-m", "remote"]);
        run_git(&seed, &["push"]);

        let outcome = pull_default(&clone);
        assert!(
            matches!(outcome, Outcome::Conflict(ref message) if message.contains("README.md")),
            "{outcome:?}"
        );
        let again = pull_default(&clone);
        assert!(matches!(again, Outcome::Conflict(_)), "{again:?}");

        let unfinished = continue_merge(&clone);
        assert!(
            matches!(unfinished, Err(ref message) if message.contains("conflict markers")),
            "{unfinished:?}"
        );

        fs::write(clone.join("README.md"), "resolved\n").unwrap();
        let finished = continue_merge(&clone).unwrap();
        assert!(finished.contains("Committed"), "{finished}");
        assert_eq!(
            fs::read_to_string(clone.join("README.md")).unwrap(),
            "resolved\n"
        );
        assert!(git(&clone, &["rev-parse", "-q", "--verify", "MERGE_HEAD"]).is_err());

        let _ = fs::remove_dir_all(tmp);
    }

    #[test]
    fn pull_conflict_can_be_aborted() {
        let (tmp, seed, clone) = tracking_clone("pull-abort");
        fs::write(clone.join("README.md"), "local\n").unwrap();
        run_git(&clone, &["add", "."]);
        run_git(&clone, &["commit", "-m", "local"]);
        fs::write(seed.join("README.md"), "remote\n").unwrap();
        run_git(&seed, &["add", "."]);
        run_git(&seed, &["commit", "-m", "remote"]);
        run_git(&seed, &["push"]);

        let outcome = pull_default(&clone);
        assert!(matches!(outcome, Outcome::Conflict(_)), "{outcome:?}");
        let aborted = abort_merge(&clone).unwrap();
        assert!(aborted.contains("aborted"), "{aborted}");
        assert_eq!(
            fs::read_to_string(clone.join("README.md")).unwrap(),
            "local\n"
        );
        assert!(git(&clone, &["rev-parse", "-q", "--verify", "MERGE_HEAD"]).is_err());
        let missing = abort_merge(&clone);
        assert!(
            matches!(missing, Err(ref message) if message.contains("No merge")),
            "{missing:?}"
        );

        let _ = fs::remove_dir_all(tmp);
    }

    #[test]
    fn unpublished_repos_push_only_to_github() {
        assert!(is_github_url("https://github.com/acme/widget.git"));
        assert!(is_github_url("git@github.com:acme/widget.git"));
        assert!(!is_github_url("https://gitlab.com/acme/widget.git"));

        let tmp = scratch("unpublished");
        let local = tmp.join("local");
        init_repo(&local);
        fs::write(local.join("README.md"), "one\n").unwrap();
        run_git(&local, &["add", "."]);
        run_git(&local, &["commit", "-m", "initial"]);
        let status = status_of(&local);
        assert_eq!(status.github, None);

        let bare = tmp.join("origin.git");
        run_git(&tmp, &["init", "--bare", "-b", "main", "origin.git"]);
        run_git(&local, &["remote", "add", "origin", bare.to_str().unwrap()]);
        let skipped = push_repo(&local);
        assert!(
            matches!(skipped, Outcome::Skipped(ref message) if message.contains("not GitHub")),
            "{skipped:?}"
        );
        let after = status_of(&local);
        assert_eq!(after.github, Some(false));

        let _ = fs::remove_dir_all(tmp);
    }

    fn publish_options(name: &str, visibility: &str, homepage: &str) -> PublishOptions {
        PublishOptions {
            name: name.into(),
            description: String::new(),
            visibility: visibility.into(),
            homepage: homepage.into(),
        }
    }

    #[test]
    fn publish_rejects_invalid_repos_before_calling_github() {
        let tmp = scratch("publish");
        let missing = publish_repo(
            &tmp.join("missing"),
            &publish_options("widget", "private", ""),
        );
        assert!(
            matches!(missing, Outcome::Failed(ref message) if message.contains("not a git repository")),
            "{missing:?}"
        );

        let local = tmp.join("local");
        init_repo(&local);
        let empty = publish_repo(&local, &publish_options("widget", "private", ""));
        assert!(
            matches!(empty, Outcome::Failed(ref message) if message.contains("Commit")),
            "{empty:?}"
        );

        fs::write(local.join("README.md"), "one\n").unwrap();
        run_git(&local, &["add", "."]);
        run_git(&local, &["commit", "-m", "initial"]);

        let named = publish_repo(&local, &publish_options("bad name", "private", ""));
        assert!(
            matches!(named, Outcome::Failed(ref message) if message.contains("name")),
            "{named:?}"
        );
        let visibility = publish_repo(&local, &publish_options("widget", "secret", ""));
        assert!(
            matches!(visibility, Outcome::Failed(ref message) if message.contains("Visibility")),
            "{visibility:?}"
        );
        let homepage = publish_repo(&local, &publish_options("widget", "public", "example.com"));
        assert!(
            matches!(homepage, Outcome::Failed(ref message) if message.contains("Homepage")),
            "{homepage:?}"
        );

        let bare = tmp.join("origin.git");
        run_git(&tmp, &["init", "--bare", "-b", "main", "origin.git"]);
        run_git(&local, &["remote", "add", "origin", bare.to_str().unwrap()]);
        let exists = publish_repo(&local, &publish_options("widget", "private", ""));
        assert!(
            matches!(exists, Outcome::Failed(ref message) if message.contains("origin")),
            "{exists:?}"
        );

        let _ = fs::remove_dir_all(tmp);
    }

    #[test]
    fn search_finds_tracked_and_untracked_text() {
        let root = scratch("search");
        let repo = root.join("alpha");
        init_repo(&repo);
        fs::write(repo.join("README.md"), "alpha needle\n").unwrap();
        run_git(&repo, &["add", "."]);
        run_git(&repo, &["commit", "-m", "alpha"]);
        fs::write(repo.join("note.txt"), "untracked needle\n").unwrap();

        let path = repo.to_string_lossy().into_owned();
        let results = super::search_repos(
            vec![path.clone()],
            "needle".into(),
            false,
            false,
            false,
            String::new(),
        );
        assert_eq!(results.len(), 1);
        assert!(results[0].error.is_none(), "{:?}", results[0].error);
        let files: Vec<_> = results[0]
            .matches
            .iter()
            .map(|hit| hit.path.as_str())
            .collect();
        assert!(files.contains(&"README.md"), "{files:?}");
        assert!(files.contains(&"note.txt"), "{files:?}");

        let markdown = super::search_repos(
            vec![path.clone()],
            "needle".into(),
            false,
            false,
            false,
            "*.md".into(),
        );
        assert!(markdown[0].error.is_none(), "{:?}", markdown[0].error);
        assert!(
            markdown[0]
                .matches
                .iter()
                .all(|hit| hit.path.ends_with(".md")),
            "{:?}",
            markdown[0].matches
        );

        let missing = super::search_repos(
            vec![path],
            "zzznone".into(),
            true,
            false,
            false,
            String::new(),
        );
        assert!(missing[0].error.is_none(), "{:?}", missing[0].error);
        assert!(missing[0].matches.is_empty());

        let _ = fs::remove_dir_all(root);
    }
}
