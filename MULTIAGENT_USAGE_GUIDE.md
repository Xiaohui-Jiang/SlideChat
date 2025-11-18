# 🎉 SlideChat Multiagent 功能使用指南

恭喜！您的 SlideChat 系统现已集成单细胞生物数据分析功能。

## 📱 如何使用

### 1. 访问 Multiagent 分析界面

打开浏览器访问 SlideChat（通常是 `http://localhost:3000`），您会看到顶部有两个选项卡：

- **🔬 组织切片分析** - 原有的组织切片查看和分析功能
- **🧬 单细胞数据分析** - 新增的 Multiagent 分析功能

点击 **🧬 单细胞数据分析** 切换到 Multiagent 界面。

### 2. 提交分析任务

在 Multiagent 界面中：

#### 步骤 1: 输入数据文件路径
在"数据文件路径"输入框中，输入您的 `.h5ad` 数据文件的路径，例如：
```
./20k_NSCLC_DTC_3p_nextgem_intron_donor_1_count_sample_feature_bc_matrix.h5
```

**路径格式**：
- 相对路径：相对于 `langchain_multiagent_forfront` 目录
- 绝对路径：如 `/Users/username/data/sample.h5ad`

#### 步骤 2: 输入分析命令
在"分析命令"文本框中，描述您想要进行的分析，例如：
```
Analyze cell types and spatial patterns in this lung tissue sample
```

或者中文：
```
分析这个肺组织样本中的细胞类型和空间分布模式
```

**示例命令**：
- "Perform comprehensive single-cell analysis"
- "Identify cell types and analyze differential expression"
- "Analyze spatial neighborhoods and cell-cell interactions"
- "分析细胞类型、差异表达和空间域"

#### 步骤 3: 点击"开始分析"
点击 **🚀 开始分析** 按钮，系统会：
1. 提交任务到后台
2. 显示任务 ID 和状态
3. 自动轮询检查分析进度
4. 完成后显示结果

### 3. 查看分析结果

分析完成后，您会看到：

#### ✅ 分析摘要
显示分析的主要发现和关键结果

#### 📥 下载选项
- **📄 下载 PDF 报告** - 包含所有图表和分析结果的完整 PDF 文档
- **📝 下载文本报告** - 纯文本格式的分析报告
- **📊 下载分析日志** - JSON 格式的详细分析日志

### 4. 查看历史任务

界面底部的"📋 历史任务"部分显示所有已提交的任务：
- 任务 ID（前 8 位）
- 任务状态：`pending`、`running`、`completed`、`failed`
- 创建时间

点击任何已完成的任务可以重新查看其结果。

## 🎯 实际使用示例

### 示例 1: 基础细胞类型分析

**数据文件**：
```
./data/pbmc_sample.h5ad
```

**分析命令**：
```
Identify cell types in this PBMC sample and show their proportions
```

**预期结果**：
- 细胞类型识别和注释
- 各类型细胞比例
- UMAP/t-SNE 可视化
- 标记基因表达

### 示例 2: 空间转录组分析

**数据文件**：
```
./data/spatial_tissue.h5ad
```

**分析命令**：
```
Analyze spatial patterns, identify spatial domains, and examine cell-cell interactions in this tissue
```

**预期结果**：
- 空间域识别
- 细胞邻域分析
- 空间可变基因
- 空间可视化图

### 示例 3: 差异表达分析

**数据文件**：
```
./data/treatment_vs_control.h5ad
```

**分析命令**：
```
Compare treatment and control groups, identify differentially expressed genes, and perform pathway enrichment
```

**预期结果**：
- 差异表达基因列表
- 火山图/MA图
- GO/KEGG 富集分析
- 热图可视化

## 🔧 系统架构

```
浏览器 (React 前端)
    ↓ HTTP
Node.js 服务器 (localhost:5050)
    ↓ 代理转发
Python Multiagent 服务 (localhost:8000)
    ↓ 调用
生物信息学工具链 (Scanpy, Squidpy, etc.)
```

## ⚙️ 技术细节

### 支持的数据格式
- **主要格式**：`.h5ad` (AnnData HDF5)
- **替代格式**：`.h5` (10X Genomics)

### 可用的分析工具
1. **MetadataInspector** - 数据集检查
2. **PreprocessPipeline** - 质控和预处理
3. **DEAnalysis** - 差异表达分析
4. **CellTyping** - 细胞类型注释
5. **SpatialNeighborhood** - 空间邻域分析
6. **SpatialDomain** - 空间域识别

### 规划模式
- **LLM 规划器**（默认）：使用 AI 智能生成分析步骤
- **静态规划器**：使用预定义的分析流程

## 🐛 故障排查

### 问题 1: "数据文件不存在"
**解决方案**：
- 检查文件路径是否正确
- 确保文件在 `langchain_multiagent_forfront` 目录下或使用绝对路径
- 验证文件扩展名为 `.h5ad` 或 `.h5`

### 问题 2: 任务一直处于 "pending" 状态
**解决方案**：
- 检查 Python API 服务是否正在运行
- 查看终端日志是否有错误信息
- 刷新页面重试

### 问题 3: 分析失败
**解决方案**：
- 查看错误消息
- 检查数据文件格式是否正确
- 确保 OPENAI_API_KEY 已设置
- 查看 Python 服务的日志输出

### 问题 4: 无法下载结果
**解决方案**：
- 等待任务完全完成（状态为 `completed`）
- 检查浏览器控制台是否有网络错误
- 确认 Node.js 代理正常工作

## 📊 性能提示

- **小数据集**（< 10K 细胞）：分析通常在 2-5 分钟内完成
- **中等数据集**（10K-50K 细胞）：预计 5-15 分钟
- **大数据集**（> 50K 细胞）：可能需要 15-30+ 分钟

## 🔒 安全注意事项

1. **API Key**：确保 OPENAI_API_KEY 安全存储，不要提交到代码库
2. **数据隐私**：敏感数据不会发送到 OpenAI，仅用于生成分析计划
3. **访问控制**：生产环境应添加用户认证

## 📚 更多资源

- **Scanpy 文档**：https://scanpy.readthedocs.io/
- **Squidpy 文档**：https://squidpy.readthedocs.io/
- **AnnData 格式**：https://anndata.readthedocs.io/

## 🎉 开始使用吧！

现在您可以：
1. 准备好您的 `.h5ad` 数据文件
2. 打开 SlideChat 界面
3. 切换到 "🧬 单细胞数据分析" 选项卡
4. 输入文件路径和分析命令
5. 点击"开始分析"
6. 等待结果并下载报告

祝分析愉快！🎊
