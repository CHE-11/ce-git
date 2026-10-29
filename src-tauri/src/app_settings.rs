use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{Value as JsonValue, json};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

const POINTER_STORE: &str = "settings.json";
const POINTER_KEY: &str = "settingsFolder";
const AI_STORE: &str = "openai.json";
const SETTINGS_FILE_NAME: &str = "ce-git.json";
const DEFAULT_VERBOSITY: &str = "quick";
const DEFAULT_THINKING: &str = "low";
const DEFAULT_ZOOM: u32 = 100;
const MIN_ZOOM: u32 = 60;
const MAX_ZOOM: u32 = 160;
const ZOOM_STEP: u32 = 10;
const DEFAULT_THEME: &str = "zinc";
const DEFAULT_COLOR_MODE: &str = "dark";
const THEMES: &[&str] = &[
    "zinc",
    "nord",
    "catppuccin",
    "solarized",
    "dracula",
    "gruvbox",
    "tokyo",
    "rosepine",
    "github",
    "onedark",
];
const THEME_CSS_FILE_NAME: &str = "ce-git.css";
const MAX_THEME_CSS_BYTES: u64 = 256 * 1024;
const MAX_FOLDER_IGNORE_BYTES: usize = 16 * 1024;
const THEME_CSS_TEMPLATE: &str = "\
/*
ce-git loads this file on top of the selected theme.
Uncomment a block, edit the colors, and save.
This file is read when ce-git starts and when its window is focused.

Rules on html[data-theme][data-mode] override the built-in palette.
Shade numbers are roles: 950 is the page, 900 is a raised surface, 800 is hover,
700 is a border, 500 is muted text, and 100 is primary text.
sky is the main accent, violet is the AI accent, emerald is success,
amber is a warning, and red is an error. 600 is the solid button color.
*/

/*
html[data-theme][data-mode=\"dark\"] {
  --app-zinc-950: #09090b;
  --app-zinc-900: #18181b;
  --app-zinc-800: #27272a;
  --app-zinc-700: #3f3f46;
  --app-zinc-500: #71717a;
  --app-zinc-300: #d4d4d8;
  --app-zinc-100: #f4f4f5;
  --app-sky-400: #38bdf8;
  --app-sky-500: #0ea5e9;
  --app-sky-600: #0284c7;
  --app-violet-300: #c4b5fd;
  --app-violet-600: #7c3aed;
  --app-emerald-400: #34d399;
  --app-emerald-600: #059669;
  --app-amber-300: #fcd34d;
  --app-red-400: #f87171;
  --app-red-600: #dc2626;
}
*/

/*
html[data-theme][data-mode=\"light\"] {
  --app-zinc-950: #fafafa;
  --app-zinc-900: #f4f4f5;
  --app-zinc-800: #e4e4e7;
  --app-zinc-700: #d4d4d8;
  --app-zinc-500: #71717a;
  --app-zinc-300: #3f3f46;
  --app-zinc-100: #18181b;
  --app-sky-400: #0369a1;
  --app-sky-500: #0284c7;
  --app-sky-600: #0284c7;
  --app-violet-300: #6d28d9;
  --app-violet-600: #7c3aed;
  --app-emerald-400: #059669;
  --app-emerald-600: #059669;
  --app-amber-300: #b45309;
  --app-red-400: #dc2626;
  --app-red-600: #dc2626;
}
*/
";
const COLOR_MODES: &[&str] = &["dark", "light", "system"];
const THINKING_MODES: &[&str] = &["none", "minimal", "low", "medium", "high", "xhigh", "max"];
const PROMPT_KEYS: [&str; 3] = ["prompt1", "prompt2", "prompt3"];

static SETTINGS_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub settings_folder: String,
    pub settings_file: String,
    pub shared: bool,
    pub warning: Option<String>,
    pub root_paths: Vec<String>,
    pub removed_repos: Vec<String>,
    pub last_opened_repo: String,
    pub commit_verbosity: String,
    pub selected_prompt: Option<u8>,
    pub font_zoom: u32,
    pub theme: String,
    pub color_mode: String,
    pub toolbar_labels: bool,
    pub folder_color_background: bool,
    pub folder_color_background_unique: bool,
    pub folder_font_color: bool,
    pub folder_font_color_unique: bool,
    pub folder_indicator: bool,
    pub default_editor: String,
    pub menu_editors: Vec<String>,
    pub model: String,
    pub thinking: String,
    pub prompts: Vec<String>,
    pub folder_ignore: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettingsPatch {
    pub font_zoom: Option<u32>,
    pub commit_verbosity: Option<String>,
    pub selected_prompt: Option<u8>,
    pub clear_selected_prompt: bool,
    pub root_paths: Option<Vec<String>>,
    pub removed_repos: Option<Vec<String>>,
    pub last_opened_repo: Option<String>,
    pub folder_ignore: Option<String>,
}

