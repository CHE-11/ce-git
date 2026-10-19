mod changes;
mod command;
mod commit;
mod diff;
mod discover;
mod settings;
mod status;
mod sync;

pub use changes::{contained_path, discard_change, ignore_change};
pub use command::git_available;

pub fn init_repo(path: &std::path::Path) -> Result<(), String> {
    if !path.is_dir() {
        return Err(format!("Folder does not exist: {}", path.display()));
    }
    if path.join(".git").exists() {
        return Err("That folder is already a git repository.".to_string());
    }
    command::git(path, &["init", "-b", "main"])?;
    Ok(())
}
pub use commit::commit_repo;
pub use diff::{RepoDiff, collect_ai_context, repo_diff};
pub use discover::{TreeNode, discover};
pub use settings::{
    GitSettings, git_cancel_sign_in, git_sign_in, git_sign_out, read_git_settings,
    save_git_settings,
};
pub use status::{RepoStatus, status_of};
pub use sync::{Outcome, pull_default, push_repo};

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::command::git;
    use super::discover::{NodeKind, discover};
    use super::status::{is_github_url, status_of};
    use super::sync::{Outcome, pull_default, push_repo};
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
            matches!(outcome, Outcome::Ok(ref message) if message.contains("main")),
            "{outcome:?}"
        );
        let local_main = git(&alpha, &["rev-parse", "HEAD"]).unwrap();
        let seed_main = git(&seed, &["rev-parse", "HEAD"]).unwrap();
        assert_eq!(local_main.trim(), seed_main.trim());

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
        run_git(
            &local,
            &["remote", "add", "origin", bare.to_str().unwrap()],
        );
        let skipped = push_repo(&local);
        assert!(
            matches!(skipped, Outcome::Skipped(ref message) if message.contains("not GitHub")),
            "{skipped:?}"
        );
        let after = status_of(&local);
        assert_eq!(after.github, Some(false));

        let _ = fs::remove_dir_all(tmp);
    }
}
