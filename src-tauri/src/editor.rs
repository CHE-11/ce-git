use std::env;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

pub fn open_in_editor(path: &Path, editor: &str) -> Result<(), String> {
    if !path.is_dir() {
        return Err(format!("Folder does not exist: {}", path.display()));
    }
    launch_editor(path, editor)
}

pub fn open_file_in_editor(path: &Path, editor: &str) -> Result<(), String> {
    if !path.is_file() {
        return Err(format!("File does not exist: {}", path.display()));
    }
    launch_editor(path, editor)
}

pub const DEFAULT_EDITOR: &str = "default";

pub struct EditorKind {
    pub id: &'static str,
    pub label: &'static str,
    /// Command names, first one preferred on Unix. Windows tries each with `where`.
    pub commands: &'static [&'static str],
    #[allow(dead_code)]
    pub exe_names: &'static [&'static str],
    #[allow(dead_code)]
    pub folders: &'static [&'static str],
}

const KINDS: &[EditorKind] = &[
    EditorKind {
        id: "code",
        label: "Visual Studio Code",
        commands: &["code"],
        exe_names: &["Code.exe"],
        folders: &[],
    },
    EditorKind {
        id: "code-insiders",
        label: "VS Code Insiders",
        commands: &["code-insiders"],
        exe_names: &["Code - Insiders.exe"],
        folders: &[],
    },
    EditorKind {
        id: "cursor",
        label: "Cursor",
        commands: &["cursor"],
        exe_names: &["Cursor.exe"],
        folders: &[],
    },
    EditorKind {
        id: "windsurf",
        label: "Windsurf",
        commands: &["windsurf"],
        exe_names: &["Windsurf.exe"],
        folders: &["Windsurf"],
    },
    EditorKind {
        id: "zed",
        label: "Zed",
        commands: &["zed"],
        exe_names: &["Zed.exe"],
        folders: &["Zed"],
    },
    EditorKind {
        id: "sublime",
        label: "Sublime Text",
        commands: &["subl", "sublime_text"],
        exe_names: &["sublime_text.exe"],
        folders: &["Sublime Text"],
    },
    EditorKind {
        id: "idea",
        label: "IntelliJ IDEA",
        commands: &["idea", "idea64"],
        exe_names: &["idea64.exe", "idea.exe"],
        folders: &["IDEA", "IntelliJ IDEA"],
    },
    EditorKind {
        id: "webstorm",
        label: "WebStorm",
        commands: &["webstorm", "webstorm64"],
        exe_names: &["webstorm64.exe", "webstorm.exe"],
        folders: &["WebStorm"],
    },
    EditorKind {
        id: "pycharm",
        label: "PyCharm",
        commands: &["pycharm", "pycharm64"],
        exe_names: &["pycharm64.exe", "pycharm.exe"],
        folders: &["PyCharm"],
    },
    EditorKind {
        id: "goland",
        label: "GoLand",
        commands: &["goland", "goland64"],
        exe_names: &["goland64.exe", "goland.exe"],
        folders: &["GoLand"],
    },
    EditorKind {
        id: "rustrover",
        label: "RustRover",
        commands: &["rustrover", "rustrover64"],
        exe_names: &["rustrover64.exe", "rustrover.exe"],
        folders: &["RustRover"],
    },
    EditorKind {
        id: "rider",
        label: "Rider",
        commands: &["rider", "rider64"],
        exe_names: &["rider64.exe", "rider.exe"],
        folders: &["Rider"],
    },
    EditorKind {
        id: "clion",
        label: "CLion",
        commands: &["clion", "clion64"],
        exe_names: &["clion64.exe", "clion.exe"],
        folders: &["CLion"],
    },
    EditorKind {
        id: "phpstorm",
        label: "PhpStorm",
        commands: &["phpstorm", "phpstorm64"],
        exe_names: &["phpstorm64.exe", "phpstorm.exe"],
        folders: &["PhpStorm"],
    },
    EditorKind {
        id: "rubymine",
        label: "RubyMine",
        commands: &["rubymine", "rubymine64"],
        exe_names: &["rubymine64.exe", "rubymine.exe"],
        folders: &["RubyMine"],
    },
];

