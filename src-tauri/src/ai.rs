use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

use crate::git::collect_ai_context;

const STORE_FILE: &str = "openai.json";
const KEY_NAME: &str = "apiKey";
const KEYRING_SERVICE: &str = "ce-git";
const KEYRING_USER: &str = "openai-api-key";
const MODEL_NAME: &str = "model";
const THINKING_NAME: &str = "thinking";
const PROMPT_NAMES: [&str; 3] = ["prompt1", "prompt2", "prompt3"];
static CREDENTIAL_LOCK: Mutex<()> = Mutex::new(());
const DEFAULT_THINKING: &str = "low";
const MISSING_KEY: &str = "Add an OpenAI API key in AI settings.";
const MISSING_MODEL: &str = "Choose a model in AI settings.";
const THINKING_MODES: &[&str] = &["none", "minimal", "low", "medium", "high", "xhigh", "max"];

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAiModel {
    pub id: String,
    pub created: i64,
    pub price: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettings {
    pub configured: bool,
    pub model: String,
    pub thinking: String,
    pub prompts: [String; 3],
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedCommit {
    pub subject: String,
    pub description: String,
}

pub fn openai_configured(app: &AppHandle) -> bool {
    match load_stored_key(app) {
        Ok(key) => key.is_some() || env_key().is_some(),
        Err(_) => plaintext_key(app).is_some() || env_key().is_some(),
    }
}

pub fn ai_settings(app: &AppHandle) -> AiSettings {
    AiSettings {
        configured: openai_configured(app),
        model: stored_string(app, MODEL_NAME)
            .or_else(|| std::env::var("OPENAI_MODEL").ok())
            .unwrap_or_default(),
        thinking: stored_string(app, THINKING_NAME).unwrap_or_else(|| DEFAULT_THINKING.to_string()),
        prompts: stored_prompts(app),
    }
}

pub fn save_ai_settings(
    app: &AppHandle,
    key: String,
    model: String,
    thinking: String,
    prompts: Vec<String>,
    clear_key: bool,
) -> Result<(), String> {
    with_credential_lock(|| store_key(app, &key, clear_key))?;

    let model = model.trim();
    let thinking = normalize_thinking(&thinking);
    if crate::app_settings::write_shared_ai(app, model, &thinking, &prompts)? {
        return Ok(());
    }

    let store = app.store(STORE_FILE).map_err(|error| error.to_string())?;
    if !model.is_empty() {
        store.set(MODEL_NAME, model);
    }
    store.set(THINKING_NAME, thinking);
    for (index, name) in PROMPT_NAMES.iter().enumerate() {
        let value = prompts.get(index).map(|item| item.trim()).unwrap_or("");
        if value.is_empty() {
            store.delete(*name);
        } else {
            store.set(*name, value);
        }
    }
    store.save().map_err(|error| error.to_string())?;
    Ok(())
}

pub async fn list_openai_models(
    app: AppHandle,
    key: String,
    include: String,
) -> Result<Vec<OpenAiModel>, String> {
    let key = if key.trim().is_empty() {
        resolve_key(&app)?
    } else {
        key.trim().to_string()
    };
    let models = fetch_models(&key).await?;
    let mut selected = select_text_models(models);
    let include = include.trim();
    if !include.is_empty() && !selected.iter().any(|model| model.id == include) {
        selected.push(priced_model(include.to_string(), 0));
    }
    Ok(selected)
}

pub async fn generate_commit_message(
    app: AppHandle,
    path: String,
    prompt: String,
) -> Result<GeneratedCommit, String> {
    let key = resolve_key(&app)?;
    let settings = ai_settings(&app);
    let model = if settings.model.trim().is_empty() {
        return Err(MISSING_MODEL.into());
    } else {
        settings.model
    };
    let thinking = settings.thinking;
    let path_buf = PathBuf::from(&path);
    let context = tauri::async_runtime::spawn_blocking(move || collect_ai_context(&path_buf))
        .await
        .map_err(|error| error.to_string())??;
    let name = std::path::Path::new(&path)
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or(path);

    request_commit_message(&key, &model, &thinking, prompt.trim(), &name, &context).await
}

async fn request_commit_message(
    key: &str,
    model: &str,
    thinking: &str,
    prompt: &str,
    repo: &str,
    context: &str,
) -> Result<GeneratedCommit, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|error| error.to_string())?;

    let mut body = serde_json::json!({
        "model": model,
        "reasoning_effort": thinking,
        "max_completion_tokens": 1200,
        "messages": [
            {
                "role": "system",
                "content": system_prompt(prompt)
            },
            {
                "role": "user",
                "content": format!("Repository: {repo}\n\nChanges:\n{context}")
            }
        ]
    });
    if thinking == "none" {
        body["temperature"] = serde_json::json!(0.2);
    }

    let response = client
        .post("https://api.openai.com/v1/chat/completions")
        .bearer_auth(key)
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("OpenAI request failed: {error}"))?;

    let status = response.status();
    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|error| format!("OpenAI response was not JSON: {error}"))?;

    if !status.is_success() {
        let message = payload["error"]["message"]
            .as_str()
            .unwrap_or("OpenAI request failed");
        return Err(format!("OpenAI ({status}): {message}"));
    }

    let content = payload["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("OpenAI returned an empty commit message")?;
    split_commit(content)
}

