use serde::Serialize;
use std::{fs, path::{Path, PathBuf}, process::Command};
use tauri::{path::BaseDirectory, AppHandle, Manager};

pub const CAPTURE_EXTENSION_ID: &str = "akckfofkebcbpbkcpcnemeaegpkbnpgd";
const HOST_NAME: &str = "uk.co.goodship.topo.capture";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserCaptureSetupStatus {
    supported: bool,
    prepared: bool,
    extension_id: &'static str,
    extension_directory: Option<String>,
    host_path: Option<String>,
    bundled_resources_available: bool,
    message: String,
}

fn local_root() -> Result<PathBuf, String> {
    dirs::data_local_dir()
        .map(|path| path.join("TOPO"))
        .ok_or_else(|| "Unable to determine the local application data folder.".to_owned())
}

fn extension_directory() -> Result<PathBuf, String> {
    Ok(local_root()?.join("browser-extension"))
}

fn host_directory() -> Result<PathBuf, String> {
    Ok(local_root()?.join("native-messaging"))
}

fn host_path() -> Result<PathBuf, String> {
    Ok(host_directory()?.join("topo-native-host.exe"))
}

fn manifest_path() -> Result<PathBuf, String> {
    Ok(host_directory()?.join(format!("{HOST_NAME}.json")))
}

fn bundled_host(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resolve("resources/topo-native-host.exe", BaseDirectory::Resource)
        .map_err(|error| error.to_string())
}

fn bundled_extension(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resolve("resources/capture-extension", BaseDirectory::Resource)
        .map_err(|error| error.to_string())
}

fn copy_directory(source: &Path, destination: &Path) -> Result<(), String> {
    if destination.exists() {
        fs::remove_dir_all(destination).map_err(|error| error.to_string())?;
    }
    fs::create_dir_all(destination).map_err(|error| error.to_string())?;

    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        if source_path.is_dir() {
            copy_directory(&source_path, &destination_path)?;
        } else {
            fs::copy(&source_path, &destination_path).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

#[cfg(windows)]
fn register_native_host(manifest: &Path) -> Result<(), String> {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let manifest_value = manifest.to_string_lossy().to_string();

    for key_path in [
        format!(r"Software\Google\Chrome\NativeMessagingHosts\{HOST_NAME}"),
        format!(r"Software\Microsoft\Edge\NativeMessagingHosts\{HOST_NAME}"),
    ] {
        let (key, _) = hkcu
            .create_subkey(&key_path)
            .map_err(|error| error.to_string())?;
        key.set_value("", &manifest_value)
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[cfg(not(windows))]
fn register_native_host(_manifest: &Path) -> Result<(), String> {
    Err("Packaged browser capture setup is currently available on Windows only.".to_owned())
}

#[tauri::command]
pub fn browser_capture_setup_status(app: AppHandle) -> Result<BrowserCaptureSetupStatus, String> {
    let extension = extension_directory()?;
    let host = host_path()?;
    let manifest = manifest_path()?;
    let bundled_host = bundled_host(&app)?;
    let bundled_extension = bundled_extension(&app)?;
    let resources_available = bundled_host.is_file() && bundled_extension.is_dir();
    let prepared = extension.join("manifest.json").is_file() && host.is_file() && manifest.is_file();

    Ok(BrowserCaptureSetupStatus {
        supported: cfg!(windows),
        prepared,
        extension_id: CAPTURE_EXTENSION_ID,
        extension_directory: prepared.then(|| extension.display().to_string()),
        host_path: prepared.then(|| host.display().to_string()),
        bundled_resources_available: resources_available,
        message: if prepared {
            "Browser capture companion is prepared for Chrome and Edge.".to_owned()
        } else if resources_available {
            "TOPO can prepare the bundled browser capture companion on this computer.".to_owned()
        } else {
            "This TOPO build does not include the packaged browser capture companion.".to_owned()
        },
    })
}

#[tauri::command]
pub fn prepare_browser_capture(app: AppHandle) -> Result<BrowserCaptureSetupStatus, String> {
    if !cfg!(windows) {
        return Err("Packaged browser capture setup is currently available on Windows only.".to_owned());
    }

    let source_host = bundled_host(&app)?;
    let source_extension = bundled_extension(&app)?;
    if !source_host.is_file() || !source_extension.is_dir() {
        return Err(
            "This TOPO build does not include the browser capture companion. Install a Windows test build that bundles capture resources."
                .to_owned(),
        );
    }

    let destination_host_directory = host_directory()?;
    let destination_host = host_path()?;
    let destination_extension = extension_directory()?;
    let destination_manifest = manifest_path()?;

    fs::create_dir_all(&destination_host_directory).map_err(|error| error.to_string())?;
    fs::copy(&source_host, &destination_host).map_err(|error| error.to_string())?;
    copy_directory(&source_extension, &destination_extension)?;

    let manifest = serde_json::json!({
        "name": HOST_NAME,
        "description": "Local bridge for governed TOPO AI conversation capture",
        "path": destination_host.to_string_lossy(),
        "type": "stdio",
        "allowed_origins": [format!("chrome-extension://{CAPTURE_EXTENSION_ID}/")]
    });
    fs::write(
        &destination_manifest,
        serde_json::to_vec_pretty(&manifest).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;

    register_native_host(&destination_manifest)?;

    browser_capture_setup_status(app)
}

#[tauri::command]
pub fn open_capture_extension_folder() -> Result<(), String> {
    if !cfg!(windows) {
        return Err("Opening the packaged extension folder is currently available on Windows only.".to_owned());
    }

    let extension = extension_directory()?;
    if !extension.is_dir() {
        return Err("Prepare browser capture before opening the extension folder.".to_owned());
    }

    Command::new("explorer.exe")
        .arg(extension)
        .spawn()
        .map_err(|error| error.to_string())?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn alpha_extension_id_is_valid_for_chromium_native_messaging() {
        assert_eq!(CAPTURE_EXTENSION_ID.len(), 32);
        assert!(CAPTURE_EXTENSION_ID.chars().all(|character| ('a'..='p').contains(&character)));
    }
}
