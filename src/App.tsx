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
  WandRegular,
} from '@fluentui/react-icons';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
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

// 自定义 rehype 插件：处理 HTML 元素内的 LaTeX 公式
const rehypeMathInHtml = () => {
  return (tree: any) => {
    const visit = (node: any) => {
      // 处理文本节点
      if (node.type === 'text' && node.value) {
        const value = node.value;

        // 检查是否包含行内公式 $...$
        if (value.includes('$')) {
          const parts = [];
          let lastIndex = 0;

          // 匹配行内公式 $...$（非贪婪，不匹配 $$）
          const inlineRegex = /\$(?!\$)([^\$]+?)\$/g;
          let match;

          while ((match = inlineRegex.exec(value)) !== null) {
            // 添加公式前的文本
            if (match.index > lastIndex) {
              parts.push({
                type: 'text',
                value: value.substring(lastIndex, match.index)
              });
            }

            // 添加数学公式节点
            parts.push({
              type: 'element',
              tagName: 'span',
              properties: { className: ['math', 'math-inline'] },
              children: [{
                type: 'text',
                value: match[1]
              }]
            });

            lastIndex = match.index + match[0].length;
          }

          // 添加剩余的文本
          if (lastIndex < value.length) {
            parts.push({
              type: 'text',
              value: value.substring(lastIndex)
            });
          }

          // 如果找到了公式，替换当前节点
          if (parts.length > 0 && lastIndex > 0) {
            // 获取父节点并替换
            return parts;
          }
        }
      }

      // 递归处理子节点
      if (node.children) {
        const newChildren: any[] = [];
        node.children.forEach((child: any) => {
          const result = visit(child);
          if (Array.isArray(result)) {
            newChildren.push(...result);
          } else {
            newChildren.push(child);
          }
        });
        node.children = newChildren;
      }
    };

    visit(tree);
  };
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

    // 辅助函数：将一个范围内的行拆分为分块，但保持 $$...$$ 块级公式完整
    const splitLinesWithMath = (startLine: number, endLine: number): any[] => {
      const result: any[] = [];
      let current = startLine;
      
      while (current <= endLine) {
        const lineContent = lines[current - 1] || '';
        
        // 检查是否是块级公式的开始（以 $$ 开头）
        if (lineContent.trim().startsWith('$$')) {
          let j = current;
          // 如果这一行本身就包含了结束符（且不是只有两个$），则它是一个单行块级公式
          let foundEnd = lineContent.trim().length > 2 && lineContent.trim().endsWith('$$') && lineContent.trim() !== '$$';
          
          if (!foundEnd) {
            j = current + 1;
            while (j <= endLine) {
              if (lines[j - 1].trim().endsWith('$$')) {
                foundEnd = true;
                break;
              }
              j++;
            }
          }
          
          if (foundEnd) {
            result.push({
              type: 'math',
              position: {
                start: { line: current, column: 1 },
                end: { line: j, column: 1 }
              }
            });
            current = j + 1;
            continue;
          }
        }
        
        // 普通行
        result.push({
          type: 'line',
          position: {
            start: { line: current, column: 1 },
            end: { line: current, column: 1 }
          }
        });
        current++;
      }
      return result;
    };
    
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
          // 对于 paragraph, heading 等“文本类块”，我们将其进一步拆分
          if (node.position) {
            const startLine = node.position.start.line;
            const endLine = node.position.end.line;
            
            if (startLine < endLine && (node.type === 'paragraph' || node.type === 'heading')) {
              atoms = atoms.concat(splitLinesWithMath(startLine, endLine));
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
    let atomNodes = getAtomNodes(children)
      .filter(node => node.position)
      .sort((a, b) => {
        if (a.position.start.line !== b.position.start.line) {
          return a.position.start.line - b.position.start.line;
        }
        return a.position.end.line - b.position.end.line;
      });

    // 强制拆分 HTML 块中的表格，确保 <table>...</table> 是独立的
    const refinedAtomNodes: any[] = [];
    for (const node of atomNodes) {
      if (node.type === 'html' && node.position) {
        const startLine = node.position.start.line;
        const endLine = node.position.end.line;
        const nodeLines = lines.slice(startLine - 1, endLine);
        
        // 检查是否包含表格标签，如果不包含则不进行特殊处理
        const fullContent = nodeLines.join('\n');
        if (!fullContent.includes('<table') && !fullContent.includes('</table>')) {
          refinedAtomNodes.push(node);
          continue;
        }

        let currentStart = 0;
        for (let k = 0; k < nodeLines.length; k++) {
          const line = nodeLines[k];
          // 如果某行包含 <table (通常是表格开始)
          if (k > currentStart && line.trim().match(/^<table[>\s]/i)) {
            // 将表格之前的内容拆分为行，以便能够正常处理其中的 markdown/latex
            const splitNodes = splitLinesWithMath(startLine + currentStart, startLine + k - 1);
            refinedAtomNodes.push(...splitNodes);
            currentStart = k;
          }
          
          // 如果某行包含 </table> (表格结束) 且后面还有内容，则在这一行之后拆分
          if (line.includes('</table>') && k < nodeLines.length - 1) {
            // 将 </table> 之前（含）的内容作为 HTML 块推入
            refinedAtomNodes.push({
              ...node,
              position: {
                start: { line: startLine + currentStart },
                end: { line: startLine + k }
              }
            });
            currentStart = k + 1;
          }
        }
        
        if (startLine + currentStart <= endLine) {
          const remStart = startLine + currentStart;
          const remEnd = endLine;
          const remainingContent = nodeLines.slice(currentStart).join('\n');
          // 如果剩余部分不再包含表格标签（即它是表格后的普通文字），则尝试按 math 规则拆分
          if (!remainingContent.includes('<table') && !remainingContent.includes('</table>')) {
            const splitNodes = splitLinesWithMath(remStart, remEnd);
            refinedAtomNodes.push(...splitNodes);
          } else {
            refinedAtomNodes.push({
              ...node,
              position: {
                start: { line: remStart },
                end: { line: remEnd }
              }
            });
          }
        }
      } else {
        refinedAtomNodes.push(node);
      }
    }
    atomNodes = refinedAtomNodes;

    // 合并 HTML 表格节点（只合并 <table>...</table> 之间的内容）
    const mergedNodes: any[] = [];
    let i = 0;

    while (i < atomNodes.length) {
      const node = atomNodes[i];

      if (node.type === 'html') {
        // 获取当前HTML节点的内容
        const nodeContent = lines.slice(node.position.start.line - 1, node.position.end.line).join('\n');

        // 检查是否是表格开始标签
        if (nodeContent.trim().match(/^<table[>\s]/i)) {
          // 找到表格开始，收集到 </table> 为止的所有HTML节点
          let lastLine = node.position.end.line;
          let j = i + 1;
          let foundTableEnd = nodeContent.includes('</table>');

          while (!foundTableEnd && j < atomNodes.length && atomNodes[j].type === 'html') {
            // 检查是否连续（中间允许有空行）
            if (atomNodes[j].position.start.line <= lastLine + 2) {
              const nextContent = lines.slice(atomNodes[j].position.start.line - 1, atomNodes[j].position.end.line).join('\n');
              lastLine = atomNodes[j].position.end.line;

              // 检查是否包含表格结束标签
              if (nextContent.includes('</table>')) {
                foundTableEnd = true;
              }
              j++;
            } else {
              break;
            }
          }

          // 合并表格节点
          if (foundTableEnd && j > i + 1) {
            mergedNodes.push({
              type: 'html',
              position: {
                start: { line: node.position.start.line },
                end: { line: lastLine }
              }
            });
            i = j;
          } else {
            // 没有找到完整的表格，保持原节点
            mergedNodes.push(node);
            i++;
          }
        } else {
          // 不是表格开始标签，不合并
          mergedNodes.push(node);
          i++;
        }
      } else {
        mergedNodes.push(node);
        i++;
      }
    }

    atomNodes = mergedNodes;

    // 调试：打印节点信息
    console.log('Parsed AST nodes:', atomNodes.map(n => ({
      type: n.type,
      lines: `${n.position.start.line}-${n.position.end.line}`,
      preview: content.split(/\r?\n/).slice(n.position.start.line - 1, n.position.end.line).join('\\n').substring(0, 50)
    })));

    let lastLineProcessed = 0; // 0-indexed

    atomNodes.forEach((node: any, idx: number) => {
      const startLine = node.position.start.line; // 1-indexed
      const endLine = node.position.end.line;     // 1-indexed

      // 填充节点之前的空白行或未识别行（使用 math 敏感的拆分逻辑）
      if (startLine - 1 > lastLineProcessed) {
        const gapNodes = splitLinesWithMath(lastLineProcessed + 1, startLine - 1);
        gapNodes.forEach((node, gidx) => {
          const content = lines.slice(node.position.start.line - 1, node.position.end.line).join('\n');
          if (content.trim() !== '') {
            blocks.push({
              id: `gap-${node.position.start.line}-${gidx}`,
              content: content,
              startLine: node.position.start.line,
              endLine: node.position.end.line
            });
          }
        });
        lastLineProcessed = startLine - 1;
      }

      // 添加节点本身
      // 确保不与已处理的行重叠（处理某些 AST 节点可能存在的行重叠）
      const actualStartLine = Math.max(startLine, lastLineProcessed + 1);
      if (endLine >= actualStartLine) {
        const blockContent = lines.slice(actualStartLine - 1, endLine).join('\n');
        // 只有非空内容才添加为块
        if (blockContent.trim() !== '') {
          blocks.push({
            id: `block-${idx}-${actualStartLine}`,
            content: blockContent,
            startLine: actualStartLine,
            endLine
          });
        }
        lastLineProcessed = endLine;
      }
    });

    // 处理文件末尾的剩余行
    if (lastLineProcessed < lines.length) {
      const gapNodes = splitLinesWithMath(lastLineProcessed + 1, lines.length);
      gapNodes.forEach((node, gidx) => {
        const content = lines.slice(node.position.start.line - 1, node.position.end.line).join('\n');
        if (content.trim() !== '') {
          blocks.push({
            id: `gap-end-${node.position.start.line}-${gidx}`,
            content: content,
            startLine: node.position.start.line,
            endLine: node.position.end.line
          });
        }
      });
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
      // 合并时确保中间有一个换行，并清理多余空白
      const mergedContent = next[index].content.trim() + '\n' + next[index + 1].content.trim();
      next[index] = { ...next[index], content: mergedContent };
      next.splice(index + 1, 1);
      setIsDirty(true);
      return next;
    });
  }, []);

  // 当 blocks 变化时同步更新全量内容（用于导出和字符统计）
  // 强制块与块之间保持一个空行 ( \n\n )
  useEffect(() => {
    if (markdownBlocks.length > 0) {
      const newContent = markdownBlocks
        .map(b => b.content.trim())
        .filter(content => content !== '')
        .join('\n\n');
        
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
        .use(remarkRehype, { allowDangerousHtml: true })
        .use(rehypeRaw)
        .use(rehypeMathInHtml)
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

  // 格式化 Markdown
  const handleFormatMarkdown = useCallback(async () => {
    if (markdownBlocks.length === 0) return;

    setIsLoading(true);
    setLoadingMessage('正在格式化...');
    await new Promise(resolve => setTimeout(resolve, 10));

    const nonEmptyBlocks = markdownBlocks.filter(block => block.content.trim() !== '');
    
    if (nonEmptyBlocks.length === 0) {
      setMarkdownBlocks([]);
      setMarkdownContent('');
      setIsDirty(true);
      setIsLoading(false);
      return;
    }

    let formattedContent = nonEmptyBlocks.map(block => block.content.trim()).join('\n\n');

    formattedContent = formattedContent.replace(/\$\$([^\$\n]+?)\$\$/g, '\n\n$$$$\n$1\n$$$$\n\n');

    const lines = formattedContent.split('\n');
    let inFormula = false;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === '$$') {
        if (!inFormula) {
          if (i > 0 && lines[i - 1].trim() !== '') {
            lines.splice(i, 0, '');
            i++;
          }
          inFormula = true;
        } else {
          if (i < lines.length - 1 && lines[i + 1].trim() !== '') {
            lines.splice(i + 1, 0, '');
          }
          inFormula = false;
        }
      }
    }
    formattedContent = lines.join('\n');

    formattedContent = formattedContent.replace(/\n{3,}/g, '\n\n');

    formattedContent = formattedContent.trim();
    
    const newBlocks = parseMarkdownToBlocks(formattedContent);
    
    setMarkdownBlocks(newBlocks);
    setMarkdownContent(formattedContent);
    setIsDirty(true);
    setIsLoading(false);
    showSuccessToast('已完成格式化：块间已统一空行并清理空块');
  }, [markdownBlocks, parseMarkdownToBlocks, showSuccessToast]);

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
              icon={<WandRegular />}
              onClick={handleFormatMarkdown}
              disabled={!markdownContent}
            >
              格式化
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
                          rehypePlugins={[rehypeRaw, rehypeMathInHtml, rehypeKatex]}
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