pub fn is_known_editor(id: &str) -> bool {
    id == DEFAULT_EDITOR || KINDS.iter().any(|kind| kind.id == id)
}

pub fn editor_kind(id: &str) -> Option<&'static EditorKind> {
    KINDS.iter().find(|kind| kind.id == id)
}

pub fn editor_ids() -> impl Iterator<Item = &'static str> {
    std::iter::once(DEFAULT_EDITOR).chain(KINDS.iter().map(|kind| kind.id))
}

pub fn default_menu_editors() -> Vec<String> {
    ["default", "code", "cursor"]
        .into_iter()
        .map(str::to_string)
        .collect()
}

fn launch_editor(path: &Path, editor: &str) -> Result<(), String> {
    let executable = if editor.is_empty() || editor == DEFAULT_EDITOR {
        resolve_editor()?
    } else {
        require_named(editor)?
    };
    spawn_editor(&executable, path, &[]).map_err(|error| {
        format!(
            "Could not open {} in {}: {error}",
            path.display(),
            executable.display()
        )
    })
}

fn require_named(id: &str) -> Result<PathBuf, String> {
    let kind = editor_kind(id).ok_or_else(|| format!("Unknown editor: {id}"))?;
    #[cfg(windows)]
    {
        windows::locate(kind).ok_or_else(|| format!("{} was not found.", kind.label))
    }
    #[cfg(not(windows))]
    {
        let command = kind.commands.first().copied().unwrap_or(kind.id);
        unix_command(command, kind.label)
    }
}

fn resolve_editor() -> Result<PathBuf, String> {
    #[cfg(windows)]
    {
        windows::resolve_editor()
    }
    #[cfg(not(windows))]
    {
        unix_editor()
    }
}

pub fn open_in_editor_with_files(
    folder: &Path,
    files: &[PathBuf],
    editor: &str,
) -> Result<(), String> {
    if !folder.is_dir() {
        return Err(format!("Folder does not exist: {}", folder.display()));
    }
    let executable = if editor.is_empty() || editor == DEFAULT_EDITOR {
        resolve_editor()?
    } else {
        require_named(editor)?
    };
    spawn_editor(&executable, folder, files).map_err(|error| {
        format!(
            "Could not open {} in {}: {error}",
            folder.display(),
            executable.display()
        )
    })
}

