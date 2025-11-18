# 🎯 Interactive Agent 聊天集成指南

## 📋 功能说明

现在 `interactive_agent.py` 中的交互式对话功能已经完全集成到网页聊天界面中！

### 两种模式

#### 1️⃣ 自动模式 (Auto Mode)
- Agent 自动回答所有问题
- 快速完成分析
- 适合熟悉流程的用户

#### 2️⃣ 交互模式 (Interactive Mode)  
- **Agent 会在聊天中询问问题**
- **您可以实时回答并指导分析过程**
- **完全复现 `interactive_agent.py` 的命令行交互体验**

## 🎮 使用方式

### 完整对话流程示例

```
👤 User: start

🤖 Assistant: 🚀 Great! Let's start a new analysis.

First, please provide the path to your data file:
Format: .h5ad file (AnnData format)
Example: ./data/sample.h5ad or /path/to/your/data.h5ad

Or type 'example' to use a sample dataset.

---

👤 User: example

🤖 Assistant: 📁 Using example dataset: `./langchain_multiagent_forfront/20k_NSCLC_DTC_3p_nextgem_intron_donor_1_count_sample_feature_bc_matrix.h5`

**What analysis would you like me to perform?**

You can say:
• "Full analysis" - Complete workflow
• "Analyze cell types" - Focus on cell typing
• "Spatial analysis" - Spatial patterns and domains
• Or describe your custom analysis needs

---

👤 User: Full analysis

🤖 Assistant: 🎯 Got it! Now choose interaction mode:

**1. Auto Mode** (Recommended for quick analysis)
   - Agent makes all decisions automatically
   - Faster completion
   - Type: `auto`

**2. Interactive Mode** (Full control)
   - Agent asks you questions during analysis
   - You can guide the analysis process
   - Type: `interactive`

Which mode do you prefer?

---

👤 User: interactive

🤖 Assistant: 🚀 **Starting Analysis...**

📁 Data: `./langchain_multiagent_forfront/20k_NSCLC_DTC_3p_nextgem_intron_donor_1_count_sample_feature_bc_matrix.h5`
📝 Task: Full analysis

🎮 **Interactive Mode**
   - I will ask you questions during analysis
   - Please respond when I need your input

Starting now...

---

🤖 Assistant: ✅ Analysis task submitted!
📋 Job ID: `a1b2c3d4-5678-90ab-cdef-1234567890ab`

Processing started... I'll show my progress below.

---

🤖 Assistant: 📍 **MetadataInspector**: running
Inspecting dataset structure and metadata

---

🤖 Assistant: ✅ **MetadataInspector**: completed
Found 20,000 cells and 3,000 genes

---

🤖 Assistant: ⏳ **PreprocessPipeline**: running
Quality control and normalization

---

🤖 Assistant: ❓ **Agent is asking:**

What minimum number of cells should a gene be expressed in to be kept?
(Recommended: 3-10)

Please provide your answer.

---

👤 User: 5

🤖 Assistant: ✅ Response received: "5"

Continuing analysis...

---

🤖 Assistant: ❓ **Agent needs confirmation:**

Would you like to perform batch correction if multiple batches are detected?

[Y/n]

Type 'yes' or 'no' to respond.

---

👤 User: yes

🤖 Assistant: ✅ Response received: "yes"

Continuing analysis...

---

🤖 Assistant: ✅ **PreprocessPipeline**: completed
Filtered to 18,500 high-quality cells, 2,500 genes

---

🤖 Assistant: ⏳ **CellTyping**: running
Identifying cell types using marker genes

---

🤖 Assistant: ✅ **CellTyping**: completed
Identified 8 major cell types

---

🤖 Assistant: 🎉 **Analysis Completed Successfully!**

Identified 8 major cell types with clear marker genes.

**Download Results:**
• [📄 Full Report](#)
• [📊 Figures PDF](#)
• [📋 Analysis Log](#)

Type **start** to begin another analysis, or **help** for more options.
```

## 🔧 技术实现

### 后端 (Python)

#### 1. InteractiveUserIO 类
```python
# langchain_multiagent_forfront/interactive_user_io.py

class InteractiveUserIO:
    def prompt(self, message: str) -> str:
        """Block and wait for user input through API"""
        # 创建待答问题
        # 等待前端通过 API 提交响应
        # 返回用户输入
        
    def confirm(self, message: str, default: bool) -> bool:
        """Block and wait for yes/no confirmation"""
        # 创建确认请求
        # 等待前端响应
        # 返回 True/False
```

#### 2. API 端点
```python
# GET /api/messages/{job_id}
# 返回：
{
    "messages": [...],           # 所有消息
    "step_messages": [...],      # 步骤消息
    "pending": {                 # 待答问题 (仅交互模式)
        "message_id": "...",
        "type": "prompt",
        "content": "问题内容",
        "requires_response": true
    }
}

# POST /api/response/{job_id}
# 提交用户响应
{
    "message_id": "...",
    "response": "用户的答案"
}
```

