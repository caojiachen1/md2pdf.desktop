import { useState, useEffect, useCallback, useRef } from 'react';
import {
  FluentProvider,
  webLightTheme,
  webDarkTheme,
  Button,
  Card,
  CardHeader,
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
} from '@fluentui/react-icons';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
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

const remarkLineNumber = () => (tree: any) => {
  injectLineNumbers(tree);
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
    ...shorthands.borderBottom('1px', 'solid', tokens.colorNeutralStroke3),
  },
  previewRow: {
    ...shorthands.padding('4px', '24px'),
    position: 'relative',
    ...shorthands.borderBottom('1px', 'solid', tokens.colorNeutralStroke3),
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
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const styles = useStyles();
  const toasterId = useId('toaster');
  const { dispatchToast } = useToastController(toasterId);
  
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
  const blocksRef = useRef<MarkdownBlock[]>([]);
  blocksRef.current = markdownBlocks;

  // rangeChanged 回调：记录两侧最上方可见块索引
  const handleLeftRangeChanged = useCallback((range: { startIndex: number; endIndex: number }) => {
    lastLeftTopIndex.current = range.startIndex;
  }, []);

  const handleRightRangeChanged = useCallback((range: { startIndex: number; endIndex: number }) => {
    lastRightTopIndex.current = range.startIndex;
  }, []);

  // 块级校准：将另一侧对齐到同一个块
  const calibrate = useCallback((source: 'left' | 'right') => {
    const topIndex = source === 'left' ? lastLeftTopIndex.current : lastRightTopIndex.current;
    const targetRef = source === 'left' ? rightVirtuosoRef : leftVirtuosoRef;

    isProgrammatic.current = true;
    targetRef.current?.scrollToIndex({
      index: topIndex,
      align: 'start',
      behavior: 'auto',
    });
    setTimeout(() => { isProgrammatic.current = false; }, 120);
  }, []);

  // 核心滚动处理函数（存在 ref 中避免闭包过时）
  const handleScroll = useRef((source: 'left' | 'right') => {
    // 只有用户主动操作的面板才触发同步
    if (isProgrammatic.current || activePane.current !== source) return;
    if (blocksRef.current.length === 0) return;

    const srcEl = source === 'left' ? leftScrollerRef.current : rightScrollerRef.current;
    const tgtEl = source === 'left' ? rightScrollerRef.current : leftScrollerRef.current;
    if (!srcEl || !tgtEl) return;

    // 百分比连续同步
    const srcMax = srcEl.scrollHeight - srcEl.clientHeight;
    const tgtMax = tgtEl.scrollHeight - tgtEl.clientHeight;
    if (srcMax > 0 && tgtMax > 0) {
      const ratio = srcEl.scrollTop / srcMax;
      const targetST = Math.round(ratio * tgtMax);
      if (Math.abs(tgtEl.scrollTop - targetST) > 1) {
        isProgrammatic.current = true;
        tgtEl.scrollTop = targetST;
        requestAnimationFrame(() => {
          isProgrammatic.current = false;
        });
      }
    }

    // 防抖校准：滚动停止 150ms 后执行块级对齐
    if (calibrationTimer.current) clearTimeout(calibrationTimer.current);
    calibrationTimer.current = setTimeout(() => calibrate(source), 150);
  });
  // 更新 ref 以获取最新的 calibrate
  handleScroll.current = (source: 'left' | 'right') => {
    if (isProgrammatic.current || activePane.current !== source) return;
    if (blocksRef.current.length === 0) return;

    const srcEl = source === 'left' ? leftScrollerRef.current : rightScrollerRef.current;
    const tgtEl = source === 'left' ? rightScrollerRef.current : leftScrollerRef.current;
    if (!srcEl || !tgtEl) return;

    const srcMax = srcEl.scrollHeight - srcEl.clientHeight;
    const tgtMax = tgtEl.scrollHeight - tgtEl.clientHeight;
    if (srcMax > 0 && tgtMax > 0) {
      const ratio = srcEl.scrollTop / srcMax;
      const targetST = Math.round(ratio * tgtMax);
      if (Math.abs(tgtEl.scrollTop - targetST) > 1) {
        isProgrammatic.current = true;
        tgtEl.scrollTop = targetST;
        requestAnimationFrame(() => {
          isProgrammatic.current = false;
        });
      }
    }

    if (calibrationTimer.current) clearTimeout(calibrationTimer.current);
    calibrationTimer.current = setTimeout(() => calibrate(source), 150);
  };

  // scrollerRef 回调：获取元素 + 绑定事件
  const leftScrollerCallback = useCallback((el: HTMLElement | Window | null) => {
    if (el instanceof HTMLElement) {
      // 移除旧的监听器
      if (leftScrollerRef.current && leftScrollerRef.current !== el) {
        const old = leftScrollerRef.current;
        old.onscroll = null;
      }
      leftScrollerRef.current = el;
      el.onscroll = () => handleScroll.current('left');
      el.onpointerenter = () => { activePane.current = 'left'; };
    }
  }, []);

  const rightScrollerCallback = useCallback((el: HTMLElement | Window | null) => {
    if (el instanceof HTMLElement) {
      if (rightScrollerRef.current && rightScrollerRef.current !== el) {
        const old = rightScrollerRef.current;
        old.onscroll = null;
      }
      rightScrollerRef.current = el;
      el.onscroll = () => handleScroll.current('right');
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
        setLoadingMessage('正在解析文档结构...');

        const content = await invoke<string>('read_markdown_file', { path: selected });
        setMarkdownContent(content);

        // 使用 unified 解析 AST 并按顶级节点分割块
        const processor = unified().use(remarkParse);
        const ast = processor.parse(content);
        const children = (ast as any).children;
        
        const blocks: MarkdownBlock[] = [];
        const lines = content.split('\n');

        children.forEach((node: any, index: number) => {
          if (node.position) {
            const startLine = node.position.start.line;
            const endLine = node.position.end.line;
            
            // 提取该块对应的原始文本
            const blockContent = lines.slice(startLine - 1, endLine).join('\n');
            
            blocks.push({
              id: `block-${index}`,
              content: blockContent,
              startLine,
              endLine
            });
          }
        });

        setMarkdownBlocks(blocks);
        setCurrentFile(selected as string);
        showSuccessToast(`已加载 ${(selected as string).split(/[/\\]/).pop()}`);
        setIsLoading(false);
      }
    } catch (error) {
      setIsLoading(false);
      showErrorToast(`读取文件失败: ${error}`);
    }
  }, [showSuccessToast, showErrorToast]);

  // 导出为 PDF
  const handleExportPdf = useCallback(async () => {
    if (!markdownContent) {
      showErrorToast('请先选择一个 Markdown 文件');
      return;
    }

    try {
      // 选择保存路径
      const savePath = await save({
        filters: [{
          name: 'PDF 文档',
          extensions: ['pdf']
        }],
        defaultPath: currentFile ? currentFile.replace(/\.(md|markdown)$/i, '.pdf') : 'document.pdf'
      });

      if (!savePath) return;

      setIsLoading(true);
      setLoadingMessage('正在生成 PDF...');

      // 使用 unified 将完整的 markdown 转换为 HTML，而不依赖预览区域的 innerHTML
      const processed = await unified()
        .use(remarkParse)
        .use(remarkGfm)
        .use(remarkMath)
        .use(remarkRehype)
        .use(rehypeKatex)
        .use(rehypeStringify)
        .process(markdownContent);
      const previewHtml = processed.toString();

      // 调用 Rust 后端生成 PDF
      await invoke('export_to_pdf', {
        htmlContent: previewHtml,
        outputPath: savePath,
        title: currentFile ? currentFile.split(/[/\\\\]/).pop()?.replace(/\\.(md|markdown)$/i, '') : 'document'
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
              选择 Markdown 文件
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
              <Body1>当前文件: {currentFile.split(/[/\\\\\\\\]/).pop()}</Body1>
            </div>
          )}

          {/* 分割视图 */}
          <div className={styles.splitPane}>
            {/* 左侧：源码（虚拟化） */}
            <div className={styles.pane}>
              <div className={styles.paneHeader}>
                <Body1 strong>Markdown 源码</Body1>
                {currentFile && <Body1 size={200}>{(currentFile as string).split(/[/\\]/).pop()}</Body1>}
              </div>
              <div className={styles.scrollArea}>
                <Virtuoso
                  ref={leftVirtuosoRef}
                  scrollerRef={leftScrollerCallback}
                  style={{ height: '100%' }}
                  data={markdownBlocks}
                  rangeChanged={handleLeftRangeChanged}
                  itemContent={(_index, block) => (
                    <div className={styles.editorRow}>
                      {block.content || ' '}
                    </div>
                  )}
                />
              </div>
            </div>

            {/* 右侧：预览（虚拟化） */}
            <div className={styles.pane}>
              <div className={styles.paneHeader}>
                <Body1 strong>PDF 预览</Body1>
                <Body1 size={200}>共 {markdownContent.length} 字符</Body1>
              </div>
              <div className={`${styles.scrollArea} markdown-preview`}>
                {markdownContent ? (
                  <Virtuoso
                    ref={rightVirtuosoRef}
                    scrollerRef={rightScrollerCallback}
                    style={{ height: '100%' }}
                    data={markdownBlocks}
                    rangeChanged={handleRightRangeChanged}
                    itemContent={(_index, block) => (
                      <div className={styles.previewRow}>
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
