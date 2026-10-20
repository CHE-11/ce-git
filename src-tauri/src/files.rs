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

pub(crate) fn display_path(path: &Path) -> PathBuf {
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

pub fn reveal_path(path: &Path) -> Result<(), String> {
    let select_file = path.is_file();
    let target = if path.exists() {
        display_path(path)
    } else {
        let parent = path
            .parent()
            .filter(|parent| parent.exists())
            .ok_or_else(|| format!("Path does not exist: {}", path.display()))?;
        display_path(parent)
    };
    reveal_existing(&target, select_file && path.exists())
}

pub fn open_in_terminal(path: &Path) -> Result<(), String> {
    let path = if path.exists() {
        display_path(path)
    } else {
        return Err(format!("Folder does not exist: {}", path.display()));
    };
    if !path.is_dir() {
        return Err(format!("Folder does not exist: {}", path.display()));
    }
    #[cfg(windows)]
    {
        return windows_shell::open_terminal(&path);
    }
    #[cfg(target_os = "macos")]
    {
        return spawn_command("open", &["-a", "Terminal", &path.to_string_lossy()]);
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let directory = path.to_string_lossy();
        if spawn_command("x-terminal-emulator", &["--working-directory", &directory]).is_ok() {
            return Ok(());
        }
        return spawn_command("gnome-terminal", &["--working-directory", &directory]);
    }
}

pub fn open_with_default(path: &Path) -> Result<(), String> {
    if !path.is_file() {
        return Err(format!("File does not exist: {}", path.display()));
    }
    start_default(&display_path(path))
}

fn reveal_existing(path: &Path, select_file: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        return windows_shell::reveal(path, select_file);
    }
    #[cfg(target_os = "macos")]
    {
        let _ = select_file;
        return spawn_command("open", &["-R", &path.to_string_lossy()]);
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let _ = select_file;
        let directory = if path.is_dir() {
            path.to_path_buf()
        } else {
            path.parent().unwrap_or(path).to_path_buf()
        };
        return spawn_command("xdg-open", &[&directory.to_string_lossy()]);
    }
}

fn start_default(path: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        return windows_shell::open_path(path);
    }
    #[cfg(target_os = "macos")]
    {
        return spawn_command("open", &[&path.to_string_lossy()]);
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        return spawn_command("xdg-open", &[&path.to_string_lossy()]);
    }
}

#[cfg(unix)]
fn spawn_command(program: &str, args: &[&str]) -> Result<(), String> {
    std::process::Command::new(program)
        .args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|error| {
            format!(
                "Could not open {}: {error}",
                args.last().unwrap_or(&program)
            )
        })?;
    Ok(())
}

#[cfg(windows)]
mod windows_shell {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;
    use std::process::{Command, Stdio};

    #[link(name = "shell32")]
    unsafe extern "system" {
        fn ShellExecuteW(
            hwnd: *mut c_void,
            operation: *const u16,
            file: *const u16,
            parameters: *const u16,
            directory: *const u16,
            show_cmd: i32,
        ) -> isize;
    }

    pub fn reveal(path: &Path, select_file: bool) -> Result<(), String> {
        let mut command = Command::new("explorer.exe");
        if select_file {
            command.arg("/select,").arg(path);
        } else {
            command.arg(path);
        }
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| format!("Could not show {} in Explorer: {error}", path.display()))?;
        Ok(())
    }

    pub fn open_terminal(path: &Path) -> Result<(), String> {
        let mut terminal = Command::new("wt.exe");
        terminal
            .arg("-d")
            .arg(path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        if terminal.spawn().is_ok() {
            return Ok(());
        }
        Command::new("powershell.exe")
            .args(["-NoExit", "-NoLogo"])
            .current_dir(path)
            .stdin(Stdio::null())
            .spawn()
            .map_err(|error| format!("Could not open {} in a terminal: {error}", path.display()))?;
        Ok(())
    }

    pub fn open_path(path: &Path) -> Result<(), String> {
        let file = wide(path.as_os_str());
        let operation = wide(std::ffi::OsStr::new("open"));
        let code = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                operation.as_ptr(),
                file.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                1,
            )
        };
        if code > 32 {
            return Ok(());
        }
        Err(format!("Could not open {} (error {code}).", path.display()))
    }

    fn wide(value: &std::ffi::OsStr) -> Vec<u16> {
        value.encode_wide().chain(std::iter::once(0)).collect()
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