impl Default for AppSettingsPatch {
    fn default() -> Self {
        Self {
            font_zoom: None,
            commit_verbosity: None,
            selected_prompt: None,
            clear_selected_prompt: false,
            root_paths: None,
            removed_repos: None,
            last_opened_repo: None,
            folder_ignore: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct PortableFile {
    root_paths: Vec<String>,
    removed_repos: Vec<String>,
    last_opened_repo: String,
    commit_verbosity: String,
    selected_prompt: Option<u8>,
    font_zoom: u32,
    theme: String,
    color_mode: String,
    toolbar_labels: bool,
    folder_color_background: bool,
    folder_color_background_unique: bool,
    folder_font_color: bool,
    folder_font_color_unique: bool,
    folder_indicator: bool,
    default_editor: String,
    menu_editors: Vec<String>,
    model: String,
    thinking: String,
    prompts: Vec<String>,
    folder_ignore: String,
}

impl Default for PortableFile {
    fn default() -> Self {
        Self {
            root_paths: Vec::new(),
            removed_repos: Vec::new(),
            last_opened_repo: String::new(),
            commit_verbosity: DEFAULT_VERBOSITY.to_string(),
            selected_prompt: None,
            font_zoom: DEFAULT_ZOOM,
            theme: DEFAULT_THEME.to_string(),
            color_mode: DEFAULT_COLOR_MODE.to_string(),
            toolbar_labels: false,
            folder_color_background: false,
            folder_color_background_unique: false,
            folder_font_color: false,
            folder_font_color_unique: false,
            folder_indicator: false,
            default_editor: crate::editor::DEFAULT_EDITOR.to_string(),
            menu_editors: crate::editor::default_menu_editors(),
            model: String::new(),
            thinking: DEFAULT_THINKING.to_string(),
            prompts: vec![String::new(); 3],
            folder_ignore: String::new(),
        }
    }
}

struct Loaded {
    folder: String,
    shared: bool,
    warning: Option<String>,
    file: PortableFile,
}

#[derive(Debug, PartialEq, Eq)]
enum FolderPlan {
    Local,
    Adopt,
    Write,
}

pub fn app_settings(app: &AppHandle) -> Result<AppSettings, String> {
    with_settings_lock(|| {
        let loaded = load_locked(app)?;
        Ok(view_of(&loaded))
    })
}

pub fn preview_app_settings(settings_folder: String) -> Result<AppSettings, String> {
    with_settings_lock(|| preview_folder(&settings_folder))
}

pub fn save_app_settings(
    app: &AppHandle,
    settings_folder: String,
    font_zoom: u32,
    theme: String,
    color_mode: String,
    toolbar_labels: bool,
    folder_color_background: bool,
    folder_color_background_unique: bool,
    folder_font_color: bool,
    folder_font_color_unique: bool,
    folder_indicator: bool,
    default_editor: String,
    menu_editors: Vec<String>,
    selected_prompt: Option<u8>,
    prompts: Vec<String>,
    folder_ignore: String,
) -> Result<AppSettings, String> {
    with_settings_lock(|| {
        let loaded = load_locked(app)?;
        let next_folder = normalize_folder(&settings_folder);
        if !next_folder.is_empty() {
            validate_folder(&next_folder)?;
        }
        if loaded.warning.is_some()
            && same_folder(&loaded.folder, &next_folder)
            && settings_path(&next_folder).is_file()
        {
            return Err(loaded.warning.clone().unwrap_or_else(|| {
                "Couldn't read the settings file, so it was left unchanged.".into()
            }));
        }

        let zoom = clamp_zoom(font_zoom);
        let theme = normalize_theme(&theme);
        let color_mode = normalize_color_mode(&color_mode);
        let prompt = normalize_prompt(selected_prompt);
        let prompts = normalize_prompts(prompts);
        let folder_ignore = normalize_folder_ignore(&folder_ignore)?;
        let default_editor = normalize_editor(&default_editor);
        let menu_editors = normalize_menu_editors(menu_editors);
        let destination_exists = !next_folder.is_empty() && settings_path(&next_folder).is_file();
        let plan = folder_plan(&loaded.folder, &next_folder, destination_exists);

        match plan {
            FolderPlan::Local => {
                let mut file = loaded.file;
                file.prompts = prompts;
                file.selected_prompt = prompt;
                file.folder_ignore = folder_ignore;
                write_local_ai(app, &file)?;
                write_local_workspace(app, &file)?;
                file.font_zoom = zoom;
                file.theme = theme;
                file.color_mode = color_mode;
                file.toolbar_labels = toolbar_labels;
                file.folder_color_background = folder_color_background;
                file.folder_color_background_unique = folder_color_background_unique;
                file.folder_font_color = folder_font_color && !folder_color_background;
                file.folder_font_color_unique = folder_font_color_unique;
                file.folder_indicator = folder_indicator;
                file.default_editor = default_editor;
                file.menu_editors = menu_editors;
                Ok(view_of(&Loaded {
                    folder: String::new(),
                    shared: false,
                    warning: None,
                    file,
                }))
            }
            FolderPlan::Adopt => {
                let path = settings_path(&next_folder);
                let file = read_portable_file(&path)?.normalize();
                write_pointer(app, &next_folder)?;
                Ok(view_of(&Loaded {
                    folder: next_folder,
                    shared: true,
                    warning: None,
                    file,
                }))
            }
            FolderPlan::Write => {
                let mut file = loaded.file;
                file.font_zoom = zoom;
                file.theme = theme;
                file.color_mode = color_mode;
                file.toolbar_labels = toolbar_labels;
                file.folder_color_background = folder_color_background;
                file.folder_color_background_unique = folder_color_background_unique;
                file.folder_font_color = folder_font_color;
                file.folder_font_color_unique = folder_font_color_unique;
                file.folder_indicator = folder_indicator;
                file.default_editor = default_editor;
                file.menu_editors = menu_editors;
                file.selected_prompt = prompt;
                file.prompts = prompts;
                file.folder_ignore = folder_ignore;
                file.normalize_in_place();
                let path = settings_path(&next_folder);
                write_portable_file(&path, &file)?;
                write_pointer(app, &next_folder)?;
                Ok(view_of(&Loaded {
                    folder: next_folder,
                    shared: true,
                    warning: None,
                    file,
                }))
            }
        }
    })
}

pub fn patch_app_settings(app: &AppHandle, patch: AppSettingsPatch) -> Result<(), String> {
    with_settings_lock(|| {
        let folder = read_pointer(app)?;
        if folder.is_empty() {
            if patch.root_paths.is_some()
                || patch.removed_repos.is_some()
                || patch.last_opened_repo.is_some()
            {
                write_local_paths(
                    app,
                    patch.root_paths,
                    patch.removed_repos,
                    patch.last_opened_repo,
                )?;
            }
            if let Some(pattern) = patch.folder_ignore {
                write_local_folder_ignore(app, &pattern)?;
            }
            return Ok(());
        }

        let path = settings_path(&folder);
        if !path.is_file() {
            return Err(format!("Settings file not found: {}", path.display()));
        }
        let mut file = read_portable_file(&path)?.normalize();
        if let Some(paths) = patch.root_paths {
            file.root_paths = clean_paths(paths);
        }
        if let Some(paths) = patch.removed_repos {
            file.removed_repos = clean_paths(paths);
        }
        if let Some(path) = patch.last_opened_repo {
            file.last_opened_repo = path.trim().to_string();
        }
        if let Some(zoom) = patch.font_zoom {
            file.font_zoom = clamp_zoom(zoom);
        }
        if let Some(verbosity) = patch.commit_verbosity {
            file.commit_verbosity = normalize_verbosity(&verbosity);
        }
        if patch.clear_selected_prompt {
            file.selected_prompt = None;
        } else if let Some(prompt) = patch.selected_prompt {
            file.selected_prompt = normalize_prompt(Some(prompt));
        }
        if let Some(pattern) = patch.folder_ignore {
            file.folder_ignore = normalize_folder_ignore(&pattern)?;
        }
        write_portable_file(&path, &file)
    })
}

pub fn write_shared_ai(
    app: &AppHandle,
    model: &str,
    thinking: &str,
    prompts: &[String],
) -> Result<bool, String> {
    with_settings_lock(|| {
        let folder = read_pointer(app)?;
        if folder.is_empty() {
            return Ok(false);
        }
        let path = settings_path(&folder);
        if !path.is_file() {
            return Err(format!(
                "Couldn't save AI settings. Settings file not found: {}",
                path.display()
            ));
        }
        let mut file = read_portable_file(&path)?.normalize();
        let model = model.trim();
        if !model.is_empty() {
            file.model = model.to_string();
        }
        file.thinking = normalize_thinking(thinking);
        file.prompts = normalize_prompts(prompts.to_vec());
        write_portable_file(&path, &file)?;
        Ok(true)
    })
}

pub fn shared_string(app: &AppHandle, name: &str) -> Option<Option<String>> {
    with_settings_lock(|| {
        let folder = read_pointer(app)?;
        if folder.is_empty() {
            return Ok(None);
        }
        let path = settings_path(&folder);
        if !path.is_file() {
            return Ok(None);
        }
        let file = read_portable_file(&path)?.normalize();
        let value = match name {
            "model" => file.model,
            "thinking" => file.thinking,
            "prompt1" => file.prompts.first().cloned().unwrap_or_default(),
            "prompt2" => file.prompts.get(1).cloned().unwrap_or_default(),
            "prompt3" => file.prompts.get(2).cloned().unwrap_or_default(),
            _ => return Ok(None),
        };
        let value = value.trim().to_string();
        if value.is_empty() {
            Ok(Some(None))
        } else {
            Ok(Some(Some(value)))
        }
    })
    .ok()
    .flatten()
}

fn with_settings_lock<T>(body: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    let _guard = SETTINGS_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    body()
}

fn preview_folder(settings_folder: &str) -> Result<AppSettings, String> {
    let folder = normalize_folder(settings_folder);
    if folder.is_empty() {
        return Err("Choose a folder.".into());
    }
    validate_folder(&folder)?;
    let path = settings_path(&folder);
    if !path.is_file() {
        return Ok(view_of(&Loaded {
            folder,
            shared: false,
            warning: None,
            file: PortableFile::default(),
        }));
    }
    match read_portable_file(&path) {
        Ok(file) => Ok(view_of(&Loaded {
            folder,
            shared: true,
            warning: None,
            file: file.normalize(),
        })),
        Err(error) => Ok(view_of(&Loaded {
            folder,
            shared: false,
            warning: Some(error),
            file: PortableFile::default(),
        })),
    }
}

fn load_locked(app: &AppHandle) -> Result<Loaded, String> {
    let folder = read_pointer(app)?;
    if folder.is_empty() {
        return Ok(Loaded {
            folder,
            shared: false,
            warning: None,
            file: read_local(app)?,
        });
    }

    let path = settings_path(&folder);
    if !path.is_file() {
        return Ok(Loaded {
            warning: Some(format!("Settings file not found: {}", path.display())),
            folder,
            shared: false,
            file: read_local(app)?,
        });
    }

    match read_portable_file(&path) {
        Ok(file) => Ok(Loaded {
            folder,
            shared: true,
            warning: None,
            file: file.normalize(),
        }),
        Err(error) => Ok(Loaded {
            folder,
            shared: false,
            warning: Some(error),
            file: read_local(app)?,
        }),
    }
}

fn view_of(loaded: &Loaded) -> AppSettings {
    let file = &loaded.file;
    AppSettings {
        settings_file: if loaded.folder.is_empty() {
            String::new()
        } else {
            settings_path(&loaded.folder).display().to_string()
        },
        settings_folder: loaded.folder.clone(),
        shared: loaded.shared,
        warning: loaded.warning.clone(),
        root_paths: file.root_paths.clone(),
        removed_repos: file.removed_repos.clone(),
        last_opened_repo: file.last_opened_repo.clone(),
        commit_verbosity: file.commit_verbosity.clone(),
        selected_prompt: file.selected_prompt,
        font_zoom: file.font_zoom,
        theme: file.theme.clone(),
        color_mode: file.color_mode.clone(),
        toolbar_labels: file.toolbar_labels,
        folder_color_background: file.folder_color_background,
        folder_color_background_unique: file.folder_color_background_unique,
        folder_font_color: file.folder_font_color,
        folder_font_color_unique: file.folder_font_color_unique,
        folder_indicator: file.folder_indicator,
        default_editor: file.default_editor.clone(),
        menu_editors: file.menu_editors.clone(),
        model: file.model.clone(),
        thinking: file.thinking.clone(),
        prompts: file.prompts.clone(),
        folder_ignore: file.folder_ignore.clone(),
    }
}

fn read_local(app: &AppHandle) -> Result<PortableFile, String> {
    let settings = app
        .store(POINTER_STORE)
        .map_err(|error| error.to_string())?;
    let ai = app.store(AI_STORE).map_err(|error| error.to_string())?;
    let mut root_paths = string_list(settings.get("rootPaths"));
    if root_paths.is_empty() {
        if let Some(root) = json_string(settings.get("rootPath")) {
            if !root.is_empty() {
                root_paths.push(root);
            }
        }
    }
    let mut file = PortableFile {
        root_paths,
        removed_repos: string_list(settings.get("removedRepos")),
        last_opened_repo: json_string(settings.get("lastOpenedRepo")).unwrap_or_default(),
        model: json_string(ai.get("model")).unwrap_or_default(),
        thinking: json_string(ai.get("thinking")).unwrap_or_else(|| DEFAULT_THINKING.to_string()),
        prompts: PROMPT_KEYS
            .map(|key| json_string(ai.get(key)).unwrap_or_default())
            .to_vec(),
        folder_ignore: json_string(settings.get("folderIgnore")).unwrap_or_default(),
        ..PortableFile::default()
    };
    file.normalize_in_place();
    Ok(file)
}

fn write_local_workspace(app: &AppHandle, file: &PortableFile) -> Result<(), String> {
    let store = app
        .store(POINTER_STORE)
        .map_err(|error| error.to_string())?;
    store.set("rootPaths", json!(file.root_paths));
    store.set(
        "rootPath",
        json!(file.root_paths.first().cloned().unwrap_or_default()),
    );
    store.set("removedRepos", json!(file.removed_repos));
    write_last_opened_value(&store, &file.last_opened_repo);
    write_folder_ignore_value(&store, &file.folder_ignore);
    store.set(POINTER_KEY, "");
    store.save().map_err(|error| error.to_string())
}

fn write_local_folder_ignore(app: &AppHandle, value: &str) -> Result<(), String> {
    let store = app
        .store(POINTER_STORE)
        .map_err(|error| error.to_string())?;
    write_folder_ignore_value(&store, &normalize_folder_ignore(value)?);
    store.save().map_err(|error| error.to_string())
}

fn write_folder_ignore_value(store: &tauri_plugin_store::Store<tauri::Wry>, value: &str) {
    if value.is_empty() {
        store.delete("folderIgnore");
    } else {
        store.set("folderIgnore", json!(value));
    }
}

fn write_last_opened_value(store: &tauri_plugin_store::Store<tauri::Wry>, value: &str) {
    let value = value.trim();
    if value.is_empty() {
        store.delete("lastOpenedRepo");
    } else {
        store.set("lastOpenedRepo", json!(value));
    }
}

fn write_local_paths(
    app: &AppHandle,
    root_paths: Option<Vec<String>>,
    removed_repos: Option<Vec<String>>,
    last_opened_repo: Option<String>,
) -> Result<(), String> {
    let store = app
        .store(POINTER_STORE)
        .map_err(|error| error.to_string())?;
    if let Some(paths) = root_paths {
        let paths = clean_paths(paths);
        store.set("rootPaths", json!(paths));
        store.set(
            "rootPath",
            json!(paths.first().cloned().unwrap_or_default()),
        );
    }
    if let Some(paths) = removed_repos {
        store.set("removedRepos", json!(clean_paths(paths)));
    }
    if let Some(path) = last_opened_repo {
        write_last_opened_value(&store, &path);
    }
    store.save().map_err(|error| error.to_string())
}

fn write_local_ai(app: &AppHandle, file: &PortableFile) -> Result<(), String> {
    let store = app.store(AI_STORE).map_err(|error| error.to_string())?;
    if file.model.trim().is_empty() {
        store.delete("model");
    } else {
        store.set("model", file.model.trim());
    }
    store.set("thinking", normalize_thinking(&file.thinking));
    for (index, key) in PROMPT_KEYS.iter().enumerate() {
        let value = file
            .prompts
            .get(index)
            .map(|item| item.trim())
            .unwrap_or("");
        if value.is_empty() {
            store.delete(*key);
        } else {
            store.set(*key, value);
        }
    }
    store.save().map_err(|error| error.to_string())
}

fn write_pointer(app: &AppHandle, folder: &str) -> Result<(), String> {
    let store = app
        .store(POINTER_STORE)
        .map_err(|error| error.to_string())?;
    store.set(POINTER_KEY, folder);
    store.save().map_err(|error| error.to_string())
}

fn read_pointer(app: &AppHandle) -> Result<String, String> {
    let store = app
        .store(POINTER_STORE)
        .map_err(|error| error.to_string())?;
    Ok(json_string(store.get(POINTER_KEY))
        .map(|value| normalize_folder(&value))
        .unwrap_or_default())
}

fn settings_path(folder: &str) -> PathBuf {
    Path::new(folder).join(SETTINGS_FILE_NAME)
}

pub fn theme_css(app: &AppHandle) -> Result<String, String> {
    with_settings_lock(|| {
        let folder = read_pointer(app)?;
        read_theme_css_file(&folder)
    })
}

fn theme_css_path(folder: &str) -> PathBuf {
    Path::new(folder).join(THEME_CSS_FILE_NAME)
}

fn ensure_theme_css_file(folder: &str) -> Result<(), String> {
    if folder.is_empty() || !Path::new(folder).is_dir() {
        return Ok(());
    }
    let path = theme_css_path(folder);
    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
    {
        Ok(mut file) => file
            .write_all(THEME_CSS_TEMPLATE.as_bytes())
            .map_err(|error| {
                let _ = fs::remove_file(&path);
                format!("Couldn't create {}: {error}", path.display())
            }),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
        Err(error) => Err(format!("Couldn't create {}: {error}", path.display())),
    }
}

fn read_theme_css_file(folder: &str) -> Result<String, String> {
    if folder.is_empty() {
        return Ok(String::new());
    }
    ensure_theme_css_file(folder)?;
    let path = theme_css_path(folder);
    if !path.is_file() {
        return Ok(String::new());
    }
    let metadata = fs::metadata(&path)
        .map_err(|error| format!("Couldn't read {}: {error}", path.display()))?;
    if metadata.len() > MAX_THEME_CSS_BYTES {
        return Err(format!(
            "{} is larger than 256 KB, so it was not loaded.",
            path.display()
        ));
    }
    let bytes =
        fs::read(&path).map_err(|error| format!("Couldn't read {}: {error}", path.display()))?;
    if bytes.contains(&0) {
        return Err(format!("{} is not a text stylesheet.", path.display()));
    }
    let text =
        String::from_utf8(bytes).map_err(|_| format!("{} is not valid UTF-8.", path.display()))?;
    Ok(text.trim_start_matches('\u{feff}').to_string())
}

fn read_portable_file(path: &Path) -> Result<PortableFile, String> {
    let bytes =
        fs::read(path).map_err(|error| format!("Couldn't read {}: {error}", path.display()))?;
    serde_json::from_slice(&bytes)
        .map_err(|error| format!("{} is not valid ce-git settings: {error}", path.display()))
}

fn write_portable_file(path: &Path, file: &PortableFile) -> Result<(), String> {
    let mut payload = serde_json::to_vec_pretty(file)
        .map_err(|error| format!("Couldn't save settings: {error}"))?;
    payload.push(b'\n');
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, &payload)
        .map_err(|error| format!("Couldn't save {}: {error}", path.display()))?;
    if fs::rename(&temporary, path).is_ok() {
        return Ok(());
    }
    let wrote = fs::write(path, &payload);
    let _ = fs::remove_file(&temporary);
    wrote.map_err(|error| format!("Couldn't save {}: {error}", path.display()))
}

fn validate_folder(folder: &str) -> Result<(), String> {
    let path = Path::new(folder);
    if path.is_dir() {
        return Ok(());
    }
    if path.exists() {
        return Err(format!("{folder} is not a folder."));
    }
    Err(format!("Folder does not exist: {folder}"))
}

fn json_string(value: Option<JsonValue>) -> Option<String> {
    let text = value?.as_str()?.trim().to_string();
    if text.is_empty() { None } else { Some(text) }
}

fn string_list(value: Option<JsonValue>) -> Vec<String> {
    let Some(items) = value.and_then(|value| value.as_array().cloned()) else {
        return Vec::new();
    };
    clean_paths(
        items
            .into_iter()
            .filter_map(|item| item.as_str().map(str::to_string))
            .collect(),
    )
}

fn clean_paths(paths: Vec<String>) -> Vec<String> {
    paths
        .into_iter()
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty())
        .collect()
}

impl PortableFile {
    fn normalize(mut self) -> Self {
        self.normalize_in_place();
        self
    }

