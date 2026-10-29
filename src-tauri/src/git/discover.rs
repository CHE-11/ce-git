use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use serde::Serialize;

use super::command::dir_name;

const SKIP_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    ".next",
    "vendor",
    "venv",
    ".venv",
    "build",
    "out",
    "__pycache__",
];

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum NodeKind {
    Folder,
    Repo,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeNode {
    pub name: String,
    pub path: String,
    pub kind: NodeKind,
    pub children: Vec<TreeNode>,
}

pub fn discover(root: &Path) -> Result<TreeNode, String> {
    if !root.is_dir() {
        return Err(format!("Folder does not exist: {}", root.display()));
    }

    // The calling thread is one worker. The rest of the pool is extra slots.
    let slots = AtomicUsize::new(walk_parallelism().saturating_sub(1));
    Ok(walk(root, &slots).unwrap_or_else(|| TreeNode {
        name: dir_name(root),
        path: root.to_string_lossy().into_owned(),
        kind: NodeKind::Folder,
        children: Vec::new(),
    }))
}

fn walk_parallelism() -> usize {
    std::thread::available_parallelism()
        .map(|value| value.get())
        .unwrap_or(1)
        .clamp(1, 32)
}

pub(crate) fn is_repository(dir: &Path) -> bool {
    dir.join(".git").is_dir()
}

fn walk(dir: &Path, slots: &AtomicUsize) -> Option<TreeNode> {
    let scanned = scan_dir(dir);
    let mut children = walk_children(&scanned.children, slots);
    children.sort_by(|left, right| {
        left.name
            .to_lowercase()
            .cmp(&right.name.to_lowercase())
            .then_with(|| left.name.cmp(&right.name))
    });
    repo_or_empty(dir, scanned.is_repo, children)
}

struct DirScan {
    is_repo: bool,
    children: Vec<PathBuf>,
}

fn scan_dir(dir: &Path) -> DirScan {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => {
            return DirScan {
                is_repo: is_repository(dir),
                children: Vec::new(),
            };
        }
    };

    let mut is_repo = false;
    let mut children = Vec::new();
    for entry in entries.flatten() {
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name == ".git" {
            // A directory named .git is a repo. A .git file (worktree or submodule) is not.
            // A symlink still counts when it points at a directory, matching Path::is_dir.
            if file_type.is_dir() || (file_type.is_symlink() && entry.path().is_dir()) {
                is_repo = true;
            }
            continue;
        }
        if file_type.is_symlink() || !file_type.is_dir() {
            continue;
        }
        if SKIP_DIRS.iter().any(|skip| *skip == name) {
            continue;
        }
        children.push(entry.path());
    }

    DirScan { is_repo, children }
}

fn walk_children(paths: &[PathBuf], slots: &AtomicUsize) -> Vec<TreeNode> {
    if paths.is_empty() {
        return Vec::new();
    }

    let extra = take_slots(slots, paths.len().saturating_sub(1));
    let _guard = SlotGuard {
        slots,
        taken: extra,
    };
    if extra == 0 {
        return walk_chunk(paths, slots);
    }

    let chunks = even_chunks(paths, extra + 1);
    std::thread::scope(|scope| {
        let mut handles = Vec::with_capacity(chunks.len().saturating_sub(1));
        for chunk in &chunks[..chunks.len() - 1] {
            handles.push(scope.spawn(|| walk_chunk(chunk, slots)));
        }
        let mut children = walk_chunk(chunks[chunks.len() - 1], slots);
        for handle in handles {
            if let Ok(mut more) = handle.join() {
                children.append(&mut more);
            }
        }
        children
    })
}

fn walk_chunk(paths: &[PathBuf], slots: &AtomicUsize) -> Vec<TreeNode> {
    let mut children = Vec::new();
    for path in paths {
        if let Some(node) = walk(path, slots) {
            children.push(node);
        }
    }
    children
}

fn even_chunks(paths: &[PathBuf], workers: usize) -> Vec<&[PathBuf]> {
    let workers = workers.max(1).min(paths.len());
    let mut chunks = Vec::with_capacity(workers);
    let mut start = 0;
    for index in 0..workers {
        let remaining = workers - index;
        let len = (paths.len() - start).div_ceil(remaining);
        let end = start + len;
        chunks.push(&paths[start..end]);
        start = end;
    }
    chunks
}

fn take_slots(slots: &AtomicUsize, wanted: usize) -> usize {
    if wanted == 0 {
        return 0;
    }
    loop {
        let current = slots.load(Ordering::Relaxed);
        if current == 0 {
            return 0;
        }
        let taken = wanted.min(current);
        if slots
            .compare_exchange_weak(
                current,
                current - taken,
                Ordering::AcqRel,
                Ordering::Relaxed,
            )
            .is_ok()
        {
            return taken;
        }
    }
}

struct SlotGuard<'a> {
    slots: &'a AtomicUsize,
    taken: usize,
}

impl Drop for SlotGuard<'_> {
    fn drop(&mut self) {
        if self.taken > 0 {
            self.slots.fetch_add(self.taken, Ordering::Relaxed);
        }
    }
}

fn repo_or_empty(dir: &Path, is_repo: bool, children: Vec<TreeNode>) -> Option<TreeNode> {
    if !is_repo && children.is_empty() {
        return None;
    }

    Some(TreeNode {
        name: dir_name(dir),
        path: dir.to_string_lossy().into_owned(),
        kind: if is_repo {
            NodeKind::Repo
        } else {
            NodeKind::Folder
        },
        children,
    })
}
