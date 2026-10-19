use std::fs;
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
const MIN_ZOOM: u32 = 80;
const MAX_ZOOM: u32 = 160;
const ZOOM_STEP: u32 = 10;
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
    pub commit_verbosity: String,
    pub selected_prompt: Option<u8>,
    pub font_zoom: u32,
    pub model: String,
    pub thinking: String,
    pub prompts: Vec<String>,
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
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct PortableFile {
    root_paths: Vec<String>,
    removed_repos: Vec<String>,
    commit_verbosity: String,
    selected_prompt: Option<u8>,
    font_zoom: u32,
    model: String,
    thinking: String,
    prompts: Vec<String>,
}

impl Default for PortableFile {
    fn default() -> Self {
        Self {
            root_paths: Vec::new(),
            removed_repos: Vec::new(),
            commit_verbosity: DEFAULT_VERBOSITY.to_string(),
            selected_prompt: None,
            font_zoom: DEFAULT_ZOOM,
            model: String::new(),
            thinking: DEFAULT_THINKING.to_string(),
            prompts: vec![String::new(); 3],
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

pub fn save_app_settings(
    app: &AppHandle,
    settings_folder: String,
    font_zoom: u32,
    selected_prompt: Option<u8>,
    prompts: Vec<String>,
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
        let prompt = normalize_prompt(selected_prompt);
        let prompts = normalize_prompts(prompts);
        let destination_exists = !next_folder.is_empty() && settings_path(&next_folder).is_file();
        let plan = folder_plan(&loaded.folder, &next_folder, destination_exists);

        match plan {
            FolderPlan::Local => {
                let mut file = loaded.file;
                file.prompts = prompts;
                file.selected_prompt = prompt;
                write_local_ai(app, &file)?;
                write_local_workspace(app, &file)?;
                file.font_zoom = zoom;
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
                file.selected_prompt = prompt;
                file.prompts = prompts;
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
            if patch.root_paths.is_some() || patch.removed_repos.is_some() {
                write_local_paths(app, patch.root_paths, patch.removed_repos)?;
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
        commit_verbosity: file.commit_verbosity.clone(),
        selected_prompt: file.selected_prompt,
        font_zoom: file.font_zoom,
        model: file.model.clone(),
        thinking: file.thinking.clone(),
        prompts: file.prompts.clone(),
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
        model: json_string(ai.get("model")).unwrap_or_default(),
        thinking: json_string(ai.get("thinking")).unwrap_or_else(|| DEFAULT_THINKING.to_string()),
        prompts: PROMPT_KEYS
            .map(|key| json_string(ai.get(key)).unwrap_or_default())
            .to_vec(),
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
    store.set(POINTER_KEY, "");
    store.save().map_err(|error| error.to_string())
}

fn write_local_paths(
    app: &AppHandle,
    root_paths: Option<Vec<String>>,
    removed_repos: Option<Vec<String>>,
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
        self.commit_verbosity = normalize_verbosity(&self.commit_verbosity);
        self.selected_prompt = normalize_prompt(self.selected_prompt);
        self.font_zoom = clamp_zoom(self.font_zoom);
        self.model = self.model.trim().to_string();
        self.thinking = normalize_thinking(&self.thinking);
        self.prompts = normalize_prompts(std::mem::take(&mut self.prompts));
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

        let mut next = loaded;
        next.model = "gpt-test".into();
        write_portable_file(&path, &next).unwrap();
        let saved: PortableFile = super::read_portable_file(&path).unwrap().normalize();
        assert_eq!(saved.model, "gpt-test");
        assert_eq!(saved.root_paths, vec![r"\\server\share\repos"]);

        let _ = std::fs::remove_dir_all(&directory);
    }
}
