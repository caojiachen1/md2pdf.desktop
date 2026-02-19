use comrak::Options as ComrakOptions;
use headless_chrome::{Browser, LaunchOptions};
use pulldown_cmark::{html, Options, Parser};
use serde::{Deserialize, Serialize};
use std::fs;
use std::time::Duration;
use tauri::{Emitter, Manager};
use thiserror::Error;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarkdownBlock {
    pub id: String,
    pub content: String,
    pub start_line: usize,
    pub end_line: usize,
    pub block_type: String,
}

#[derive(Serialize, Clone)]
struct ProgressPayload {
    message: String,
}

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

fn get_comrak_options() -> ComrakOptions<'static> {
    let mut options = ComrakOptions::default();
    options.extension.strikethrough = true;
    options.extension.table = true;
    options.extension.autolink = true;
    options.extension.tasklist = true;
    options.extension.footnotes = true;
    options.extension.math_dollars = true;
    options.extension.math_code = true;
    options.extension.front_matter_delimiter = Some("---".to_string());
    options.parse.smart = true;
    options.render.hardbreaks = false;
    options.render.github_pre_lang = true;
    options.render.width = 0;
    options
}

/// 将一段行范围按 $$...$$ 公式边界拆分，返回 (start_line, end_line) 对（均为 1-indexed）
fn split_lines_with_math(start_line: usize, end_line: usize, lines: &[&str]) -> Vec<(usize, usize)> {
    let mut result = Vec::new();
    let mut current = start_line;
    
    while current <= end_line {
        let line_content = lines.get(current - 1).copied().unwrap_or("").trim();
        
        if line_content.starts_with("$$") {
            // 判断是否是单行块级公式（首尾均有 $$，且不是单独的 $$）
            let is_single_line = line_content.len() > 2
                && line_content.ends_with("$$")
                && line_content != "$$";
            
            if is_single_line {
                result.push((current, current));
                current += 1;
                continue;
            }
            
            // 寻找结束 $$
            let mut j = current + 1;
            let mut found_end = false;
            while j <= end_line {
                if lines.get(j - 1).copied().unwrap_or("").trim().ends_with("$$") {
                    found_end = true;
                    break;
                }
                j += 1;
            }
            
            if found_end {
                result.push((current, j));
                current = j + 1;
                continue;
            }
        }
        
        // 普通行
        result.push((current, current));
        current += 1;
    }
    result
}

#[derive(Debug, Clone)]
struct AstNode {
    node_type: String,   // "heading", "paragraph", "code", "table", "html", "math", "yaml", "toml", "thematicBreak", "footnoteDefinition", "list", "listItem", "blockquote", "line"
    start_line: usize,   // 1-indexed
    end_line: usize,     // 1-indexed
}

