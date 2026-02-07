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
    use regex::Regex;

    // 1. 统一换行符并清理每行末尾的空白
    let mut content = markdown.replace("\r\n", "\n");
    
    // 2. 预处理：确保块级元素之间有空行
    // 匹配常见的块级元素起始位置，如果前面紧跟非空行，则插入空行
    // 包含：标题 (#), 列表 (-, *, + 或 数字.), 代码块 (```), 引用 (>), 分割线 (---)
    let block_patterns = [
        (Regex::new(r"(?m)^([^\n]+)\n(#+ )").unwrap(), "$1\n\n$2"),       // 标题前
        (Regex::new(r"(?m)^([^\n]+)\n( {0,3}[-*+]\s+)").unwrap(), "$1\n\n$2"), // 无序列表前
        (Regex::new(r"(?m)^([^\n]+)\n( {0,3}\d+\.\s+)").unwrap(), "$1\n\n$2"), // 有序列表前
        (Regex::new(r"(?m)^([^\n]+)\n( {0,3}```)").unwrap(), "$1\n\n$2"),     // 代码块前
        (Regex::new(r"(?m)^([^\n]+)\n( {0,3}>)").unwrap(), "$1\n\n$2"),       // 引用前
    ];

    for (re, replacement) in block_patterns.iter() {
        content = re.replace_all(&content, *replacement).to_string();
    }

    // 3. 压缩多余空行：将 3 个及以上连续换行替换为 2 个，确保块间最多只有一个空行
    let re_multi_lines = Regex::new(r"\n{3,}").unwrap();
    content = re_multi_lines.replace_all(&content, "\n\n").to_string();

    // 4. 去掉纯空白行构成的“空块”
    let re_empty_block = Regex::new(r"(?m)^\s+$\n").unwrap();
    content = re_empty_block.replace_all(&content, "").to_string();

    let mut options = Options::empty();
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_FOOTNOTES);
    options.insert(Options::ENABLE_TASKLISTS);

    let parser = Parser::new_ext(&content, options);
    let mut html_output = String::new();
    html::push_html(&mut html_output, parser);
    
    // 5. 清理生成的 HTML 中可能存在的空标签
    html_output = html_output
        .replace("<p></p>", "")
        .replace("<p>\n</p>", "");
        
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

        // 确定输出路径
        let output_path_buf = std::path::Path::new(&output_path);
        let html_path = output_path_buf.with_extension("html");

        // 立即保存 HTML 文件到 PDF 同级目录
        fs::write(&html_path, &full_html).map_err(|e| AppError::FileReadError(e))?;
        
        let path_str = html_path.to_string_lossy().replace("\\", "/");
        let data_url = if path_str.starts_with('/') {
            format!("file://{}", path_str)
        } else {
            format!("file:///{}", path_str)
        };

        // 配置浏览器启动选项
        let launch_options = LaunchOptions::default_builder()
            .headless(true)
            .sandbox(false)
            // 添加稳定性参数，防止大文件渲染时崩溃
            .args(vec![
                std::ffi::OsStr::new("--disable-gpu"),
                std::ffi::OsStr::new("--disable-dev-shm-usage"),
                std::ffi::OsStr::new("--no-sandbox"),
                std::ffi::OsStr::new("--disable-setuid-sandbox"),
            ])
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

        // 移除严格的超时限制，允许等待极长时间（1小时），确保大文件有足够时间渲染
        let nav_timeout = Duration::from_secs(3600);
        
        // 根据内容长度动态调整渲染等待时间
        let content_len = full_html.len();
        let (render_wait, retry_wait) = if content_len <= 200_000 {
            (Duration::from_secs(2), Duration::from_secs(3))
        } else if content_len <= 800_000 {
            (Duration::from_secs(6), Duration::from_secs(6))
        } else if content_len <= 2_000_000 {
            (Duration::from_secs(12), Duration::from_secs(10))
        } else {
            // 对于超大文件，给予更多的基础排版时间
            (Duration::from_secs(30), Duration::from_secs(20))
        };

        tab.set_default_timeout(nav_timeout);
        tab.wait_until_navigated()
            .map_err(|e| AppError::BrowserError(format!("等待导航完成失败: {}", e)))?;
        tab.wait_for_element_with_custom_timeout("body", nav_timeout)
            .map_err(|e| AppError::BrowserError(format!("等待页面渲染失败: {}", e)))?;

        // 给浏览器最后的排版时间，避免大文档尚未完全布局
        std::thread::sleep(render_wait);

        // 生成 PDF
        let make_pdf_options = || headless_chrome::types::PrintToPdfOptions {
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

        let mut last_err: Option<anyhow::Error> = None;
        let mut pdf_data: Option<Vec<u8>> = None;

        for attempt in 0..3 {
            match tab.print_to_pdf(Some(make_pdf_options())) {
                Ok(data) => {
                    pdf_data = Some(data);
                    break;
                }
                Err(e) => {
                    last_err = Some(e);
                    let extra_wait = Duration::from_secs((attempt as u64) * 2);
                    std::thread::sleep(retry_wait + extra_wait);
                }
            }
        }

        let pdf_data = pdf_data.ok_or_else(|| {
            AppError::PdfError(format!(
                "PDF 生成失败 (已保存 HTML 备份至 {:?}): {}",
                html_path.file_name().unwrap_or_default(),
                last_err
                    .map(|e| e.to_string())
                    .unwrap_or_else(|| "未知错误".to_string())
            ))
        })?;

        // 写入文件
        fs::write(output_path_buf, pdf_data).map_err(|e| AppError::FileReadError(e))?;

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