fn resolve_key(app: &AppHandle) -> Result<String, String> {
    if let Some(key) = load_stored_key(app)? {
        return Ok(key);
    }
    env_key().ok_or_else(|| MISSING_KEY.to_string())
}

fn load_stored_key(app: &AppHandle) -> Result<Option<String>, String> {
    with_credential_lock(|| {
        if let Some(key) = read_credential()? {
            forget_plaintext_key(app)?;
            return Ok(Some(key));
        }
        if let Some(key) = plaintext_key(app) {
            write_credential(&key)?;
            forget_plaintext_key(app)?;
            return Ok(Some(key));
        }
        Ok(None)
    })
}

fn store_key(app: &AppHandle, key: &str, clear_key: bool) -> Result<(), String> {
    if clear_key {
        forget_plaintext_key(app)?;
        return delete_credential();
    }

    let key = key.trim();
    if !key.is_empty() {
        write_credential(key)?;
    } else if read_credential()?.is_none() {
        if let Some(existing) = plaintext_key(app) {
            write_credential(&existing)?;
        }
    }
    forget_plaintext_key(app)
}

fn credential_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|error| credential_error("open", &error))
}

fn read_credential() -> Result<Option<String>, String> {
    match credential_entry()?.get_password() {
        Ok(value) => {
            let value = value.trim().to_string();
            if value.is_empty() {
                Ok(None)
            } else {
                Ok(Some(value))
            }
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(credential_error("read", &error)),
    }
}

fn write_credential(key: &str) -> Result<(), String> {
    credential_entry()?
        .set_password(key)
        .map_err(|error| credential_error("save", &error))
}

fn delete_credential() -> Result<(), String> {
    match credential_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(credential_error("remove", &error)),
    }
}

fn credential_error(action: &str, error: &keyring::Error) -> String {
    format!("Couldn't {action} the API key in the system credential manager: {error}")
}

fn with_credential_lock<T>(body: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    let _guard = CREDENTIAL_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    body()
}

fn plaintext_key(app: &AppHandle) -> Option<String> {
    stored_string(app, KEY_NAME)
}

fn forget_plaintext_key(app: &AppHandle) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|error| error.to_string())?;
    if store.get(KEY_NAME).is_none() {
        return Ok(());
    }
    store.delete(KEY_NAME);
    store
        .save()
        .map_err(|error| format!("Couldn't remove the API key from local app data: {error}"))
}

fn stored_prompts(app: &AppHandle) -> [String; 3] {
    PROMPT_NAMES.map(|name| stored_string(app, name).unwrap_or_default())
}

fn stored_string(app: &AppHandle, name: &str) -> Option<String> {
    if let Some(shared) = crate::app_settings::shared_string(app, name) {
        return shared;
    }
    let store = app.store(STORE_FILE).ok()?;
    let value = store.get(name)?;
    let text = value.as_str()?.trim().to_string();
    if text.is_empty() { None } else { Some(text) }
}

fn normalize_thinking(value: &str) -> String {
    let value = value.trim();
    if THINKING_MODES.contains(&value) {
        value.to_string()
    } else {
        DEFAULT_THINKING.to_string()
    }
}

async fn fetch_models(key: &str) -> Result<Vec<(String, i64)>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .get("https://api.openai.com/v1/models")
        .bearer_auth(key)
        .send()
        .await
        .map_err(|error| format!("OpenAI request failed: {error}"))?;
    let status = response.status();
    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|error| format!("OpenAI response was not JSON: {error}"))?;
    if !status.is_success() {
        let message = payload["error"]["message"]
            .as_str()
            .unwrap_or("OpenAI request failed");
        return Err(format!("OpenAI ({status}): {message}"));
    }

    let models = payload["data"]
        .as_array()
        .ok_or("OpenAI did not return a model list")?
        .iter()
        .filter_map(|model| {
            let id = model["id"].as_str()?.to_string();
            let created = model["created"].as_i64().unwrap_or(0);
            Some((id, created))
        })
        .collect();
    Ok(models)
}

