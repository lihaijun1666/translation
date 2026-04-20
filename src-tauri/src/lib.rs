use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine};
use serde::Serialize;
use tauri::Emitter;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LoadedDocumentPayload {
    path: String,
    name: String,
    file_type: String,
    text_content: Option<String>,
    bytes_base64: Option<String>,
    modified_at_ms: u64,
}

fn supported_file_type(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_string_lossy().to_ascii_lowercase();
    match ext.as_str() {
        "pdf" => Some("pdf"),
        "txt" => Some("txt"),
        _ => None,
    }
}

fn find_supported_path<T: IntoIterator<Item = String>>(args: T) -> Option<String> {
    args.into_iter().find_map(|raw| {
        let path = PathBuf::from(&raw);
        if path.is_file() && supported_file_type(&path).is_some() {
            path.to_str().map(|s| s.to_string())
        } else {
            None
        }
    })
}

fn decode_text(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8_lossy(&bytes[3..]).to_string();
    }

    if bytes.starts_with(&[0xFF, 0xFE]) {
        let body = &bytes[2..];
        let utf16: Vec<u16> = body
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect();
        return String::from_utf16_lossy(&utf16);
    }

    if bytes.starts_with(&[0xFE, 0xFF]) {
        let body = &bytes[2..];
        let utf16: Vec<u16> = body
            .chunks_exact(2)
            .map(|chunk| u16::from_be_bytes([chunk[0], chunk[1]]))
            .collect();
        return String::from_utf16_lossy(&utf16);
    }

    String::from_utf8_lossy(bytes).to_string()
}

#[tauri::command]
fn get_launch_document_path() -> Option<String> {
    find_supported_path(std::env::args().skip(1))
}

#[tauri::command]
fn load_document_from_path(path: String) -> Result<LoadedDocumentPayload, String> {
    let path_buf = PathBuf::from(&path);
    if !path_buf.is_file() {
        return Err("文件不存在或不可访问。".to_string());
    }

    let file_type = supported_file_type(&path_buf).ok_or_else(|| "仅支持 PDF/TXT 文件。".to_string())?;
    let bytes = std::fs::read(&path_buf).map_err(|e| format!("读取文件失败: {e}"))?;
    let metadata = std::fs::metadata(&path_buf).map_err(|e| format!("读取文件信息失败: {e}"))?;
    let modified_at_ms = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);

    let name = path_buf
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("document")
        .to_string();

    let payload = if file_type == "pdf" {
        LoadedDocumentPayload {
            path,
            name,
            file_type: file_type.to_string(),
            text_content: None,
            bytes_base64: Some(BASE64_STANDARD.encode(&bytes)),
            modified_at_ms,
        }
    } else {
        LoadedDocumentPayload {
            path,
            name,
            file_type: file_type.to_string(),
            text_content: Some(decode_text(&bytes)),
            bytes_base64: None,
            modified_at_ms,
        }
    };

    Ok(payload)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_http::init());

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv: Vec<String>, _cwd| {
            if let Some(path) = find_supported_path(argv.into_iter().skip(1)) {
                let _ = app.emit("open-associated-file", path);
            }
        }));

    builder
        .invoke_handler(tauri::generate_handler![
            get_launch_document_path,
            load_document_from_path
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