### 前端 (React)

#### 1. 状态管理
```typescript
const [conversationState, setConversationState] = useState<
    'idle' | 
    'awaiting_path' | 
    'awaiting_command' | 
    'awaiting_mode' |        // 新增：选择模式
    'running' | 
    'awaiting_response'      // 新增：等待用户回答 Agent 问题
>();

const [pendingQuestion, setPendingQuestion] = useState<AgentMessage | null>(null);
const [interactiveMode, setInteractiveMode] = useState(false);
```

#### 2. 消息轮询
```typescript
useEffect(() => {
    const interval = setInterval(async () => {
        const { messages, step_messages, pending } = await getJobMessages(currentJobId);
        
        // 检查是否有待答问题
        if (pending && !pending.response) {
            setPendingQuestion(pending);
            setConversationState('awaiting_response');
            // 在聊天中显示问题
        }
    }, 2000);
}, [currentJobId]);
```

#### 3. 响应提交
```typescript
if (conversationState === 'awaiting_response' && pendingQuestion) {
    // 用户输入的消息作为答案
    await submitResponse(
        currentJobId,
        pendingQuestion.message_id,
        userMessage
    );
    setPendingQuestion(null);
    setConversationState('running');
}
```

## 📊 对比

### 命令行版本 (interactive_agent.py)
```bash
$ python interactive_agent.py --data ./data.h5ad

[AGENT] Launching BioAnalysisAgent...
[PROMPT] What minimum number of cells should a gene be expressed in?
> 5
[AGENT] Using min_cells=5...
[CONFIRM] Would you like to perform batch correction? [Y/n]
> yes
[AGENT] Performing batch correction...
```

### 网页聊天版本
```
🤖: What minimum number of cells should a gene be expressed in?
👤: 5
🤖: ✅ Response received: "5"
     Using min_cells=5...

🤖: Would you like to perform batch correction? [Y/n]
👤: yes  
🤖: ✅ Response received: "yes"
     Performing batch correction...
```

**完全一致的交互体验，但更友好的界面！**

## 🎨 UI 状态指示

### 顶部状态栏
```
🧬 Single-Cell Analysis Chat
   ⚪ Ready for new analysis           (idle)
   📂 Waiting for data path...         (awaiting_path)
   📝 Waiting for analysis command...  (awaiting_command)
   🎯 Waiting for mode selection...    (awaiting_mode)
   🔄 Analysis in progress            (running)
   ❓ Waiting for your response       (awaiting_response) ← 新增
```

### 快捷按钮
- 🚀 New Analysis - 开始新分析
- 📋 List Jobs - 查看所有任务
- ❓ Help - 显示帮助
- ❌ Cancel - 取消当前流程（仅在 awaiting_* 状态）

## ✅ 完成的集成

### Python 后端
- ✅ `interactive_user_io.py` - 交互式 UserIO 类
- ✅ `api.py` 更新支持交互模式
- ✅ `/api/response/{job_id}` 端点
- ✅ `/api/messages/{job_id}` 返回 pending 问题

### Node 代理
- ✅ `/api/multiagent/response/:jobId` 代理端点

### React 前端  
- ✅ `ChatMultiagent.tsx` 完全集成
- ✅ 模式选择流程
- ✅ 问题检测和显示
- ✅ 响应提交逻辑
- ✅ 状态管理

### API 客户端
- ✅ `submitResponse()` 函数
- ✅ AgentMessage 接口扩展
- ✅ JobMessages 接口更新

## 🚀 启动和测试

### 1. 启动 Python API
```bash
cd langchain_multiagent_forfront
source venv/bin/activate
export OPENAI_API_KEY="your-key"
python api.py
```

### 2. 启动 Node 服务器
```bash
cd server
npm run dev
```

### 3. 启动前端
```bash
cd client
npm run dev
```

### 4. 测试交互模式
1. 打开浏览器 `http://localhost:3000`
2. 点击 **🧬 Single-Cell Data Analysis** 标签
3. 在聊天中输入 **start**
4. 选择 **example** 数据集
5. 输入 **full analysis**
6. 选择 **interactive** 模式  
7. 🎉 Agent 会在聊天中问您问题！

## 💡 使用技巧

### 交互模式适合：
- ✅ 第一次使用，想了解分析流程
- ✅ 需要精细控制参数
- ✅ 探索不同分析选项
- ✅ 学习单细胞分析最佳实践

### 自动模式适合：
- ✅ 已经熟悉流程
- ✅ 使用标准参数
- ✅ 快速批量分析
- ✅ 演示和测试

## 🎊 总结

现在您有了一个**完全交互式的网页聊天界面**，可以：

1. **自然对话**：像聊天一样使用 Agent
2. **实时交互**：Agent 会问问题，您实时回答
3. **双模式**：可选自动或交互模式
4. **完整功能**：与命令行版本功能完全一致
5. **友好 UI**：比命令行更直观美观

这是 `interactive_agent.py` 的完美网页版！🎉