    fn normalize_in_place(&mut self) {
        self.root_paths = clean_paths(std::mem::take(&mut self.root_paths));
        self.removed_repos = clean_paths(std::mem::take(&mut self.removed_repos));
        self.last_opened_repo = self.last_opened_repo.trim().to_string();
        self.commit_verbosity = normalize_verbosity(&self.commit_verbosity);
        self.selected_prompt = normalize_prompt(self.selected_prompt);
        self.font_zoom = clamp_zoom(self.font_zoom);
        self.theme = normalize_theme(&self.theme);
        self.color_mode = normalize_color_mode(&self.color_mode);
        if self.folder_color_background && self.folder_font_color {
            self.folder_font_color = false;
        }
        self.default_editor = normalize_editor(&self.default_editor);
        self.menu_editors = normalize_menu_editors(std::mem::take(&mut self.menu_editors));
        self.model = self.model.trim().to_string();
        self.thinking = normalize_thinking(&self.thinking);
        self.prompts = normalize_prompts(std::mem::take(&mut self.prompts));
        self.folder_ignore = tidy_folder_ignore(&self.folder_ignore);
    }
}

fn tidy_folder_ignore(value: &str) -> String {
    value.trim().replace("\r\n", "\n").replace('\r', "\n")
}

fn normalize_folder_ignore(value: &str) -> Result<String, String> {
    let normalized = tidy_folder_ignore(value);
    if normalized.len() > MAX_FOLDER_IGNORE_BYTES {
        return Err("Folder patterns are limited to 16 KB.".into());
    }
    Ok(normalized)
}

fn normalize_theme(value: &str) -> String {
    let value = value.trim();
    if THEMES.contains(&value) {
        value.to_string()
    } else {
        DEFAULT_THEME.to_string()
    }
}

fn normalize_editor(value: &str) -> String {
    let value = value.trim();
    if crate::editor::is_known_editor(value) {
        value.to_string()
    } else {
        crate::editor::DEFAULT_EDITOR.to_string()
    }
}

fn normalize_menu_editors(values: Vec<String>) -> Vec<String> {
    let mut chosen = Vec::new();
    for value in values {
        let id = value.trim();
        if crate::editor::is_known_editor(id) && !chosen.iter().any(|item: &String| item == id) {
            chosen.push(id.to_string());
        }
    }
    crate::editor::editor_ids()
        .filter(|id| chosen.iter().any(|item| item == *id))
        .map(str::to_string)
        .collect()
}

fn normalize_color_mode(value: &str) -> String {
    let value = value.trim();
    if COLOR_MODES.contains(&value) {
        value.to_string()
    } else {
        DEFAULT_COLOR_MODE.to_string()
    }
}

fn normalize_verbosity(value: &str) -> String {
    if value.trim() == "descriptive" {
        "descriptive".to_string()
    } else {
        DEFAULT_VERBOSITY.to_string()
    }
}

fn normalize_thinking(value: &str) -> String {
    let value = value.trim();
    if THINKING_MODES.contains(&value) {
        value.to_string()
    } else {
        DEFAULT_THINKING.to_string()
    }
}

fn normalize_prompt(value: Option<u8>) -> Option<u8> {
    match value {
        Some(1) | Some(2) | Some(3) => value,
        _ => None,
    }
}

fn normalize_prompts(prompts: Vec<String>) -> Vec<String> {
    let mut prompts: Vec<String> = prompts
        .into_iter()
        .take(3)
        .map(|prompt| prompt.trim().to_string())
        .collect();
    prompts.resize(3, String::new());
    prompts
}

fn clamp_zoom(value: u32) -> u32 {
    if value == 0 {
        return DEFAULT_ZOOM;
    }
    let stepped = value.saturating_add(ZOOM_STEP / 2) / ZOOM_STEP * ZOOM_STEP;
    stepped.clamp(MIN_ZOOM, MAX_ZOOM)
}

fn normalize_folder(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let stripped = trimmed.trim_end_matches(['/', '\\']);
    if stripped.is_empty() {
        return trimmed.to_string();
    }
    let bytes = stripped.as_bytes();
    if bytes.len() == 2 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic() {
        return format!("{stripped}\\");
    }
    stripped.to_string()
}

fn same_folder(left: &str, right: &str) -> bool {
    normalize_folder(left).eq_ignore_ascii_case(&normalize_folder(right))
}

fn folder_plan(previous: &str, next: &str, destination_exists: bool) -> FolderPlan {
    if next.is_empty() {
        return FolderPlan::Local;
    }
    if !same_folder(previous, next) && destination_exists {
        return FolderPlan::Adopt;
    }
    FolderPlan::Write
}

#[cfg(test)]
mod tests {
    use super::{
        DEFAULT_ZOOM, FolderPlan, PortableFile, clamp_zoom, folder_plan, normalize_folder,
        same_folder, write_portable_file,
    };

