use serde::Serialize;

const LATEST_URL: &str = "https://github.com/CHE-11/ce-git/releases/latest/download/latest.json";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppRelease {
    pub version: String,
    pub notes: String,
}

#[derive(serde::Deserialize)]
struct LatestManifest {
    version: String,
    #[serde(default)]
    notes: String,
}

pub async fn app_release() -> Result<AppRelease, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|error| format!("Could not reach GitHub: {error}"))?;
    let response = client
        .get(LATEST_URL)
        .header("User-Agent", "ce-git")
        .header("Accept", "application/octet-stream")
        .send()
        .await
        .map_err(|error| format!("Could not reach GitHub: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("Couldn't read the latest release ({status})."));
    }
    let manifest: LatestManifest = response
        .json()
        .await
        .map_err(|error| format!("The latest release notes were not valid: {error}"))?;
    let version = manifest.version.trim().trim_start_matches('v').to_string();
    if version.is_empty() {
        return Err("The latest release did not include a version.".into());
    }
    Ok(AppRelease {
        version,
        notes: manifest.notes,
    })
}
