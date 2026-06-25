use std::path::{Path, PathBuf};
use std::process::Command;

pub fn current_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

pub fn strip_windows_extended_prefix(s: String) -> String {
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{}", rest)
    } else if let Some(rest) = s.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        s
    }
}

pub fn path_to_file_url(path: &Path) -> String {
    let canon = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let s = strip_windows_extended_prefix(canon.to_string_lossy().to_string());
    let normalized = s.replace('\\', "/");
    if normalized.starts_with("//") {
        format!("file:{}", normalized)
    } else if normalized.starts_with('/') {
        format!("file://{}", normalized)
    } else {
        format!("file:///{}", normalized)
    }
}

pub fn find_edge_executable(custom: Option<&str>) -> Option<PathBuf> {
    if let Some(p) = custom {
        let path = PathBuf::from(p);
        if path.is_file() {
            return Some(path);
        }
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut c = Command::new("where");
        c.arg("msedge");
        c.creation_flags(0x08000000);
        if let Ok(output) = c.output() {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if let Some(line) = stdout.lines().next() {
                    let p = PathBuf::from(line.trim());
                    if p.is_file() {
                        return Some(p);
                    }
                }
            }
        }
    }

    let mut candidates: Vec<PathBuf> = Vec::new();
    #[cfg(windows)]
    {
        candidates.push(PathBuf::from(
            "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        ));
        candidates.push(PathBuf::from(
            "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
        ));
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            candidates.push(
                PathBuf::from(local).join("Microsoft\\Edge\\Application\\msedge.exe"),
            );
        }
        candidates.push(PathBuf::from(
            "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        ));
        candidates.push(PathBuf::from(
            "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        ));
    }
    #[cfg(target_os = "macos")]
    {
        candidates.push(PathBuf::from(
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        ));
        candidates.push(PathBuf::from(
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        ));
    }
    #[cfg(target_os = "linux")]
    {
        for p in &[
            "/usr/bin/microsoft-edge",
            "/usr/bin/microsoft-edge-stable",
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium",
        ] {
            candidates.push(PathBuf::from(p));
        }
    }

    for c in candidates {
        if c.is_file() {
            return Some(c);
        }
    }
    None
}

#[tauri::command]
pub fn check_pdf_engine(custom_edge: Option<String>) -> Option<String> {
    find_edge_executable(custom_edge.as_deref())
        .map(|p| p.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_extended_drive_prefix() {
        assert_eq!(
            strip_windows_extended_prefix(r"\\?\D:\work\a.md".to_string()),
            r"D:\work\a.md"
        );
    }

    #[test]
    fn strips_extended_unc_prefix() {
        assert_eq!(
            strip_windows_extended_prefix(
                r"\\?\UNC\192.168.1.224\工作共享\a.md".to_string(),
            ),
            r"\\192.168.1.224\工作共享\a.md"
        );
    }

    #[test]
    fn keeps_normal_drive_path() {
        assert_eq!(
            strip_windows_extended_prefix(r"D:\work\a.md".to_string()),
            r"D:\work\a.md"
        );
    }

    #[test]
    fn keeps_normal_unc_path() {
        assert_eq!(
            strip_windows_extended_prefix(r"\\server\share\a.md".to_string()),
            r"\\server\share\a.md"
        );
    }
}
