use headless_chrome::{Browser, LaunchOptions};
use pulldown_cmark::{html, Options, Parser};
use std::fs;
use std::time::Duration;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("文件读取错误: {0}")]
    FileReadError(#[from] std::io::Error),
    #[error("浏览器启动错误: {0}")]
    BrowserError(String),
    #[error("PDF 生成错误: {0}")]
    PdfError(String),
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

/// 读取 Markdown 文件内容
#[tauri::command]
fn read_markdown_file(path: &str) -> Result<String, AppError> {
    let content = fs::read_to_string(path)?;
    Ok(content)
}

/// 将 Markdown 转换为 HTML（用于预览）
#[tauri::command]
fn markdown_to_html(markdown: &str) -> String {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_FOOTNOTES);
    options.insert(Options::ENABLE_TASKLISTS);

    let parser = Parser::new_ext(markdown, options);
    let mut html_output = String::new();
    html::push_html(&mut html_output, parser);
    html_output
}

/// 生成完整的 HTML 页面（用于 PDF 导出）
fn generate_full_html(html_content: &str, title: &str) -> String {
    format!(
        r#"<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{title}</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
    <style>
        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}

        body {{
            font-family: 'Segoe UI', 'Microsoft YaHei', system-ui, -apple-system, sans-serif;
            line-height: 1.7;
            color: #1a1a1a;
            max-width: 800px;
            margin: 0 auto;
            padding: 40px 60px;
            background-color: #ffffff;
        }}

        h1, h2, h3, h4, h5, h6 {{
            margin-top: 1.5em;
            margin-bottom: 0.5em;
            font-weight: 600;
            line-height: 1.3;
        }}

        h1 {{
            font-size: 2em;
            border-bottom: 2px solid #e5e5e5;
            padding-bottom: 0.3em;
        }}

        h2 {{
            font-size: 1.5em;
            border-bottom: 1px solid #e5e5e5;
            padding-bottom: 0.3em;
        }}

        h3 {{
            font-size: 1.25em;
        }}

        p {{
            margin: 1em 0;
        }}

        code {{
            background-color: #f5f5f5;
            padding: 0.2em 0.4em;
            border-radius: 4px;
            font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
            font-size: 0.9em;
        }}

        pre {{
            background-color: #f5f5f5;
            padding: 1em;
            border-radius: 8px;
            overflow-x: auto;
            margin: 1em 0;
        }}

        pre code {{
            background: none;
            padding: 0;
        }}

        blockquote {{
            border-left: 4px solid #0078d4;
            padding-left: 1em;
            margin: 1em 0;
            color: #666;
        }}

        ul, ol {{
            margin: 1em 0;
            padding-left: 2em;
        }}

        li {{
            margin: 0.5em 0;
        }}

        table {{
            border-collapse: collapse;
            width: 100%;
            margin: 1em 0;
        }}

        th, td {{
            border: 1px solid #ddd;
            padding: 0.5em 1em;
            text-align: left;
        }}

        th {{
            background-color: #f5f5f5;
            font-weight: 600;
        }}

        img {{
            max-width: 100%;
            height: auto;
        }}

        a {{
            color: #0078d4;
            text-decoration: none;
        }}

        hr {{
            border: none;
            border-top: 1px solid #e5e5e5;
            margin: 2em 0;
        }}

        .katex-display {{
            margin: 1em 0;
            overflow-x: auto;
            overflow-y: hidden;
        }}

        .katex {{
            font-size: 1.1em;
        }}

        @media print {{
            body {{
                padding: 20px;
            }}

            pre, blockquote {{
                page-break-inside: avoid;
            }}

            h1, h2, h3 {{
                page-break-after: avoid;
            }}
        }}
    </style>
</head>
<body>
    <div class="markdown-preview">
        {html_content}
    </div>
</body>
</html>"#,
        title = title,
        html_content = html_content
    )
}

/// 导出为 PDF
#[tauri::command]
async fn export_to_pdf(html_content: String, output_path: String, title: String) -> Result<(), AppError> {
    // 在后台线程中执行，避免阻塞
    tokio::task::spawn_blocking(move || {
        // 生成完整的 HTML 页面
        let full_html = generate_full_html(&html_content, &title);

        // 写入临时文件
        let temp_path = std::env::temp_dir().join(format!("md2pdf_temp_{}.html", std::process::id()));
        fs::write(&temp_path, &full_html).map_err(|e| AppError::FileReadError(e))?;
        
        let path_str = temp_path.to_string_lossy().replace("\\", "/");
        let data_url = if path_str.starts_with('/') {
            format!("file://{}", path_str)
        } else {
            format!("file:///{}", path_str)
        };

        // 配置浏览器启动选项
        let launch_options = LaunchOptions::default_builder()
            .headless(true)
            .sandbox(false)
            // 移除超时限制
            .build()
            .map_err(|e| AppError::BrowserError(e.to_string()))?;

        // 启动浏览器
        let browser = Browser::new(launch_options)
            .map_err(|e| AppError::BrowserError(e.to_string()))?;

        // 创建新标签页
        let tab = browser
            .new_tab()
            .map_err(|e| AppError::BrowserError(e.to_string()))?;

        // 导航到 HTML 页面
        // 触发导航
        tab.navigate_to(&data_url)
            .map_err(|e| AppError::BrowserError(format!("导航触发失败: {}", e)))?;

        // 彻底去掉库的事件等待，改用固定睡眠
        // 对于大文件，我们给足 5-10 秒的渲染时间，这在后台执行是可以接受的
        std::thread::sleep(Duration::from_secs(5));

        // 生成 PDF
        let pdf_options = headless_chrome::types::PrintToPdfOptions {
            landscape: Some(false),
            display_header_footer: Some(false),
            print_background: Some(true),
            scale: Some(1.0),
            paper_width: Some(8.27),
            paper_height: Some(11.69),
            margin_top: Some(0.4),
            margin_bottom: Some(0.4),
            margin_left: Some(0.4),
            margin_right: Some(0.4),
            prefer_css_page_size: Some(true),
            ..Default::default()
        };

        let pdf_data = tab
            .print_to_pdf(Some(pdf_options))
            .map_err(|e| AppError::PdfError(format!("PDF 生成失败 (可能是文档过大渲染未完成): {}", e)))?;

        // 写入文件
        let output_path_buf = std::path::Path::new(&output_path);
        fs::write(output_path_buf, pdf_data).map_err(|e| AppError::FileReadError(e))?;

        // 清理临时文件
        let _ = fs::remove_file(temp_path);

        Ok(())
    }).await.map_err(|e| AppError::PdfError(e.to_string()))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            read_markdown_file,
            markdown_to_html,
            export_to_pdf
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
