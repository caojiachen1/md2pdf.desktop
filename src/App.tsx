import { useState, useEffect, useCallback, useRef } from 'react';
import {
  FluentProvider,
  webLightTheme,
  webDarkTheme,
  Button,
  Card,
  Title3,
  Body1,
  Spinner,
  Toast,
  ToastTitle,
  ToastBody,
  Toaster,
  useToastController,
  useId,
  tokens,
  makeStyles,
  shorthands,
} from '@fluentui/react-components';
import {
  ArrowUploadRegular,
  DocumentPdfRegular,
  DocumentRegular,
  CheckmarkCircleRegular,
  DismissCircleRegular,
  DeleteRegular,
  MergeRegular,
  SaveRegular,
  SaveCopyRegular,
  ArrowUndoRegular,
} from '@fluentui/react-icons';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import { Virtuoso } from 'react-virtuoso';

// 自定义插件：为每个节点注入原始行号
const injectLineNumbers = (node: any) => {
  if (node.position) {
    node.data = node.data || {};
    node.data.hProperties = node.data.hProperties || {};
    node.data.hProperties['data-line'] = node.position.start.line;
  }
  if (node.children) {
    node.children.forEach(injectLineNumbers);
  }
};

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    backgroundColor: tokens.colorNeutralBackground1,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...shorthands.padding('16px', '24px'),
    ...shorthands.borderBottom('1px', 'solid', tokens.colorNeutralStroke2),
    backgroundColor: tokens.colorNeutralBackground2,
    '-webkit-app-region': 'drag',
  },
  headerTitle: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap('12px'),
  },
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap('12px'),
    '-webkit-app-region': 'no-drag',
  },
  content: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    ...shorthands.padding('24px'),
    ...shorthands.gap('20px'),
    overflowY: 'hidden',
  },
  splitPane: {
    display: 'flex',
    flexDirection: 'row',
    flexGrow: 1,
    ...shorthands.gap('16px'),
    minHeight: 0,
  },
  pane: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    ...shorthands.borderRadius('8px'),
    backgroundColor: tokens.colorNeutralBackground1,
    overflow: 'hidden',
  },
  paneHeader: {
    ...shorthands.padding('8px', '16px'),
    ...shorthands.borderBottom('1px', 'solid', tokens.colorNeutralStroke2),
    backgroundColor: tokens.colorNeutralBackground2,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  scrollArea: {
    flexGrow: 1,
    overflowY: 'auto',
    position: 'relative',
    scrollBehavior: 'auto',
  },
  editorRow: {
    fontFamily: 'Consolas, "Courier New", monospace',
    fontSize: '14px',
    lineHeight: '1.6',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    ...shorthands.padding('4px', '16px'),
    color: tokens.colorNeutralForeground1,
    width: '100%',
    borderTop: 'none',
    borderLeft: 'none',
    borderRight: 'none',
    borderBottom: `2px dashed ${tokens.colorNeutralStroke3}`,
    outline: 'none',
    resize: 'none',
    backgroundColor: 'transparent',
    display: 'block',
    boxSizing: 'border-box',
    fieldSizing: 'content' as any,
    minHeight: '1.6em',
    marginBottom: '8px',
  },
  previewRow: {
    ...shorthands.padding('4px', '24px'),
    position: 'relative',
    ...shorthands.borderBottom('1px', 'solid', tokens.colorNeutralStroke3),
    minHeight: '2em',
  },
  blockDivider: {
    height: '1px',
    backgroundColor: tokens.colorNeutralStroke3,
    width: '100%',
    marginTop: '4px',
  },
  statusBar: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap('8px'),
    ...shorthands.padding('8px', '16px'),
    backgroundColor: tokens.colorNeutralBackground3,
    ...shorthands.borderRadius('8px'),
  },
  statusIcon: {
    color: tokens.colorBrandForeground1,
  },
  previewCard: {
    flexGrow: 1,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
  },
  previewContainer: {
    flexGrow: 1,
    overflowY: 'auto',
    ...shorthands.padding('24px'),
    backgroundColor: tokens.colorNeutralBackground1,
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    color: tokens.colorNeutralForeground3,
    ...shorthands.gap('16px'),
  },
  emptyIcon: {
    width: '64px',
    height: '64px',
    color: tokens.colorNeutralForeground4,
  },
  loadingOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    zIndex: 1000,
    backdropFilter: 'blur(4px)',
  },
  loadingCard: {
    ...shorthands.padding('32px', '48px'),
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    ...shorthands.gap('16px'),
  },
  blockContainer: {
    position: 'relative',
    '&:hover .block-toolbar': {
      opacity: 1,
    },
  },
  blockToolbar: {
    position: 'absolute',
    top: '4px',
    right: '8px',
    display: 'flex',
    ...shorthands.gap('4px'),
    opacity: 0,
    transitionProperty: 'opacity',
    transitionDuration: '0.2s',
    zIndex: 10,
    backgroundColor: tokens.colorNeutralBackground1,
    ...shorthands.padding('2px'),
    ...shorthands.borderRadius('4px'),
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke1),
  },
});

