use std::fs;
use std::path::Path;

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

    Ok(walk(root).unwrap_or_else(|| TreeNode {
        name: dir_name(root),
        path: root.to_string_lossy().into_owned(),
        kind: NodeKind::Folder,
        children: Vec::new(),
    }))
}

fn walk(dir: &Path) -> Option<TreeNode> {
    let is_repo = dir.join(".git").exists();
    let mut children = Vec::new();

    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => {
            return repo_or_empty(dir, is_repo, children);
        }
    };

    for entry in entries.flatten() {
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };
        if file_type.is_symlink() || !file_type.is_dir() {
            continue;
        }

        let name = entry.file_name();
        let name = name.to_string_lossy();
        if SKIP_DIRS.iter().any(|skip| *skip == name) {
            continue;
        }

        if let Some(child) = walk(&entry.path()) {
            children.push(child);
        }
    }

    children.sort_by(|left, right| {
        left.name
            .to_lowercase()
            .cmp(&right.name.to_lowercase())
            .then_with(|| left.name.cmp(&right.name))
    });

    repo_or_empty(dir, is_repo, children)
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