#[tauri::command]
fn parse_markdown_blocks(markdown: &str) -> Vec<MarkdownBlock> {
    use comrak::{Arena as ComrakArena, nodes::NodeValue, parse_document};

    let content = markdown.replace("\r\n", "\n");
    let lines: Vec<&str> = content.lines().collect();
    let arena = ComrakArena::new();
    let options = get_comrak_options();
    let root = parse_document(&arena, &content, &options);

    // ---------- 第一步：用 comrak AST 收集原子节点 ----------
    fn get_node_type(nv: &NodeValue) -> &'static str {
        match nv {
            NodeValue::Heading(_) => "heading",
            NodeValue::Paragraph => "paragraph",
            NodeValue::CodeBlock(_) => "code",
            NodeValue::Table(_) => "table",
            NodeValue::Math(_) => "math",
            NodeValue::HtmlBlock(_) => "html",
            NodeValue::List(_) => "list",
            NodeValue::Item(_) => "listItem",
            NodeValue::BlockQuote => "blockquote",
            NodeValue::ThematicBreak => "thematicBreak",
            NodeValue::FootnoteDefinition(_) => "footnoteDefinition",
            NodeValue::FrontMatter(_) => "yaml",
            _ => "other",
        }
    }

    fn is_container(nv: &NodeValue) -> bool {
        matches!(nv,
            NodeValue::Document | NodeValue::List(_) | NodeValue::Item(_) | NodeValue::BlockQuote
        )
    }

    fn is_complex(nv: &NodeValue) -> bool {
        matches!(nv,
            NodeValue::Table(_)
                | NodeValue::CodeBlock(_)
                | NodeValue::Math(_)
                | NodeValue::HtmlBlock(_)
                | NodeValue::ThematicBreak
                | NodeValue::FootnoteDefinition(_)
                | NodeValue::FrontMatter(_)
        )
    }

    fn collect<'a>(
        node: &'a comrak::nodes::AstNode<'a>,
        lines: &[&str],
        out: &mut Vec<AstNode>,
    ) {
        let data = node.data.borrow();
        let nv = &data.value;
        if is_container(nv) {
            for child in node.children() {
                collect(child, lines, out);
            }
            return;
        }
        let sp = data.sourcepos;
        let start = sp.start.line;
        let end = sp.end.line;
        if start == 0 || end < start {
            return;
        }
        if is_complex(nv) {
            out.push(AstNode { node_type: get_node_type(nv).to_string(), start_line: start, end_line: end });
        } else {
            // paragraph / heading 等文本块，多行时逐行拆分（保持 math 完整性）
            let is_text_block = matches!(nv, NodeValue::Paragraph | NodeValue::Heading(_));
            if is_text_block && end > start {
                let sub = split_lines_with_math(start, end, lines);
                for (sl, el) in sub {
                    out.push(AstNode { node_type: "line".to_string(), start_line: sl, end_line: el });
                }
            } else {
                out.push(AstNode { node_type: get_node_type(nv).to_string(), start_line: start, end_line: end });
            }
        }
    }

    let mut atom_nodes: Vec<AstNode> = Vec::new();
    for child in root.children() {
        collect(child, &lines, &mut atom_nodes);
    }
    atom_nodes.sort_by(|a, b| {
        a.start_line.cmp(&b.start_line).then(a.end_line.cmp(&b.end_line))
    });

    // ---------- 第二步：拆分 HTML 块中的 <table> ----------
    let mut refined: Vec<AstNode> = Vec::new();
    for node in &atom_nodes {
        if node.node_type != "html" {
            refined.push(node.clone());
            continue;
        }
        let node_lines: Vec<&str> = lines
            .get(node.start_line - 1..node.end_line)
            .unwrap_or(&[])
            .to_vec();
        let full_content = node_lines.join("\n");
        if !full_content.contains("<table") && !full_content.contains("</table>") {
            refined.push(node.clone());
            continue;
        }
        let mut current_start = 0usize; // 相对于 node_lines
        for (k, line) in node_lines.iter().enumerate() {
            let ltrim = line.trim();
            // 表格开始
            let table_start_re = ltrim.starts_with("<table") && (ltrim.len() == 6 || ltrim.as_bytes().get(6).map_or(false, |&b| b == b'>' || b == b' '));
            if k > current_start && table_start_re {
                let split = split_lines_with_math(
                    node.start_line + current_start,
                    node.start_line + k - 1,
                    &lines,
                );
                for (sl, el) in split {
                    refined.push(AstNode { node_type: "line".to_string(), start_line: sl, end_line: el });
                }
                current_start = k;
            }
            if line.contains("</table>") && k < node_lines.len() - 1 {
                refined.push(AstNode {
                    node_type: "html".to_string(),
                    start_line: node.start_line + current_start,
                    end_line: node.start_line + k,
                });
                current_start = k + 1;
            }
        }
        let rem_start = node.start_line + current_start;
        let rem_end = node.end_line;
        if rem_start <= rem_end {
            let remaining = lines.get(current_start..node_lines.len()).unwrap_or(&[]).join("\n");
            if !remaining.contains("<table") && !remaining.contains("</table>") {
                for (sl, el) in split_lines_with_math(rem_start, rem_end, &lines) {
                    refined.push(AstNode { node_type: "line".to_string(), start_line: sl, end_line: el });
                }
            } else {
                refined.push(AstNode { node_type: "html".to_string(), start_line: rem_start, end_line: rem_end });
            }
        }
    }
    atom_nodes = refined;

    // ---------- 第三步：合并连续 HTML 表格节点 ----------
    let mut merged: Vec<AstNode> = Vec::new();
    let mut i = 0;
    while i < atom_nodes.len() {
        let node = &atom_nodes[i];
        if node.node_type == "html" {
            let node_content = lines
                .get(node.start_line - 1..node.end_line)
                .unwrap_or(&[])
                .join("\n");
            let ltrim = node_content.trim();
            let is_table_start = ltrim.starts_with("<table") && (ltrim.len() == 6 || ltrim.as_bytes().get(6).map_or(false, |&b| b == b'>' || b == b' '));
            if is_table_start {
                let mut last_line = node.end_line;
                let mut j = i + 1;
                let mut found_end = node_content.contains("</table>");
                while !found_end
                    && j < atom_nodes.len()
                    && atom_nodes[j].node_type == "html"
                    && atom_nodes[j].start_line <= last_line + 2
                {
                    let nc = lines
                        .get(atom_nodes[j].start_line - 1..atom_nodes[j].end_line)
                        .unwrap_or(&[])
                        .join("\n");
                    last_line = atom_nodes[j].end_line;
                    if nc.contains("</table>") {
                        found_end = true;
                    }
                    j += 1;
                }
                if found_end && j > i + 1 {
                    merged.push(AstNode { node_type: "html".to_string(), start_line: node.start_line, end_line: last_line });
                    i = j;
                    continue;
                }
            }
        }
        merged.push(atom_nodes[i].clone());
        i += 1;
    }
    atom_nodes = merged;

    // ---------- 第四步：生成最终 MarkdownBlock 列表（填充 gap 行）----------
    let mut blocks: Vec<MarkdownBlock> = Vec::new();
    let mut last_line_processed = 0usize;

    for (idx, node) in atom_nodes.iter().enumerate() {
        let start_line = node.start_line; // 1-indexed
        let end_line = node.end_line;     // 1-indexed

        // 填充 gap 行
        if start_line - 1 > last_line_processed {
            let gap_nodes = split_lines_with_math(last_line_processed + 1, start_line - 1, &lines);
            for (gidx, (gsl, gel)) in gap_nodes.iter().enumerate() {
                let gap_content = lines.get(gsl - 1..*gel).unwrap_or(&[]).join("\n");
                if !gap_content.trim().is_empty() {
                    blocks.push(MarkdownBlock {
                        id: format!("gap-{}-{}", gsl, gidx),
                        content: gap_content,
                        start_line: *gsl,
                        end_line: *gel,
                        block_type: "line".to_string(),
                    });
                }
            }
            last_line_processed = start_line - 1;
        }

        // 添加节点本身（防止行重叠）
        let actual_start = start_line.max(last_line_processed + 1);
        if end_line >= actual_start {
            let block_content = lines.get(actual_start - 1..end_line).unwrap_or(&[]).join("\n");
            if !block_content.trim().is_empty() {
                blocks.push(MarkdownBlock {
                    id: format!("block-{}-{}", idx, actual_start),
                    content: block_content,
                    start_line: actual_start,
                    end_line,
                    block_type: node.node_type.clone(),
                });
            }
            last_line_processed = end_line;
        }
    }

    // 处理文件末尾剩余行
    if last_line_processed < lines.len() {
        let tail_nodes = split_lines_with_math(last_line_processed + 1, lines.len(), &lines);
        for (gidx, (gsl, gel)) in tail_nodes.iter().enumerate() {
            let gap_content = lines.get(gsl - 1..*gel).unwrap_or(&[]).join("\n");
            if !gap_content.trim().is_empty() {
                blocks.push(MarkdownBlock {
                    id: format!("gap-end-{}-{}", gsl, gidx),
                    content: gap_content,
                    start_line: *gsl,
                    end_line: *gel,
                    block_type: "line".to_string(),
                });
            }
        }
    }

    // ---------- 第五步：修复未闭合的 $$ 块（强制合并直到 $$ 配对完整）----------
    // 遍历所有 block，统计每块内独立 $$ 行的数量（奇偶性），
    // 奇数说明公式未闭合，持续吸收后续块直到 $$ 配对为偶数。
    fn count_bare_dollars(content: &str) -> usize {
        content.lines()
            .filter(|l| l.trim() == "$$")
            .count()
    }

    let mut fixed: Vec<MarkdownBlock> = Vec::with_capacity(blocks.len());
    let mut k = 0;
    while k < blocks.len() {
        let mut cur = blocks[k].clone();
        let mut dollar_count = count_bare_dollars(&cur.content);
        // 奇数：公式未闭合，继续吸收后续块
        while dollar_count % 2 != 0 && k + 1 < blocks.len() {
            k += 1;
            let next = &blocks[k];
            cur.content = format!("{}\n{}", cur.content, next.content);
            cur.end_line = next.end_line;
            cur.block_type = "math".to_string();
            dollar_count = count_bare_dollars(&cur.content);
        }
        fixed.push(cur);
        k += 1;
    }
    let blocks = fixed;

    blocks
}