fn select_text_models(models: Vec<(String, i64)>) -> Vec<OpenAiModel> {
    let mut groups: HashMap<String, (String, i64, bool)> = HashMap::new();
    for (id, created) in models {
        if !is_text_model(&id) {
            continue;
        }
        let canonical = canonical_model_id(&id);
        let dated = canonical != id;
        groups
            .entry(canonical)
            .and_modify(|current| {
                if !dated {
                    current.0 = id.clone();
                    current.2 = true;
                } else if !current.2 && created >= current.1 {
                    current.0 = id.clone();
                }
                if created > current.1 {
                    current.1 = created;
                }
            })
            .or_insert((id, created, !dated));
    }

    let mut selected: Vec<OpenAiModel> = groups
        .into_values()
        .map(|(id, created, _)| priced_model(id, created))
        .collect();
    selected.sort_by(|left, right| {
        right
            .created
            .cmp(&left.created)
            .then_with(|| left.id.cmp(&right.id))
    });
    selected.truncate(10);
    selected
}

fn priced_model(id: String, created: i64) -> OpenAiModel {
    let price = price_label(&id).to_string();
    OpenAiModel { id, created, price }
}

fn is_text_model(id: &str) -> bool {
    let id = id.to_ascii_lowercase();
    let blocked = [
        "whisper",
        "tts",
        "embed",
        "moderation",
        "realtime",
        "transcribe",
        "audio",
        "dall-e",
        "image",
        "sora",
        "omni-mod",
        "computer-use",
        "live",
        "diarize",
        "ft:",
        "davinci",
        "babbage",
        "curie",
        "ada",
    ];
    if blocked.iter().any(|part| id.contains(part)) {
        return false;
    }
    id.starts_with("gpt-")
        || id.starts_with("chatgpt")
        || id.starts_with("o1")
        || id.starts_with("o3")
        || id.starts_with("o4")
        || id.contains("chat-latest")
}

/// Standard output price per 1M tokens, short context.
/// `$` ≤ $2, `$$` ≤ $10, `$$$` ≤ $30, `$$$$` above that.
fn price_label(id: &str) -> &'static str {
    let lower = id.to_ascii_lowercase();
    if let Some(usd) = known_output_usd(&lower) {
        return tier_from_output(usd);
    }
    let canonical = canonical_model_id(&lower);
    if canonical != lower {
        if let Some(usd) = known_output_usd(&canonical) {
            return tier_from_output(usd);
        }
    }
    heuristic_tier(&canonical)
}

fn known_output_usd(id: &str) -> Option<f64> {
    const PRICES: &[(&str, f64)] = &[
        ("gpt-6-astra", 50.0),
        ("gpt-6.1-sol", 10.0),
        ("gpt-6-luna", 0.5),
        ("gpt-6-sol", 10.0),
        ("gpt-5.6-sol", 20.0),
        ("gpt-5.6-terra", 12.0),
        ("gpt-5.6-luna", 1.2),
        ("gpt-5.6-cyber", 75.0),
        ("gpt-5.5", 30.0),
        ("gpt-5.5-pro", 180.0),
        ("gpt-5.5-cyber", 75.0),
        ("gpt-5.4", 15.0),
        ("gpt-5.4-mini", 4.5),
        ("gpt-5.4-nano", 1.25),
        ("gpt-5.4-pro", 180.0),
        ("gpt-5.3-codex", 14.0),
        ("gpt-5.2", 14.0),
        ("gpt-5.2-pro", 168.0),
        ("gpt-5.1", 10.0),
        ("gpt-5", 10.0),
        ("gpt-5-mini", 2.0),
        ("gpt-5-nano", 0.4),
        ("gpt-5-pro", 120.0),
        ("gpt-5-search-api", 10.0),
        ("gpt-4.1", 8.0),
        ("gpt-4.1-mini", 1.6),
        ("gpt-4.1-nano", 0.4),
        ("gpt-4o", 10.0),
        ("gpt-4o-2024-05-13", 15.0),
        ("gpt-4o-mini", 0.6),
        ("gpt-4-turbo", 30.0),
        ("gpt-4-turbo-2024-04-09", 30.0),
        ("gpt-4", 60.0),
        ("gpt-4-0613", 60.0),
        ("gpt-3.5-turbo", 1.5),
        ("gpt-3.5-turbo-0125", 1.5),
        ("gpt-3.5-turbo-1106", 2.0),
        ("gpt-3.5-turbo-instruct", 2.0),
        ("o1", 60.0),
        ("o1-pro", 600.0),
        ("o3", 8.0),
        ("o3-pro", 80.0),
        ("o3-mini", 4.4),
        ("o4-mini", 4.4),
        ("chat-latest", 30.0),
        ("gpt-rosalind-research", 25.0),
        ("gpt-rosalind-discovery", 25.0),
    ];
    PRICES
        .iter()
        .find(|(name, _)| *name == id)
        .map(|(_, usd)| *usd)
}

