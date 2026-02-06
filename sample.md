# 示例 Markdown 文档

这是一个用于测试 MD2PDF 应用程序的示例文档。

## 数学公式

### 行内公式

著名的质能方程：$E = mc^2$，其中 $E$ 表示能量，$m$ 表示质量，$c$ 表示光速。

欧拉公式：$e^{i\pi} + 1 = 0$

### 块级公式

麦克斯韦方程组：

$$
\nabla \cdot \mathbf{E} = \frac{\rho}{\varepsilon_0}
$$

$$
\nabla \cdot \mathbf{B} = 0
$$

$$
\nabla \times \mathbf{E} = -\frac{\partial \mathbf{B}}{\partial t}
$$

$$
\nabla \times \mathbf{B} = \mu_0 \mathbf{J} + \mu_0 \varepsilon_0 \frac{\partial \mathbf{E}}{\partial t}
$$

### 矩阵

$$
\begin{pmatrix}
a & b \\
c & d
\end{pmatrix}
\begin{pmatrix}
x \\
y
\end{pmatrix}
=
\begin{pmatrix}
ax + by \\
cx + dy
\end{pmatrix}
$$

### 积分

$$
\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}
$$

## 代码示例

这是一段 JavaScript 代码：

```javascript
function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

console.log(fibonacci(10)); // 输出: 55
```

## 表格

| 功能 | 描述 | 状态 |
|------|------|------|
| Markdown 解析 | 使用 pulldown-cmark | ✅ 完成 |
| KaTeX 渲染 | 支持行内和块级公式 | ✅ 完成 |
| PDF 导出 | 使用 headless Chrome | ✅ 完成 |

## 引用

> 这是一段引用文字。
>
> 可以包含多行内容。

## 列表

### 无序列表

- 第一项
- 第二项
  - 嵌套项目
  - 另一个嵌套项目
- 第三项

### 有序列表

1. 首先
2. 然后
3. 最后

## 链接和图片

访问 [GitHub](https://github.com) 了解更多。

---

*这是斜体文字*

**这是粗体文字**

~~这是删除线~~
