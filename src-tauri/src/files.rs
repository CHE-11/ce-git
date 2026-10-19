use std::path::{Component, Path, PathBuf};

pub fn delete_folder(root: &Path, target: &Path) -> Result<(), String> {
    let target = child_directory(root, target)?;
    let visible = display_path(&target);
    trash::delete(&visible).map_err(|error| {
        format!(
            "Could not move {} to the Recycle Bin: {error}",
            visible.display()
        )
    })
}

fn child_directory(root: &Path, target: &Path) -> Result<PathBuf, String> {
    if !root.is_dir() {
        return Err(format!(
            "Workspace folder does not exist: {}",
            root.display()
        ));
    }
    if !target.exists() {
        return Err(format!("Folder does not exist: {}", target.display()));
    }

    let root = root
        .canonicalize()
        .map_err(|error| format!("Could not open {}: {error}", root.display()))?;
    let target = target
        .canonicalize()
        .map_err(|error| format!("Could not open {}: {error}", target.display()))?;

    if is_same_path(&root, &target) {
        return Err("The workspace folder cannot be deleted.".into());
    }
    if !is_strict_child(&root, &target) {
        return Err("That folder is outside the workspace.".into());
    }
    if !target.is_dir() {
        return Err("Only folders in the repository tree can be deleted.".into());
    }

    Ok(target)
}

fn display_path(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    path.to_path_buf()
}

fn component_eq(left: Component<'_>, right: Component<'_>) -> bool {
    left.as_os_str().eq_ignore_ascii_case(right.as_os_str())
}

fn is_same_path(left: &Path, right: &Path) -> bool {
    let mut left_iter = left.components();
    let mut right_iter = right.components();
    loop {
        match (left_iter.next(), right_iter.next()) {
            (None, None) => return true,
            (Some(left_component), Some(right_component))
                if component_eq(left_component, right_component) => {}
            _ => return false,
        }
    }
}

fn is_strict_child(root: &Path, target: &Path) -> bool {
    let mut root_iter = root.components();
    let mut target_iter = target.components();
    loop {
        match root_iter.next() {
            Some(root_component) => match target_iter.next() {
                Some(target_component) if component_eq(root_component, target_component) => {}
                _ => return false,
            },
            None => return target_iter.next().is_some(),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{child_directory, display_path, is_strict_child};

    fn scratch(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("ce-git-{name}-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn strips_verbatim_prefix() {
        assert_eq!(
            display_path(Path::new(r"\\?\C:\repos\demo")),
            PathBuf::from(r"C:\repos\demo")
        );
        assert_eq!(
            display_path(Path::new(r"\\?\UNC\server\share")),
            PathBuf::from(r"\\server\share")
        );
    }

    #[test]
    fn child_directory_accepts_descendants_only() {
        let root = scratch("delete-root");
        let child = root.join("group").join("repo");
        fs::create_dir_all(&child).unwrap();
        let sibling = scratch("delete-sibling");

        assert!(child_directory(&root, &child).is_ok());
        assert!(child_directory(&root, &root).is_err());
        assert!(child_directory(&root, &sibling).is_err());

        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&sibling);
    }

    #[cfg(windows)]
    #[test]
    fn strict_child_ignores_case_and_rejects_siblings() {
        let root = Path::new(r"C:\Work\Repos");
        assert!(is_strict_child(root, Path::new(r"c:\work\repos\app")));
        assert!(!is_strict_child(root, root));
        assert!(!is_strict_child(
            root,
            Path::new(r"C:\Work\Repos-other\app")
        ));
        assert!(!is_strict_child(root, Path::new(r"C:\Work")));
    }
}