fn tier_from_output(usd: f64) -> &'static str {
    if usd <= 2.0 {
        "$"
    } else if usd <= 10.0 {
        "$$"
    } else if usd <= 30.0 {
        "$$$"
    } else {
        "$$$$"
    }
}

fn heuristic_tier(id: &str) -> &'static str {
    if id.contains("pro")
        || id.contains("cyber")
        || id.contains("astra")
        || id == "o1"
        || id.starts_with("o1-")
    {
        return "$$$$";
    }
    if id.contains("nano") || id.contains("luna") || id.contains("mini") {
        return "$";
    }
    if id.contains("terra")
        || id.contains("codex")
        || id.contains("rosalind")
        || id.contains("turbo")
        || id.contains("chat-latest")
    {
        return "$$$";
    }
    "$$"
}

fn canonical_model_id(id: &str) -> String {
    let bytes = id.as_bytes();
    if bytes.len() <= 11 || bytes[bytes.len() - 11] != b'-' {
        return id.to_string();
    }
    let suffix = &id[id.len() - 10..];
    let dated = suffix.chars().enumerate().all(|(index, char)| match index {
        4 | 7 => char == '-',
        _ => char.is_ascii_digit(),
    });
    if dated {
        id[..id.len() - 11].to_string()
    } else {
        id.to_string()
    }
}