interface MarkdownBlock {
  id: string;
  content: string;
  startLine: number;
  endLine: number;
}

function App() {
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [markdownContent, setMarkdownContent] = useState('');
  const [markdownBlocks, setMarkdownBlocks] = useState<MarkdownBlock[]>([]);
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const styles = useStyles();
  const toasterId = useId('toaster');
  const { dispatchToast } = useToastController(toasterId);

  // 解析 Markdown 内容为分块
  const parseMarkdownToBlocks = useCallback((content: string): MarkdownBlock[] => {
    if (!content) return [];
    
    // 使用与预览相同的插件，确保解析结构一致
    const processor = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkMath);
    const ast = processor.parse(content);
    const lines = content.split(/\r?\n/);
    const blocks: MarkdownBlock[] = [];
    
    // 递归获取所有需要作为独立分块的原子节点
    const getAtomNodes = (nodes: any[]): any[] => {
      let atoms: any[] = [];
      if (!nodes) return atoms;

      nodes.forEach(node => {
        // 容器类型：继续递归以获取更细的分块
        const containerTypes = ['root', 'list', 'listItem', 'blockquote'];
        // 不可拆分的复杂块：这些必须作为一个整体，否则会破坏 Markdown 语法
        const complexTypes = ['table', 'code', 'html', 'math', 'yaml', 'toml', 'footnoteDefinition', 'thematicBreak'];
        
        if (containerTypes.includes(node.type) && node.children) {
          atoms = atoms.concat(getAtomNodes(node.children));
        } else if (complexTypes.includes(node.type)) {
          atoms.push(node);
        } else {
          // 对于 paragraph, heading 等“文本类块”，我们将其进一步拆分为“行”
          // 这样可以解决 1.1, 1.2 在同一段落的问题，也能处理大段文字
          if (node.position) {
            const startLine = node.position.start.line;
            const endLine = node.position.end.line;
            
            if (startLine < endLine && (node.type === 'paragraph' || node.type === 'heading')) {
              for (let l = startLine; l <= endLine; l++) {
                atoms.push({
                  type: 'line',
                  position: {
                    start: { line: l, column: 1 },
                    end: { line: l, column: 1 }
                  }
                });
              }
            } else {
              atoms.push(node);
            }
          } else {
            atoms.push(node);
          }
        }
      });
      return atoms;
    };

    const children = (ast as any).children;
    const atomNodes = getAtomNodes(children)
      .filter(node => node.position)
      .sort((a, b) => {
        if (a.position.start.line !== b.position.start.line) {
          return a.position.start.line - b.position.start.line;
        }
        return a.position.end.line - b.position.end.line;
      });

    let lastLineProcessed = 0; // 0-indexed

    atomNodes.forEach((node: any, idx: number) => {
      const startLine = node.position.start.line; // 1-indexed
      const endLine = node.position.end.line;     // 1-indexed

      // 填充节点之前的空白行或未识别行，每一行作为一个独立分块
      if (startLine - 1 > lastLineProcessed) {
        for (let i = lastLineProcessed; i < startLine - 1; i++) {
          blocks.push({
            id: `gap-${i + 1}`,
            content: lines[i],
            startLine: i + 1,
            endLine: i + 1
          });
        }
        lastLineProcessed = startLine - 1;
      }

      // 添加节点本身
      // 确保不与已处理的行重叠（处理某些 AST 节点可能存在的行重叠）
      const actualStartLine = Math.max(startLine, lastLineProcessed + 1);
      if (endLine >= actualStartLine) {
        const blockContent = lines.slice(actualStartLine - 1, endLine).join('\n');
        blocks.push({
          id: `block-${idx}-${actualStartLine}`,
          content: blockContent,
          startLine: actualStartLine,
          endLine
        });
        lastLineProcessed = endLine;
      }
    });

    // 处理文件末尾的剩余行
    if (lastLineProcessed < lines.length) {
      for (let i = lastLineProcessed; i < lines.length; i++) {
        blocks.push({
          id: `gap-end-${i + 1}`,
          content: lines[i],
          startLine: i + 1,
          endLine: i + 1
        });
      }
    }

    return blocks;
  }, []);
  
  // 虚拟列表引用
  const leftVirtuosoRef = useRef<any>(null);
  const rightVirtuosoRef = useRef<any>(null);
  const leftScrollerRef = useRef<HTMLElement | null>(null);
  const rightScrollerRef = useRef<HTMLElement | null>(null);

  // 滚动同步状态
  const activePane = useRef<'left' | 'right' | null>(null);
  const isProgrammatic = useRef(false);
  const calibrationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastLeftTopIndex = useRef(0);
  const lastRightTopIndex = useRef(0);

  // 处理块内容修改
  const handleBlockChange = useCallback((index: number, newContent: string) => {
    setMarkdownBlocks(prev => {
      const next = [...prev];
      if (next[index].content === newContent) return prev;
      next[index] = { ...next[index], content: newContent };
      setIsDirty(true);
      return next;
    });
  }, []);

  // 删除区块
  const handleDeleteBlock = useCallback((index: number) => {
    setMarkdownBlocks(prev => {
      if (prev.length <= 1) return prev; // 至少保留一个区块
      const next = [...prev];
      next.splice(index, 1);
      setIsDirty(true);
      return next;
    });
  }, []);

  // 合并区块（与下一个区块合并）
  const handleMergeNext = useCallback((index: number) => {
    setMarkdownBlocks(prev => {
      if (index >= prev.length - 1) return prev;
      const next = [...prev];
      const mergedContent = next[index].content + '\n' + next[index + 1].content;
      next[index] = { ...next[index], content: mergedContent };
      next.splice(index + 1, 1);
      setIsDirty(true);
      return next;
    });
  }, []);

  // 当 blocks 变化时同步更新全量内容（用于导出和字符统计）
  useEffect(() => {
    if (markdownBlocks.length > 0) {
      const newContent = markdownBlocks.map(b => b.content).join('\n');
      if (newContent !== markdownContent) {
        setMarkdownContent(newContent);
      }
    }
  }, [markdownBlocks, markdownContent]);

  // rangeChanged 回调：当最上方可见块变化时，立即同步另一侧
  const handleLeftRangeChanged = useCallback((range: { startIndex: number; endIndex: number }) => {
    const newTopIndex = range.startIndex;
    // 只有当索引真正变化时才同步
    if (newTopIndex === lastLeftTopIndex.current) return;
    lastLeftTopIndex.current = newTopIndex;

    // 只有当左侧是活跃面板时才同步右侧
    if (activePane.current !== 'left' || isProgrammatic.current) return;

    // 防抖：50ms 内只执行一次同步
    if (calibrationTimer.current) clearTimeout(calibrationTimer.current);
    calibrationTimer.current = setTimeout(() => {
      isProgrammatic.current = true;
      rightVirtuosoRef.current?.scrollToIndex({
        index: newTopIndex,
        align: 'start',
        behavior: 'auto',
      });
      setTimeout(() => { isProgrammatic.current = false; }, 100);
    }, 50);
  }, []);

  const handleRightRangeChanged = useCallback((range: { startIndex: number; endIndex: number }) => {
    const newTopIndex = range.startIndex;
    if (newTopIndex === lastRightTopIndex.current) return;
    lastRightTopIndex.current = newTopIndex;

    if (activePane.current !== 'right' || isProgrammatic.current) return;

    if (calibrationTimer.current) clearTimeout(calibrationTimer.current);
    calibrationTimer.current = setTimeout(() => {
      isProgrammatic.current = true;
      leftVirtuosoRef.current?.scrollToIndex({
        index: newTopIndex,
        align: 'start',
        behavior: 'auto',
      });
      setTimeout(() => { isProgrammatic.current = false; }, 100);
    }, 50);
  }, []);

  // scrollerRef 回调：获取元素 + 追踪活跃面板
  const leftScrollerCallback = useCallback((el: HTMLElement | Window | null) => {
    if (el instanceof HTMLElement) {
      if (leftScrollerRef.current && leftScrollerRef.current !== el) {
        const old = leftScrollerRef.current;
        old.onpointerenter = null;
      }
      leftScrollerRef.current = el;
      el.onpointerenter = () => { activePane.current = 'left'; };
    }
  }, []);

  const rightScrollerCallback = useCallback((el: HTMLElement | Window | null) => {
    if (el instanceof HTMLElement) {
      if (rightScrollerRef.current && rightScrollerRef.current !== el) {
        const old = rightScrollerRef.current;
        old.onpointerenter = null;
      }
      rightScrollerRef.current = el;
      el.onpointerenter = () => { activePane.current = 'right'; };
    }
  }, []);

  // 检测系统主题
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    setIsDarkMode(mediaQuery.matches);

    const handleChange = (e: MediaQueryListEvent) => {
      setIsDarkMode(e.matches);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  // 显示成功提示
  const showSuccessToast = useCallback((message: string) => {
    dispatchToast(
      <Toast>
        <ToastTitle media={<CheckmarkCircleRegular style={{ color: tokens.colorPaletteGreenForeground1 }} />}>
          成功
        </ToastTitle>
        <ToastBody>{message}</ToastBody>
      </Toast>,
      { intent: 'success' }
    );
  }, [dispatchToast]);

  // 显示错误提示
  const showErrorToast = useCallback((message: string) => {
    dispatchToast(
      <Toast>
        <ToastTitle media={<DismissCircleRegular style={{ color: tokens.colorPaletteRedForeground1 }} />}>
          错误
        </ToastTitle>
        <ToastBody>{message}</ToastBody>
      </Toast>,
      { intent: 'error' }
    );
  }, [dispatchToast]);

  // 选择 Markdown 文件
  const handleSelectFile = useCallback(async () => {
    if (isDirty) {
      const confirm = await window.confirm('当前文件有未保存的更改，确定要打开新文件吗？（更改将丢失）');
      if (!confirm) return;
    }
    try {
      const selected = await open({
        multiple: false,
        filters: [{
          name: 'Markdown',
          extensions: ['md', 'markdown']
        }]
      });

      if (selected) {
        setIsLoading(true);
        setLoadingMessage('正在读取文件...');

        const content = await invoke<string>('read_markdown_file', { path: selected });
        setMarkdownContent(content);

        setLoadingMessage('正在解析文档结构...');
        await new Promise(resolve => setTimeout(resolve, 10));

        const blocks = parseMarkdownToBlocks(content);
        setMarkdownBlocks(blocks);
        
        setCurrentFile(selected as string);
        setIsDirty(false);
        showSuccessToast(`已加载 ${(selected as string).split(/[/\\\\]/).pop()}`);
        setIsLoading(false);
      }
    } catch (error) {
      setIsLoading(false);
      showErrorToast(`读取文件失败: ${error}`);
    }
  }, [showSuccessToast, showErrorToast, isDirty, parseMarkdownToBlocks]);

  // 保存文件
  const handleSave = useCallback(async () => {
    if (!currentFile || !markdownContent) return;

    try {
      setIsLoading(true);
      setLoadingMessage('正在保存文件...');
      await writeTextFile(currentFile, markdownContent);
      setIsDirty(false);
      showSuccessToast('文件已保存');
    } catch (error) {
      showErrorToast(`保存失败: ${error}`);
    } finally {
      setIsLoading(false);
    }
  }, [currentFile, markdownContent, showSuccessToast, showErrorToast]);

  // 另存为
  const handleSaveAs = useCallback(async () => {
    if (!markdownContent) return;

    try {
      const savePath = await save({
        filters: [{
          name: 'Markdown',
          extensions: ['md', 'markdown']
        }],
        defaultPath: currentFile || 'document.md'
      });

      if (!savePath) return;

      setIsLoading(true);
      setLoadingMessage('正在另存为...');
      await writeTextFile(savePath, markdownContent);
      setCurrentFile(savePath);
      setIsDirty(false);
      showSuccessToast('文件已另存为');
    } catch (error) {
      showErrorToast(`另存为失败: ${error}`);
    } finally {
      setIsLoading(false);
    }
  }, [currentFile, markdownContent, showSuccessToast, showErrorToast]);

  // 恢复文件（丢弃更改）
  const handleRestore = useCallback(async () => {
    if (!currentFile) return;

    const confirm = await window.confirm('确定要恢复到原始状态吗？所有未保存的更改都将丢失。');
    if (!confirm) return;

    try {
      setIsLoading(true);
      setLoadingMessage('正在恢复文件...');

      const content = await invoke<string>('read_markdown_file', { path: currentFile });
      setMarkdownContent(content);

      const blocks = parseMarkdownToBlocks(content);
      setMarkdownBlocks(blocks);
      
      setIsDirty(false);
      showSuccessToast('已恢复到原始状态');
    } catch (error) {
      showErrorToast(`恢复失败: ${error}`);
    } finally {
      setIsLoading(false);
    }
  }, [currentFile, showSuccessToast, showErrorToast, parseMarkdownToBlocks]);

  // 导出为 PDF
  const handleExportPdf = useCallback(async () => {
    if (!markdownContent) {
      showErrorToast('请先选择一个 Markdown 文件');
      return;
    }

    try {
      const savePath = await save({
        filters: [{
          name: 'PDF 文档',
          extensions: ['pdf']
        }],
        defaultPath: currentFile ? currentFile.replace(/\.(md|markdown)$/i, '.pdf') : 'document.pdf'
      });

      if (!savePath) return;

      setIsLoading(true);
      setLoadingMessage('正在生成 HTML 内容...');
      await new Promise(resolve => setTimeout(resolve, 10));

      const processed = await unified()
        .use(remarkParse)
        .use(remarkGfm)
        .use(remarkMath)
        .use(remarkRehype)
        .use(rehypeKatex)
        .use(rehypeStringify)
        .process(markdownContent);
      const previewHtml = processed.toString();

      setLoadingMessage('正在启动渲染引擎...');
      await invoke('export_to_pdf', {
        htmlContent: previewHtml,
        outputPath: savePath,
        title: currentFile ? currentFile.split(/[/\\\\]/).pop()?.replace(/\.(md|markdown)$/i, '') : 'document'
      });

      setIsLoading(false);
      showSuccessToast('PDF 导出成功！');
    } catch (error) {
      setIsLoading(false);
      showErrorToast(`导出 PDF 失败: ${error}`);
    }
  }, [markdownContent, currentFile, showSuccessToast, showErrorToast]);

  return (
    <FluentProvider theme={isDarkMode ? webDarkTheme : webLightTheme}>
      <div className={styles.root}>
        {/* 标题栏 */}
        <header className={styles.header}>
          <div className={styles.headerTitle}>
            <DocumentPdfRegular style={{ color: tokens.colorBrandForeground1 }} />
            <Title3>MD2PDF - Markdown 转 PDF 工具</Title3>
          </div>
          <div className={styles.headerActions}>
            <Button
              appearance="secondary"
              icon={<ArrowUploadRegular />}
              onClick={handleSelectFile}
            >
              打开
            </Button>
            <Button
              appearance="secondary"
              icon={<SaveRegular />}
              onClick={handleSave}
              disabled={!currentFile || !isDirty}
            >
              保存
            </Button>
            <Button
              appearance="secondary"
              icon={<SaveCopyRegular />}
              onClick={handleSaveAs}
              disabled={!markdownContent}
            >
              另存为
            </Button>
            <Button
              appearance="secondary"
              icon={<ArrowUndoRegular />}
              onClick={handleRestore}
              disabled={!currentFile || !isDirty}
            >
              恢复
            </Button>
            <Button
              appearance="primary"
              icon={<DocumentPdfRegular />}
              onClick={handleExportPdf}
              disabled={!markdownContent}
            >
              导出为 PDF
            </Button>
          </div>
        </header>

        {/* 主内容区域 */}
        <main className={styles.content}>
          {/* 状态栏 */}
          {currentFile && (
            <div className={styles.statusBar}>
              <DocumentRegular className={styles.statusIcon} />
              <Body1>当前文件: {currentFile.split(/[/\\\\\\\\\\\\\\\\]/).pop()} {isDirty && <span style={{ color: tokens.colorPaletteRedForeground1 }}>* (已修改)</span>}</Body1>
            </div>
          )}

          {/* 分割视图 */}
          <div className={styles.splitPane}>
            {/* 左侧：源码（虚拟化） */}
            <div className={styles.pane}>
              <div className={styles.paneHeader}>
                <Body1><b>Markdown 源码 (可编辑)</b></Body1>
                {currentFile && <Body1>{(currentFile as string).split(/[/\\\\]/).pop()}</Body1>}
              </div>
              <div className={styles.scrollArea}>
                <Virtuoso
                  ref={leftVirtuosoRef}
                  scrollerRef={leftScrollerCallback}
                  style={{ height: '100%' }}
                  data={markdownBlocks}
                  rangeChanged={handleLeftRangeChanged}
                  itemContent={(index, block) => (
                    <div className={styles.blockContainer}>
                      <div className={`${styles.blockToolbar} block-toolbar`}>
                        <Button
                          size="small"
                          appearance="subtle"
                          icon={<MergeRegular />}
                          onClick={() => handleMergeNext(index)}
                          disabled={index === markdownBlocks.length - 1}
                          title="与下方合并"
                        />
                        <Button
                          size="small"
                          appearance="subtle"
                          icon={<DeleteRegular />}
                          onClick={() => handleDeleteBlock(index)}
                          title="删除区块"
                        />
                      </div>
                      <textarea
                        className={styles.editorRow}
                        value={block.content}
                        onChange={(e) => handleBlockChange(index, e.target.value)}
                        spellCheck={false}
                      />
                    </div>
                  )}
                />
              </div>
            </div>

            {/* 右侧：预览（虚拟化） */}
            <div className={styles.pane}>
              <div className={styles.paneHeader}>
                <Body1><b>PDF 预览</b></Body1>
                <Body1>共 {markdownContent.length} 字符</Body1>
              </div>
              <div className={`${styles.scrollArea} markdown-preview`}>
                {markdownContent ? (
                  <Virtuoso
                    ref={rightVirtuosoRef}
                    scrollerRef={rightScrollerCallback}
                    style={{ height: '100%' }}
                    data={markdownBlocks}
                    rangeChanged={handleRightRangeChanged}
                    itemContent={(index, block) => (
                      <div className={`${styles.previewRow} ${styles.blockContainer}`}>
                        <div className={`${styles.blockToolbar} block-toolbar`}>
                          <Button
                            size="small"
                            appearance="subtle"
                            icon={<MergeRegular />}
                            onClick={() => handleMergeNext(index)}
                            disabled={index === markdownBlocks.length - 1}
                            title="与下方合并"
                          />
                          <Button
                            size="small"
                            appearance="subtle"
                            icon={<DeleteRegular />}
                            onClick={() => handleDeleteBlock(index)}
                            title="删除区块"
                          />
                        </div>
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm, remarkMath]}
                          rehypePlugins={[rehypeKatex]}
                        >
                          {block.content}
                        </ReactMarkdown>
                      </div>
                    )}
                  />
                ) : (
                  <div className={styles.emptyState}>
                    <DocumentRegular className={styles.emptyIcon} />
                    <Body1>选择文件后在此预览</Body1>
                  </div>
                )}
              </div>
            </div>
          </div>
        </main>

        {/* 加载遮罩 */}
        {isLoading && (
          <div className={styles.loadingOverlay}>
            <Card className={styles.loadingCard}>
              <Spinner size="large" />
              <Body1>{loadingMessage}</Body1>
            </Card>
          </div>
        )}

        {/* Toast 通知 */}
        <Toaster toasterId={toasterId} position="bottom-end" />
      </div>
    </FluentProvider>
  );
}

export default App;
