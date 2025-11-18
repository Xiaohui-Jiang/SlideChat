# Job Context & Memory Fix

## 问题
1. ❌ Job ID 太长（UUID 格式），不易读
2. ❌ 聊天和分析 job 是分离的，无法根据之前的对话询问分析信息
3. ❌ GPT 不知道当前正在运行的 job

## 解决方案

### 后端改进 (Python API)

#### 1. Session-Job 关联
- ✅ `AnalysisRequest` 添加 `session_id` 字段
- ✅ Job 创建时存储 `session_id`
- ✅ 新端点：`GET /api/session/{session_id}/jobs` 查询 session 的所有 jobs

#### 2. 聊天上下文增强
- ✅ `/api/chat` 自动查找当前 session 的 jobs
- ✅ 将 active/completed job 信息注入 system prompt
- ✅ GPT 现在知道：
  - 当前正在运行的分析
  - 最近完成的分析
  - Job ID 和命令

### 前端改进建议 (待实现)

#### 1. 友好的 Job 名称
```typescript
// 生成易读名称
function generateJobName(): string {
    const adjectives = ['Swift', 'Bright', 'Noble', 'Wise'];
    const nouns = ['Falcon', 'Eagle', 'Hawk', 'Phoenix'];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const num = Math.floor(Math.random() * 999) + 1;
    return `${adj}-${noun}-${num}`;  // 例如: "Swift-Eagle-123"
}
```

#### 2. 提交 Job 时传递 session_id
```typescript
const response = await submitAnalysis({
    data_path: dataPath,
    command: command,
    auto_mode: false,
    session_id: sessionId  // ← 添加这个
});
```

#### 3. 显示友好名称
```typescript
// 存储映射
const [jobNames, setJobNames] = useState<Record<string, string>>({});

// Job 创建时
const jobName = generateJobName();
setJobNames(prev => ({ ...prev, [jobId]: jobName }));
setCurrentJobName(jobName);

// 显示时
<div>Job: {jobNames[jobId] || jobId.substring(0, 8)}</div>
```

## 使用效果

### 之前 ❌
```
User: "what's the status of my analysis?"
GPT: "I don't have access to job information. Please provide a job ID."
```

### 现在 ✅
```
User: "what's the status of my analysis?"
GPT: "Your current analysis (Job: 3bc1f95a) is running. 
     It's analyzing cell types and spatial patterns in your lung tissue sample."
```

### 查询历史 ✅
```
User: "show me my recent jobs"
→ GET /api/session/{session_id}/jobs
Returns all jobs linked to this chat session
```

## API 变更

### 新增端点
```python
GET /api/session/{session_id}/jobs
# Response:
{
    "session_id": "uuid...",
    "jobs": [
        {
            "job_id": "3bc1f95a-...",
            "status": "completed",
            "command": "Analyze cell types",
            "created_at": "2025-11-17T..."
        }
    ]
}
```

### 修改端点
```python
POST /api/analyze
# Request body 新增:
{
    "data_path": "...",
    "command": "...",
    "session_id": "uuid..."  # ← 新增
}

POST /api/chat
# System prompt 现在自动包含:
"""
Current active analysis job:
- Job ID: 3bc1f95a
- Command: Analyze cell types
- Status: running
"""
```

## 测试

### 1. 测试 Job 关联
```bash
# 提交 job
curl -X POST http://localhost:8000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "data_path": "/path/to/data.h5",
    "command": "Analyze cell types",
    "session_id": "test-session-123"
  }'

# 查询 session 的 jobs
curl http://localhost:8000/api/session/test-session-123/jobs
```

### 2. 测试聊天上下文
```bash
curl -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "what is my current analysis doing?",
    "session_id": "test-session-123"
  }'
```

## 下一步

### 必须实现 (高优先级)
1. ✅ 后端：Session-Job 关联 (已完成)
2. ✅ 后端：聊天上下文注入 (已完成)
3. ⏳ 前端：传递 session_id 到 `/api/analyze`
4. ⏳ 前端：生成和显示友好 job 名称

### 可选改进 (中优先级)
5. 添加 job 重命名功能
6. 在聊天界面显示当前 active job badge
7. 点击 job 名称查看详情
8. 支持切换到历史 job 的上下文

### 长期改进
9. Job 标签和分类
10. Job 搜索功能
11. Job 导出和分享

## 实现状态

- ✅ 后端 Session-Job 关联
- ✅ 后端聊天上下文增强
- ⏳ 前端 session_id 传递 (需要修改 `submitAnalysis` 调用)
- ⏳ 前端友好名称 (需要添加名称生成和映射)
- ⏳ Node 代理路由 (已有，无需修改)

---

**实施建议**: 先测试后端改动是否正常工作，然后逐步添加前端功能。
