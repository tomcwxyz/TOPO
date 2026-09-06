use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};
use tauri::{path::BaseDirectory, AppHandle, Manager};

pub const CAPTURE_EXTENSION_ID: &str = "akckfofkebcbpbkcpcnemeaegpkbnpgd";
const HOST_NAME: &str = "uk.co.goodship.topo.capture";
const OLLAMA_INSTALL_SCRIPT: &str = "resources/ollama-install.sh";

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

fn host_filename() -> &'static str {
    if cfg!(windows) {
        "topo-native-host.exe"
    } else {
        "topo-native-host"
    }
}

fn host_path() -> Result<PathBuf, String> {
    Ok(host_directory()?.join(host_filename()))
}

fn manifest_path() -> Result<PathBuf, String> {
    Ok(host_directory()?.join(format!("{HOST_NAME}.json")))
}

fn bundled_host(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resolve(
            format!("resources/{}", host_filename()),
            BaseDirectory::Resource,
        )
        .map_err(|error| error.to_string())
}

fn bundled_extension(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resolve("resources/capture-extension", BaseDirectory::Resource)
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "linux")]
fn bundled_ollama_install_script(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resolve(OLLAMA_INSTALL_SCRIPT, BaseDirectory::Resource)
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

fn write_manifest(manifest: &Path, host: &Path) -> Result<(), String> {
    let payload = serde_json::json!({
        "name": HOST_NAME,
        "description": "Local bridge for governed TOPO AI conversation capture",
        "path": host.to_string_lossy(),
        "type": "stdio",
        "allowed_origins": [format!("chrome-extension://{CAPTURE_EXTENSION_ID}/")]
    });
    fs::write(
        manifest,
        serde_json::to_vec_pretty(&payload).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
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

#[cfg(target_os = "linux")]
fn register_native_host(manifest: &Path) -> Result<(), String> {
    let config = dirs::config_dir()
        .ok_or_else(|| "Unable to determine the browser configuration folder.".to_owned())?;
    let targets = [
        config.join("google-chrome/NativeMessagingHosts"),
        config.join("chromium/NativeMessagingHosts"),
        config.join("microsoft-edge/NativeMessagingHosts"),
        config.join("microsoft-edge-beta/NativeMessagingHosts"),
        config.join("microsoft-edge-dev/NativeMessagingHosts"),
    ];

    for directory in targets {
        fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
        fs::copy(manifest, directory.join(format!("{HOST_NAME}.json")))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(not(any(windows, target_os = "linux")))]
fn register_native_host(_manifest: &Path) -> Result<(), String> {
    Err("Packaged browser capture setup is currently available on Windows and Linux.".to_owned())
}

#[cfg(target_os = "linux")]
fn ensure_host_executable(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let mut permissions = fs::metadata(path)
        .map_err(|error| error.to_string())?
        .permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(path, permissions).map_err(|error| error.to_string())
}

#[cfg(not(target_os = "linux"))]
fn ensure_host_executable(_path: &Path) -> Result<(), String> {
    Ok(())
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
    let supported = cfg!(windows) || cfg!(target_os = "linux");

    Ok(BrowserCaptureSetupStatus {
        supported,
        prepared,
        extension_id: CAPTURE_EXTENSION_ID,
        extension_directory: prepared.then(|| extension.display().to_string()),
        host_path: prepared.then(|| host.display().to_string()),
        bundled_resources_available: resources_available,
        message: if !supported {
            "Packaged browser capture is not available on this operating system yet.".to_owned()
        } else if prepared {
            "Browser capture is prepared for Chrome, Edge and Chromium.".to_owned()
        } else if resources_available {
            "TOPO can set up browser capture on this computer in one click.".to_owned()
        } else {
            "This TOPO build does not include the packaged browser capture companion.".to_owned()
        },
    })
}

#[tauri::command]
pub fn prepare_browser_capture(app: AppHandle) -> Result<BrowserCaptureSetupStatus, String> {
    if !(cfg!(windows) || cfg!(target_os = "linux")) {
        return Err(
            "Packaged browser capture setup is currently available on Windows and Linux."
                .to_owned(),
        );
    }

    let source_host = bundled_host(&app)?;
    let source_extension = bundled_extension(&app)?;
    if !source_host.is_file() || !source_extension.is_dir() {
        return Err(
            "This TOPO build does not include the browser capture companion. Install the current TOPO desktop build and try again."
                .to_owned(),
        );
    }

    let destination_host_directory = host_directory()?;
    let destination_host = host_path()?;
    let destination_extension = extension_directory()?;
    let destination_manifest = manifest_path()?;

    fs::create_dir_all(&destination_host_directory).map_err(|error| error.to_string())?;
    fs::copy(&source_host, &destination_host).map_err(|error| error.to_string())?;
    ensure_host_executable(&destination_host)?;
    copy_directory(&source_extension, &destination_extension)?;
    write_manifest(&destination_manifest, &destination_host)?;
    register_native_host(&destination_manifest)?;

    browser_capture_setup_status(app)
}

#[tauri::command]
pub fn open_capture_extension_folder() -> Result<(), String> {
    let extension = extension_directory()?;
    if !extension.is_dir() {
        return Err("Set up browser capture before opening the extension folder.".to_owned());
    }

    #[cfg(windows)]
    {
        Command::new("explorer.exe")
            .arg(extension)
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(extension)
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Opening the browser extension folder is not supported on this operating system.".to_owned())
}

#[tauri::command]
pub fn open_ollama_download(app: AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        Command::new("rundll32.exe")
            .args([
                "url.dll,FileProtocolHandler",
                "https://ollama.com/download/windows",
            ])
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        let script = bundled_ollama_install_script(&app)?;
        if !script.is_file() {
            return Err(
                "This TOPO build is missing its verified Linux local-engine installer. Reinstall the current TOPO build and try again."
                    .to_owned(),
            );
        }

        let status = Command::new("pkexec")
            .arg("sh")
            .arg(&script)
            .status()
            .map_err(|error| {
                format!(
                    "TOPO could not open the Linux system installer. A graphical PolicyKit prompt is required: {error}"
                )
            })?;
        if !status.success() {
            return Err(
                "The Linux local-engine installation was cancelled or did not complete successfully."
                    .to_owned(),
            );
        }
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Automatic local-engine setup is currently available on Windows and Linux.".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn alpha_extension_id_is_valid_for_chromium_native_messaging() {
        assert_eq!(CAPTURE_EXTENSION_ID.len(), 32);
        assert!(CAPTURE_EXTENSION_ID
            .chars()
            .all(|character| ('a'..='p').contains(&character)));
    }

    #[test]
    fn native_host_filename_matches_platform_convention() {
        if cfg!(windows) {
            assert!(host_filename().ends_with(".exe"));
        } else {
            assert!(!host_filename().ends_with(".exe"));
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_local_engine_uses_a_bundled_installer() {
        assert_eq!(OLLAMA_INSTALL_SCRIPT, "resources/ollama-install.sh");
    }
}