fn spawn_editor(editor: &Path, folder: &Path, files: &[PathBuf]) -> std::io::Result<()> {
    let mut command = Command::new(editor);
    command
        .arg(folder)
        .args(files)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let mut child = command.spawn()?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

fn expand_env(value: &str) -> String {
    let mut expanded = String::new();
    let mut rest = value;
    while let Some(start) = rest.find('%') {
        expanded.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        if let Some(end) = after.find('%') {
            let name = &after[..end];
            if name.is_empty() {
                expanded.push('%');
            } else if let Some(replacement) = env::var_os(name) {
                expanded.push_str(&replacement.to_string_lossy());
            } else {
                expanded.push('%');
                expanded.push_str(name);
                expanded.push('%');
            }
            rest = &after[end + 1..];
        } else {
            expanded.push('%');
            expanded.push_str(after);
            break;
        }
    }
    expanded.push_str(rest);
    expanded
}

fn exe_from_open_command(command: &str) -> Option<String> {
    let command = expand_env(command.trim());
    let command = command.trim();
    if command.is_empty() {
        return None;
    }
    if let Some(rest) = command.strip_prefix('"') {
        let end = rest.find('"')?;
        let exe = rest[..end].trim();
        if exe.is_empty() {
            None
        } else {
            Some(exe.to_string())
        }
    } else {
        let exe = command.split_whitespace().next()?.trim();
        if exe.is_empty() {
            None
        } else {
            Some(exe.to_string())
        }
    }
}

fn opens_folders(path: &Path) -> bool {
    let Some(name) = path.file_name() else {
        return false;
    };
    let name = name.to_string_lossy().to_ascii_lowercase();
    const NAMES: &[&str] = &[
        "cursor.exe",
        "code.exe",
        "code - insiders.exe",
        "windsurf.exe",
        "zed.exe",
        "sublime_text.exe",
        "idea64.exe",
        "idea.exe",
        "webstorm64.exe",
        "webstorm.exe",
        "rider64.exe",
        "pycharm64.exe",
        "pycharm.exe",
        "goland64.exe",
        "rustrover64.exe",
        "clion64.exe",
        "phpstorm64.exe",
        "rubymine64.exe",
        "fleet.exe",
        "atom.exe",
    ];
    NAMES.contains(&name.as_str())
}

#[cfg(not(windows))]
fn unix_command(command: &str, label: &str) -> Result<PathBuf, String> {
    let output = Command::new("which")
        .arg(command)
        .output()
        .map_err(|error| format!("Could not look up {label}: {error}"))?;
    if !output.status.success() {
        return Err(format!("{label} was not found."));
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let path = PathBuf::from(text.lines().next().unwrap_or("").trim());
    if path.is_file() {
        return Ok(path);
    }
    Err(format!("{label} was not found."))
}

#[cfg(not(windows))]
fn unix_editor() -> Result<PathBuf, String> {
    let Some(editor) = env::var_os("VISUAL").or_else(|| env::var_os("EDITOR")) else {
        return Err("No code editor found. Set the EDITOR environment variable.".into());
    };
    let raw = editor.to_string_lossy();
    let program = raw.split_whitespace().next().unwrap_or("");
    let path = PathBuf::from(program);
    if path.is_file() {
        return Ok(path);
    }
    Err(format!("Editor command was not found: {program}"))
}

#[cfg(windows)]
mod windows {
    use std::env;
    use std::path::{Path, PathBuf};
    use std::process::{Command, Stdio};

    use winreg::RegKey;
    use winreg::enums::{HKEY_CLASSES_ROOT, HKEY_CURRENT_USER};

    use super::{exe_from_open_command, opens_folders};

    const SOURCE_EXTENSIONS: &[&str] =
        &[".tsx", ".ts", ".jsx", ".js", ".rs", ".json", ".md", ".py"];

    pub fn resolve_editor() -> Result<PathBuf, String> {
        if let Some(path) = default_associated_editor().or_else(installed_editor) {
            return Ok(path);
        }
        Err(
            "No code editor found. Install Cursor or Visual Studio Code, or set one as the default app for .ts files."
                .into(),
        )
    }

    fn default_associated_editor() -> Option<PathBuf> {
        for extension in SOURCE_EXTENSIONS {
            let Some(progid) = user_choice(extension).or_else(|| extension_progid(extension))
            else {
                continue;
            };
            let Some(command) = open_command(&progid) else {
                continue;
            };
            let Some(exe) = exe_from_open_command(&command) else {
                continue;
            };
            let raw = PathBuf::from(exe);
            let path = normalize_cli_path(&raw).unwrap_or(raw);
            if opens_folders(&path) && path.is_file() {
                return Some(path);
            }
        }
        None
    }

    fn user_choice(extension: &str) -> Option<String> {
        let base =
            format!(r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\{extension}");
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        reg_string(&hkcu, &format!(r"{base}\UserChoice"), "ProgId")
            .or_else(|| reg_string(&hkcu, &format!(r"{base}\UserChoiceLatest"), "ProgId"))
    }

    fn extension_progid(extension: &str) -> Option<String> {
        let hkcr = RegKey::predef(HKEY_CLASSES_ROOT);
        reg_string(&hkcr, extension, "")
    }

    fn open_command(progid: &str) -> Option<String> {
        let hkcr = RegKey::predef(HKEY_CLASSES_ROOT);
        for suffix in ["shell\\open\\command", "shell\\edit\\command"] {
            if let Some(value) = reg_string(&hkcr, &format!(r"{progid}\{suffix}"), "") {
                return Some(value);
            }
        }
        None
    }

    fn reg_string(hive: &RegKey, path: &str, name: &str) -> Option<String> {
        let key = hive.open_subkey(path).ok()?;
        let value: String = key.get_value(name).ok()?;
        let value = super::expand_env(value.trim());
        if value.is_empty() { None } else { Some(value) }
    }

    pub(super) fn find_cursor() -> Option<PathBuf> {
        first_file(&cursor_candidates()).or_else(|| where_exe("cursor"))
    }

    pub(super) fn find_code() -> Option<PathBuf> {
        first_file(&code_stable_candidates()).or_else(|| where_exe("code"))
    }

    fn find_code_insiders() -> Option<PathBuf> {
        first_file(&code_insiders_candidates()).or_else(|| where_exe("code-insiders"))
    }

    fn first_file(paths: &[PathBuf]) -> Option<PathBuf> {
        paths.iter().find(|path| path.is_file()).cloned()
    }

    fn installed_editor() -> Option<PathBuf> {
        find_cursor()
            .or_else(find_code)
            .or_else(find_code_insiders)
            .or_else(|| locate_id("windsurf"))
            .or_else(|| locate_id("zed"))
            .or_else(|| locate_id("sublime"))
            .or_else(|| locate_id("idea"))
            .or_else(|| locate_id("webstorm"))
            .or_else(|| locate_id("pycharm"))
            .or_else(|| locate_id("rider"))
            .or_else(|| locate_id("rustrover"))
            .or_else(|| locate_id("goland"))
            .or_else(|| locate_id("clion"))
            .or_else(|| locate_id("phpstorm"))
            .or_else(|| locate_id("rubymine"))
    }

    pub(super) fn locate(kind: &super::EditorKind) -> Option<PathBuf> {
        match kind.id {
            "code" => return find_code(),
            "code-insiders" => return find_code_insiders(),
            "cursor" => return find_cursor(),
            _ => {}
        }
        if !kind.folders.is_empty() {
            if let Some(path) = newest_install(kind.folders, kind.exe_names) {
                return Some(path);
            }
        }
        where_first(kind.commands)
    }

    fn locate_id(id: &str) -> Option<PathBuf> {
        super::editor_kind(id).and_then(locate)
    }

    fn where_first(commands: &[&str]) -> Option<PathBuf> {
        commands.iter().find_map(|command| where_exe(command))
    }

    fn newest_install(prefixes: &[&str], exe_names: &[&str]) -> Option<PathBuf> {
        if exe_names.is_empty() {
            return None;
        }
        let mut best: Option<(std::time::SystemTime, PathBuf)> = None;
        for root in install_roots() {
            let Ok(entries) = std::fs::read_dir(&root) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                let name = entry.file_name();
                let name = name.to_string_lossy();
                let matched = prefixes.iter().any(|prefix| {
                    name.to_ascii_lowercase()
                        .starts_with(&prefix.to_ascii_lowercase())
                });
                if !matched {
                    continue;
                }
                consider_tree(&path, exe_names, 0, &mut best);
            }
        }
        best.map(|(_, path)| path)
    }

    fn install_roots() -> Vec<PathBuf> {
        let mut roots = Vec::new();
        if let Some(local) = env::var_os("LOCALAPPDATA") {
            let local = PathBuf::from(local);
            roots.push(local.join("Programs"));
            roots.push(local.join("JetBrains").join("Toolbox").join("apps"));
        }
        if let Some(program_files) = env::var_os("ProgramFiles") {
            let program_files = PathBuf::from(program_files);
            roots.push(program_files.join("JetBrains"));
            roots.push(program_files);
        }
        if let Some(program_files) = env::var_os("ProgramFiles(x86)") {
            let program_files = PathBuf::from(program_files);
            roots.push(program_files.join("JetBrains"));
            roots.push(program_files);
        }
        roots
    }

    fn consider_tree(
        dir: &Path,
        exe_names: &[&str],
        depth: u8,
        best: &mut Option<(std::time::SystemTime, PathBuf)>,
    ) {
        if depth > 5 {
            return;
        }
        let mut found_here = false;
        for exe in exe_names {
            if consider_file(&dir.join(exe), best) {
                found_here = true;
            }
            if consider_file(&dir.join("bin").join(exe), best) {
                found_here = true;
            }
        }
        if found_here || depth == 5 {
            return;
        }
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with('.') {
                continue;
            }
            consider_tree(&path, exe_names, depth + 1, best);
        }
    }

    fn consider_file(path: &Path, best: &mut Option<(std::time::SystemTime, PathBuf)>) -> bool {
        if !path.is_file() {
            return false;
        }
        let modified = path
            .metadata()
            .and_then(|metadata| metadata.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        let replace = best
            .as_ref()
            .map(|(time, _)| modified >= *time)
            .unwrap_or(true);
        if replace {
            *best = Some((modified, path.to_path_buf()));
        }
        true
    }

    fn cursor_candidates() -> Vec<PathBuf> {
        let mut paths = Vec::new();
        if let Some(local) = env::var_os("LOCALAPPDATA") {
            let local = PathBuf::from(local);
            paths.push(local.join("Programs").join("cursor").join("Cursor.exe"));
            paths.push(local.join("Programs").join("Cursor").join("Cursor.exe"));
        }
        if let Some(program_files) = env::var_os("ProgramFiles") {
            paths.push(
                PathBuf::from(program_files)
                    .join("cursor")
                    .join("Cursor.exe"),
            );
        }
        paths
    }

    fn code_stable_candidates() -> Vec<PathBuf> {
        let mut paths = Vec::new();
        if let Some(local) = env::var_os("LOCALAPPDATA") {
            paths.push(
                PathBuf::from(&local)
                    .join("Programs")
                    .join("Microsoft VS Code")
                    .join("Code.exe"),
            );
        }
        if let Some(program_files) = env::var_os("ProgramFiles") {
            paths.push(
                PathBuf::from(program_files)
                    .join("Microsoft VS Code")
                    .join("Code.exe"),
            );
        }
        paths
    }

    fn code_insiders_candidates() -> Vec<PathBuf> {
        let mut paths = Vec::new();
        if let Some(local) = env::var_os("LOCALAPPDATA") {
            paths.push(
                PathBuf::from(local)
                    .join("Programs")
                    .join("Microsoft VS Code Insiders")
                    .join("Code - Insiders.exe"),
            );
        }
        if let Some(program_files) = env::var_os("ProgramFiles") {
            paths.push(
                PathBuf::from(program_files)
                    .join("Microsoft VS Code Insiders")
                    .join("Code - Insiders.exe"),
            );
        }
        paths
    }

    fn where_exe(name: &str) -> Option<PathBuf> {
        let output = hidden_command("where.exe").arg(name).output().ok()?;
        if !output.status.success() {
            return None;
        }
        let text = String::from_utf8_lossy(&output.stdout);
        let mut fallback = None;
        for line in text.lines() {
            let raw = PathBuf::from(line.trim());
            let Some(path) = normalize_cli_path(&raw) else {
                continue;
            };
            if is_app_execution_alias(&path) {
                fallback = Some(path);
                continue;
            }
            return Some(path);
        }
        fallback
    }

    fn hidden_command(program: &str) -> Command {
        use std::os::windows::process::CommandExt;
        let mut command = Command::new(program);
        command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .creation_flags(0x0800_0000);
        command
    }

    fn is_app_execution_alias(path: &Path) -> bool {
        path.to_string_lossy()
            .to_ascii_lowercase()
            .contains("windowsapps")
    }

    pub(super) fn normalize_cli_path(path: &Path) -> Option<PathBuf> {
        if !path.exists() {
            return None;
        }
        let name = path.file_name()?.to_string_lossy().to_ascii_lowercase();
        if name.ends_with(".exe") {
            return Some(path.to_path_buf());
        }
        let exe_name = if name.starts_with("cursor") {
            "Cursor.exe"
        } else if name.starts_with("code-insiders") || name.starts_with("code - insiders") {
            "Code - Insiders.exe"
        } else if name.starts_with("code") {
            "Code.exe"
        } else if name.starts_with("windsurf") {
            "Windsurf.exe"
        } else if name.starts_with("zed") {
            "Zed.exe"
        } else if name.starts_with("subl") || name.starts_with("sublime") {
            "sublime_text.exe"
        } else if name.starts_with("webstorm") {
            "webstorm64.exe"
        } else if name.starts_with("pycharm") {
            "pycharm64.exe"
        } else if name.starts_with("goland") {
            "goland64.exe"
        } else if name.starts_with("rustrover") {
            "rustrover64.exe"
        } else if name.starts_with("rider") {
            "rider64.exe"
        } else if name.starts_with("clion") {
            "clion64.exe"
        } else if name.starts_with("phpstorm") {
            "phpstorm64.exe"
        } else if name.starts_with("rubymine") {
            "rubymine64.exe"
        } else if name.starts_with("idea") {
            "idea64.exe"
        } else {
            return None;
        };
        let mut dir = path.parent()?;
        for _ in 0..4 {
            let exe = dir.join(exe_name);
            if exe.is_file() {
                return Some(exe);
            }
            dir = dir.parent()?;
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use super::{exe_from_open_command, expand_env, opens_folders};

    #[test]
    fn reads_quoted_executable() {
        let exe = exe_from_open_command(r#""C:\Program Files\cursor\Cursor.exe" "%1""#).unwrap();
        assert_eq!(exe, r"C:\Program Files\cursor\Cursor.exe");
    }

    #[test]
    fn reads_unquoted_executable() {
        let exe = exe_from_open_command(r"C:\Windows\notepad.exe %1").unwrap();
        assert_eq!(exe, r"C:\Windows\notepad.exe");
    }

    #[test]
    fn expands_environment_variables_in_commands() {
        let Ok(root) = std::env::var("SystemRoot") else {
            return;
        };
        assert_eq!(
            expand_env(r"%SystemRoot%\notepad.exe"),
            format!(r"{root}\notepad.exe")
        );
        let exe = exe_from_open_command(r#""%SystemRoot%\notepad.exe" "%1""#).unwrap();
        assert_eq!(exe, format!(r"{root}\notepad.exe"));
    }

    #[test]
    fn built_in_editors_include_the_default_and_popular_apps() {
        assert!(super::is_known_editor("default"));
        assert!(super::is_known_editor("code"));
        assert!(super::is_known_editor("cursor"));
        assert!(super::is_known_editor("windsurf"));
        assert!(super::is_known_editor("idea"));
        assert!(!super::is_known_editor("notepad"));
        assert_eq!(
            super::default_menu_editors(),
            vec![
                "default".to_string(),
                "code".to_string(),
                "cursor".to_string()
            ]
        );
    }

    #[test]
    fn folder_editors_are_known_by_file_name() {
        assert!(opens_folders(Path::new(r"C:\Apps\Cursor.exe")));
        assert!(opens_folders(Path::new(r"C:\Apps\Code.exe")));
        assert!(!opens_folders(Path::new(r"C:\Windows\notepad.exe")));
        assert!(!opens_folders(Path::new(r"C:\Windows\explorer.exe")));
    }

    #[cfg(windows)]
    #[test]
    fn cli_shim_resolves_to_editor_exe() {
        use std::fs;
        use std::time::{SystemTime, UNIX_EPOCH};

        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("ce-git-editor-{nanos}"));
        let bin = root.join("resources").join("app").join("bin");
        fs::create_dir_all(&bin).unwrap();
        let shim = bin.join("cursor.cmd");
        fs::write(&shim, "@echo off\n").unwrap();
        fs::write(root.join("Cursor.exe"), "").unwrap();

        let resolved = super::windows::normalize_cli_path(&shim).unwrap();
        assert_eq!(resolved, root.join("Cursor.exe"));
        let bin_shim = root.join("bin");
        fs::create_dir_all(&bin_shim).unwrap();
        let code_shim = bin_shim.join("code.cmd");
        fs::write(&code_shim, "@echo off\n").unwrap();
        fs::write(root.join("Code.exe"), "").unwrap();
        assert_eq!(
            super::windows::normalize_cli_path(&code_shim).unwrap(),
            root.join("Code.exe")
        );
        assert!(
            super::windows::normalize_cli_path(&PathBuf::from(r"C:\missing\cursor.cmd")).is_none()
        );

        let _ = fs::remove_dir_all(root);
    }
}