    #[test]
    fn zoom_stays_on_the_ten_percent_steps() {
        assert_eq!(clamp_zoom(0), DEFAULT_ZOOM);
        assert_eq!(clamp_zoom(50), 60);
        assert_eq!(clamp_zoom(60), 60);
        assert_eq!(clamp_zoom(80), 80);
        assert_eq!(clamp_zoom(84), 80);
        assert_eq!(clamp_zoom(85), 90);
        assert_eq!(clamp_zoom(100), 100);
        assert_eq!(clamp_zoom(160), 160);
        assert_eq!(clamp_zoom(1000), 160);
    }

    #[test]
    fn folder_paths_ignore_case_and_a_trailing_slash() {
        assert!(same_folder(r"C:\Settings", r"c:\settings\"));
        assert!(same_folder(r"\\server\share\app", r"\\server\share\app\"));
        assert!(same_folder(r"C:\", r"C:"));
        assert!(!same_folder(r"C:\Settings", r"C:\Settings2"));
        assert_eq!(normalize_folder("  "), "");
    }

    #[test]
    fn preview_reads_an_existing_settings_file() {
        let directory = std::env::temp_dir().join(format!(
            "ce-git-preview-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("ce-git.json");
        std::fs::write(
            &path,
            br#"{"rootPaths":["C:\\Repos"],"fontZoom":130,"theme":"nord","colorMode":"light"}"#,
        )
        .unwrap();

        let preview = super::preview_folder(&directory.to_string_lossy()).unwrap();
        assert!(preview.shared);
        assert_eq!(preview.font_zoom, 130);
        assert_eq!(preview.theme, "nord");
        assert_eq!(preview.color_mode, "light");
        assert_eq!(preview.root_paths, vec!["C:\\Repos"]);
        assert_eq!(preview.last_opened_repo, "");

        let missing = directory.join("missing-folder");
        assert!(super::preview_folder(&missing.to_string_lossy()).is_err());

        let _ = std::fs::remove_dir_all(&directory);
    }

    #[test]
    fn an_existing_file_in_a_new_folder_is_adopted() {
        assert_eq!(folder_plan("", "", false), FolderPlan::Local);
        assert_eq!(folder_plan(r"C:\Old", "", true), FolderPlan::Local);
        assert_eq!(
            folder_plan(r"C:\Settings\", r"C:\Settings", true),
            FolderPlan::Write
        );
        assert_eq!(
            folder_plan(r"C:\Old", r"D:\Shared", true),
            FolderPlan::Adopt
        );
        assert_eq!(
            folder_plan(r"C:\Old", r"D:\Shared", false),
            FolderPlan::Write
        );
    }

    #[test]
    fn partial_settings_round_trip_through_the_file() {
        let directory = std::env::temp_dir().join(format!(
            "ce-git-settings-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("ce-git.json");
        std::fs::write(
            &path,
            br#"{"rootPaths":["\\\\server\\share\\repos"],"fontZoom":130}"#,
        )
        .unwrap();

        let loaded: PortableFile = super::read_portable_file(&path).unwrap().normalize();
        assert_eq!(loaded.root_paths, vec![r"\\server\share\repos"]);
        assert_eq!(loaded.font_zoom, 130);
        assert_eq!(loaded.commit_verbosity, "quick");
        assert_eq!(loaded.prompts.len(), 3);
        assert_eq!(loaded.theme, "zinc");
        assert_eq!(loaded.color_mode, "dark");
        assert_eq!(loaded.toolbar_labels, false);
        assert_eq!(loaded.folder_color_background, false);
        assert_eq!(loaded.folder_color_background_unique, false);
        assert_eq!(loaded.folder_font_color, false);
        assert_eq!(loaded.folder_font_color_unique, false);
        assert_eq!(loaded.folder_indicator, false);
        assert_eq!(loaded.default_editor, "default");
        assert_eq!(
            loaded.menu_editors,
            vec![
                "default".to_string(),
                "code".to_string(),
                "cursor".to_string()
            ]
        );
        assert_eq!(loaded.folder_ignore, "");
        assert_eq!(loaded.last_opened_repo, "");

        let mut next = loaded;
        next.model = "gpt-test".into();
        next.theme = "nord".into();
        next.color_mode = "light".into();
        next.toolbar_labels = true;
        next.folder_color_background = true;
        next.folder_color_background_unique = true;
        next.folder_font_color = true;
        next.folder_font_color_unique = true;
        next.folder_indicator = true;
        next.default_editor = "cursor".into();
        next.menu_editors = vec!["zed".into(), "nope".into(), "code".into(), "zed".into()];
        next.folder_ignore = "node_modules\n(^|[\\\\/])vendor$".into();
        next.last_opened_repo = r"\\server\share\repos\app".into();
        write_portable_file(&path, &next).unwrap();
        let saved: PortableFile = super::read_portable_file(&path).unwrap().normalize();
        assert_eq!(saved.model, "gpt-test");
        assert_eq!(saved.root_paths, vec![r"\\server\share\repos"]);
        assert_eq!(saved.theme, "nord");
        assert_eq!(saved.color_mode, "light");
        assert_eq!(saved.toolbar_labels, true);
        assert_eq!(saved.folder_color_background, true);
        assert_eq!(saved.folder_color_background_unique, true);
        assert_eq!(saved.folder_font_color, false);
        assert_eq!(saved.folder_font_color_unique, true);
        assert_eq!(saved.folder_indicator, true);
        assert_eq!(saved.default_editor, "cursor");
        assert_eq!(
            saved.menu_editors,
            vec!["code".to_string(), "zed".to_string()]
        );
        assert_eq!(saved.folder_ignore, "node_modules\n(^|[\\\\/])vendor$");
        assert_eq!(saved.last_opened_repo, r"\\server\share\repos\app");

        let mut invalid = saved;
        invalid.theme = "nope".into();
        invalid.color_mode = "sepia".into();
        let normalized = invalid.normalize();
        assert_eq!(normalized.theme, "zinc");
        assert_eq!(normalized.color_mode, "dark");

        let _ = std::fs::remove_dir_all(&directory);
    }

    #[test]
    fn known_themes_are_kept_and_unknown_themes_fall_back() {
        for theme in [
            "zinc",
            "nord",
            "catppuccin",
            "solarized",
            "dracula",
            "gruvbox",
            "tokyo",
            "rosepine",
            "github",
            "onedark",
        ] {
            let mut file = PortableFile::default();
            file.theme = theme.into();
            assert_eq!(file.normalize().theme, theme);
        }
    }

    #[test]
    fn theme_css_reads_a_stylesheet_from_the_settings_folder() {
        let directory = std::env::temp_dir().join(format!(
            "ce-git-theme-css-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let folder = directory.to_string_lossy().to_string();

        assert_eq!(super::read_theme_css_file("").unwrap(), "");
        let missing = directory.join("missing");
        assert_eq!(
            super::read_theme_css_file(&missing.to_string_lossy()).unwrap(),
            ""
        );
        assert!(!missing.join("ce-git.css").exists());

        let created = super::read_theme_css_file(&folder).unwrap();
        assert_eq!(created, super::THEME_CSS_TEMPLATE);
        assert_eq!(super::read_theme_css_file(&folder).unwrap(), created);

        let path = directory.join("ce-git.css");
        std::fs::write(&path, "\u{feff}html { color: red; }").unwrap();
        assert_eq!(
            super::read_theme_css_file(&folder).unwrap(),
            "html { color: red; }"
        );

        std::fs::write(&path, b"html { color: red; }\0").unwrap();
        assert!(
            super::read_theme_css_file(&folder)
                .unwrap_err()
                .contains("not a text stylesheet")
        );

        std::fs::write(&path, vec![b'a'; (256 * 1024) + 1]).unwrap();
        assert!(
            super::read_theme_css_file(&folder)
                .unwrap_err()
                .contains("256 KB")
        );

        let _ = std::fs::remove_dir_all(&directory);
    }
}