/// 格式化 Markdown 文本：
/// 步骤：
///  1. 统一换行符
///  2. 将单行 $$公式$$ 展开为独立的块级公式（多行格式）
///  3. 确保 $$ 行前后各有一个空行
///  4. 压缩连续空行（>=3 个换行→2 个）
///  5. trim
#[tauri::command]
fn format_markdown(markdown: &str) -> String {
    use regex::Regex;

    let mut content = markdown.replace("\r\n", "\n");

    // 步骤 2：将单行 $$公式$$ 展开为多行块级公式
    let re_inline_block = Regex::new(r"\$\$([^\$\n]+?)\$\$").unwrap();
    content = re_inline_block.replace_all(&content, "\n\n$$\n$1\n$$\n\n").to_string();

    // 步骤 3：确保 $$ 行前后各有一个空行
    let mut lines: Vec<String> = content.lines().map(|l| l.to_string()).collect();
    let mut in_formula = false;
    let mut i = 0;
    while i < lines.len() {
        if lines[i].trim() == "$$" {
            if !in_formula {
                // 公式开始：确保前面有空行
                if i > 0 && !lines[i - 1].trim().is_empty() {
                    lines.insert(i, String::new());
                    i += 1; // 跳过刚插入的空行，仍处理当前 $$
                }
                in_formula = true;
            } else {
                // 公式结束：确保后面有空行
                if i + 1 < lines.len() && !lines[i + 1].trim().is_empty() {
                    lines.insert(i + 1, String::new());
                }
                in_formula = false;
            }
        }
        i += 1;
    }
    content = lines.join("\n");

    // 步骤 4：压缩连续空行（3 个及以上换行→2 个）
    let re_multi = Regex::new(r"\n{3,}").unwrap();
    content = re_multi.replace_all(&content, "\n\n").to_string();

    // 步骤 5：trim
    content.trim().to_string()
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
fn generate_full_html(html_content: &str, title: &str, katex_css_path: &str) -> String {
    format!(
        r#"<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{title}</title>
    <link rel="stylesheet" href="{katex_css_path}">
    <style>
        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}

        body {{
            font-family: 'SimSun', '宋体', 'Segoe UI', system-ui, -apple-system, sans-serif;
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
    <script>
        // 当页面完全加载并渲染完成后，添加一个带有 ID 的哨兵元素
        // 这样后端 headless_chrome 就可以精准等待，而不用固定的 sleep
        window.addEventListener('load', () => {{
            // 使用 double requestAnimationFrame 确保至少进行了一次完整的布局和绘制
            requestAnimationFrame(() => {{
                requestAnimationFrame(() => {{
                    const sentinel = document.createElement('div');
                    sentinel.id = 'render-complete';
                    sentinel.style.display = 'none';
                    document.body.appendChild(sentinel);
                }});
            }});
        }});
    </script>
</head>
<body>
    <div class="markdown-preview">
        {html_content}
    </div>
</body>
</html>"#,
        katex_css_path = katex_css_path,
        title = title,
        html_content = html_content
    )
}

/// 导出为 PDF
#[tauri::command]
async fn export_to_pdf(window: tauri::Window, html_content: String, output_path: String, title: String) -> Result<(), AppError> {
    // 在后台线程中执行，避免阻塞
    tokio::task::spawn_blocking(move || {
        let emit_progress = |message: &str| {
            let _ = window.emit("export-progress", ProgressPayload { message: message.to_string() });
        };

        // 获取 KaTeX CSS 路径 (本地或 CDN 回退)
        let app_handle = window.app_handle();
        let katex_css_res = app_handle.path().resource_dir()
            .map(|p| p.join("public/katex/katex.min.css"));
            
        let katex_css_url = match katex_css_res {
            Ok(p) if p.exists() => {
                let path_str = p.to_string_lossy().replace("\\", "/");
                if path_str.starts_with('/') {
                    format!("file://{}", path_str)
                } else {
                    format!("file:///{}", path_str)
                }
            },
            _ => "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css".to_string(),
        };

        // 生成完整的 HTML 页面
        let full_html = generate_full_html(&html_content, &title, &katex_css_url);

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

        emit_progress("[1/5] 正在启动浏览器 (Headless Chrome)...");

        // 配置浏览器启动选项
        let launch_options = LaunchOptions::default_builder()
            .headless(true)
            .sandbox(false)
            .idle_browser_timeout(std::time::Duration::from_secs(3600 * 24 * 365 * 100))
            .args(vec![
                std::ffi::OsStr::new("--no-sandbox"),
                std::ffi::OsStr::new("--disable-setuid-sandbox"),
                std::ffi::OsStr::new("--disable-dev-shm-usage"),
                std::ffi::OsStr::new("--disable-extensions"),
                std::ffi::OsStr::new("--disable-gpu"),
                std::ffi::OsStr::new("--disable-background-timer-throttling"),
                std::ffi::OsStr::new("--disable-renderer-backgrounding"),
                std::ffi::OsStr::new("--disable-backgrounding-occluded-windows"),
                std::ffi::OsStr::new("--disable-hang-monitor"),
            ])
            .build()
            .map_err(|e| AppError::BrowserError(e.to_string()))?;

        // 启动浏览器
        let browser = Browser::new(launch_options)
            .map_err(|e| AppError::BrowserError(e.to_string()))?;

        emit_progress("[2/5] 正在创建新标签页...");

        // 创建新标签页
        let tab = browser
            .new_tab()
            .map_err(|e| AppError::BrowserError(e.to_string()))?;

        emit_progress(&format!("[3/5] 正在加载页面..."));

        // 导航到 HTML 页面
        // 触发导航
        tab.navigate_to(&data_url)
            .map_err(|e| AppError::BrowserError(format!("导航触发失败: {}", e)))?;

        // 移除严格的超时限制，允许等待极长时间（1小时），确保大文件有足够时间渲染
        let nav_timeout = Duration::from_secs(3600);
        
        tab.set_default_timeout(nav_timeout);
        tab.wait_until_navigated()
            .map_err(|e| AppError::BrowserError(format!("等待导航完成失败: {}", e)))?;
        
        emit_progress("[4/5] 正在等待数学公式动态渲染完成...");

        // 等待页面完全渲染完成（前端脚本会添加 #render-complete 元素作为信号）
        tab.wait_for_element_with_custom_timeout("#render-complete", nav_timeout)
            .map_err(|e| AppError::BrowserError(format!("等待渲染完成信号超时: {}", e)))?;

        emit_progress("[5/5] 正在生成 PDF...");

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
                    // 如果依然失败，进行重试并给一点基础时间
                    let extra_wait = Duration::from_secs((attempt as u64) * 2 + 3);
                    std::thread::sleep(extra_wait);
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

        // Clean up temp HTML
        let _ = fs::remove_file(&html_path);

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
            export_to_pdf,
            parse_markdown_blocks,
            format_markdown
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