fn env_key() -> Option<String> {
    std::env::var("OPENAI_API_KEY")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

#[cfg(test)]
const DESCRIPTIVE_PROMPT: &str = "You write git commit messages. Reply with one conventional commit and nothing else. The first line is `type: summary` or `type(scope): summary`, at most 72 characters. After a blank line, write a description of two to six sentences that says what changed and why. Types: feat, fix, docs, style, refactor, test, chore, perf, build, ci. Do not wrap the message in quotes or markdown fences.";
const QUICK_PROMPT: &str = "You write git commit messages. Reply with one conventional commit subject and nothing else. The line is `type: summary` or `type(scope): summary`, at most 72 characters. Do not add a body. Types: feat, fix, docs, style, refactor, test, chore, perf, build, ci. Do not wrap the message in quotes or markdown fences.";

fn system_prompt(custom: &str) -> String {
    let custom = custom.trim();
    if custom.is_empty() {
        return QUICK_PROMPT.to_string();
    }
    custom.to_string()
}

fn split_commit(raw: &str) -> Result<GeneratedCommit, String> {
    let cleaned = clean_message(raw);
    let mut lines = cleaned.lines();
    let subject = loop {
        match lines.next() {
            Some(line) if line.trim().is_empty() => continue,
            Some(line) => break line.trim().to_string(),
            None => return Err("OpenAI returned an empty commit message".into()),
        }
    };
    if subject.is_empty() {
        return Err("OpenAI returned an empty commit message".into());
    }
    let description = lines
        .skip_while(|line| line.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string();
    Ok(GeneratedCommit {
        subject,
        description,
    })
}

fn clean_message(raw: &str) -> String {
    let trimmed = raw.trim();
    let without_fence = if trimmed.starts_with("```") {
        let mut lines: Vec<&str> = trimmed.lines().collect();
        if lines.first().is_some_and(|line| line.starts_with("```")) {
            lines.remove(0);
        }
        if lines.last().is_some_and(|line| line.starts_with("```")) {
            lines.pop();
        }
        lines.join("\n")
    } else {
        trimmed.to_string()
    };
    without_fence.trim().trim_matches('"').trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::select_text_models;

    #[test]
    fn selects_newest_text_aliases() {
        let models = vec![
            ("gpt-5.4-mini-2026-03-17".into(), 100),
            ("gpt-5.4-mini".into(), 90),
            ("whisper-1".into(), 200),
            ("text-embedding-3-small".into(), 180),
            ("gpt-5.4-nano".into(), 80),
        ];
        let selected = select_text_models(models);
        assert_eq!(selected[0].id, "gpt-5.4-mini");
        assert_eq!(selected[0].created, 100);
        assert_eq!(selected[0].price, "$$");
        assert!(
            selected
                .iter()
                .any(|model| model.id == "gpt-5.4-nano" && model.price == "$")
        );
        assert!(
            !selected
                .iter()
                .any(|model| model.id.contains("whisper") || model.id.contains("embed"))
        );
    }

    #[test]
    fn keeps_ten_newest_text_and_multimodal_models() {
        let mut models = vec![
            ("whisper-1".into(), 900),
            ("gpt-image-2".into(), 890),
            ("gpt-audio".into(), 880),
            ("gpt-realtime-2".into(), 870),
            ("gpt-4o-mini-transcribe".into(), 860),
            ("gpt-4o-mini-tts".into(), 850),
            ("text-embedding-3-large".into(), 840),
            ("gpt-live-1".into(), 830),
            ("sora-2".into(), 820),
        ];
        for index in 0..12 {
            models.push((format!("gpt-6-sample-{index}"), 100 + i64::from(index)));
        }
        models.push(("gpt-6-astra".into(), 50));
        let selected = super::select_text_models(models);
        assert_eq!(selected.len(), 10);
        assert_eq!(selected[0].id, "gpt-6-sample-11");
        assert_eq!(selected[0].price, "$$");
        assert!(
            selected
                .iter()
                .all(|model| model.id.starts_with("gpt-6-sample-"))
        );
        assert!(!selected.iter().any(|model| {
            let id = model.id.as_str();
            id.contains("whisper")
                || id.contains("image")
                || id.contains("audio")
                || id.contains("realtime")
                || id.contains("transcribe")
                || id.contains("tts")
                || id.contains("embed")
                || id.contains("live")
                || id.contains("sora")
        }));
    }

    #[test]
    fn custom_prompt_is_used_as_written() {
        let prompt = super::system_prompt("Write like a release note.");
        assert_eq!(prompt, "Write like a release note.");
        assert_eq!(super::system_prompt("  "), super::QUICK_PROMPT);
        assert!(super::DESCRIPTIVE_PROMPT.contains("two to six sentences"));
    }

    #[test]
    fn splits_subject_and_description() {
        let subject_only = super::split_commit("feat: add zoom").expect("subject");
        assert_eq!(subject_only.subject, "feat: add zoom");
        assert_eq!(subject_only.description, "");

        let with_body = super::split_commit(
            "feat: add zoom\n\nStores the scale in local settings.\nIt applies on the next launch.",
        )
        .expect("body");
        assert_eq!(with_body.subject, "feat: add zoom");
        assert_eq!(
            with_body.description,
            "Stores the scale in local settings.\nIt applies on the next launch."
        );
    }

    #[test]
    fn prices_follow_output_token_tiers() {
        assert_eq!(super::price_label("gpt-5.4-nano"), "$");
        assert_eq!(super::price_label("gpt-6-luna"), "$");
        assert_eq!(super::price_label("gpt-5-mini"), "$");
        assert_eq!(super::price_label("gpt-5.4-mini"), "$$");
        assert_eq!(super::price_label("gpt-4o"), "$$");
        assert_eq!(super::price_label("gpt-6.1-sol"), "$$");
        assert_eq!(super::price_label("gpt-5.4"), "$$$");
        assert_eq!(super::price_label("gpt-5.5"), "$$$");
        assert_eq!(super::price_label("gpt-5.3-codex"), "$$$");
        assert_eq!(super::price_label("gpt-5.4-2026-03-17"), "$$$");
        assert_eq!(super::price_label("gpt-5.4-pro"), "$$$$");
        assert_eq!(super::price_label("gpt-6-astra"), "$$$$");
        assert_eq!(super::price_label("o1"), "$$$$");
    }

    #[test]
    fn credential_store_round_trip() {
        let entry = keyring::Entry::new("ce-git", "openai-api-key-test").expect("credential entry");
        let _ = entry.delete_credential();
        entry.set_password("ce-git-test-secret").expect("set");
        let saved = keyring::Entry::new("ce-git", "openai-api-key-test").expect("reopen");
        assert_eq!(saved.get_password().expect("get"), "ce-git-test-secret");
        saved.delete_credential().expect("delete");
        let gone = keyring::Entry::new("ce-git", "openai-api-key-test").expect("after delete");
        assert!(matches!(gone.get_password(), Err(keyring::Error::NoEntry)));
    }
}
