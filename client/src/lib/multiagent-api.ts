/**
 * Multiagent Analysis API Client
 * 
 * 提供与 Python Multiagent 服务交互的函数
 */

export interface AnalysisRequest {
    data_path: string;
    command: string;
    planner?: 'llm' | 'static';
    include_steps?: string[];
    auto_mode?: boolean;
    session_id?: string;  // Link to chat session
}

export interface JobStatus {
    job_id: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    created_at: string;
    started_at?: string;
    completed_at?: string;
    error?: string;
}

export interface JobResult {
    job_id: string;
    status: string;
    report_url?: string;
    pdf_url?: string;
    log_url?: string;
    summary?: string;
    error?: string;
}

export interface AgentMessage {
    type: 'info' | 'prompt' | 'confirm' | 'step' | 'display';
    content: string;
    timestamp: string;
    message_id?: string;
    requires_response?: boolean;
    response?: string | null;
    responded_at?: string | null;
    auto_answered?: boolean;
    step?: string;
    status?: string;
    details?: string;
    default?: boolean;
}

export interface JobMessages {
    messages: AgentMessage[];
    step_messages: AgentMessage[];
    pending: AgentMessage | null;
}

const API_BASE = '/api/multiagent';

/**
 * 提交分析任务
 */
export async function submitAnalysis(request: AnalysisRequest): Promise<{ job_id: string }> {
    console.log('[multiagent-api] submitAnalysis called with:', request);

    const response = await fetch(`${API_BASE}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request)
    });

    console.log('[multiagent-api] Response status:', response.status, response.statusText);

    if (!response.ok) {
        const error = await response.text();
        console.error('[multiagent-api] Error response:', error);
        throw new Error(`Analysis submission failed: ${error}`);
    }

    const result = await response.json();
    console.log('[multiagent-api] Response JSON:', result);

    return result;
}

/**
 * 检查任务状态
 */
export async function checkStatus(jobId: string): Promise<JobStatus> {
    const response = await fetch(`${API_BASE}/status/${jobId}`);

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Status check failed: ${error}`);
    }

    return response.json();
}

/**
 * 获取任务结果
 */
export async function getResult(jobId: string): Promise<JobResult> {
    const response = await fetch(`${API_BASE}/result/${jobId}`);

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Result fetch failed: ${error}`);
    }

    return response.json();
}

/**
 * 获取所有任务列表
 */
export async function getAllJobs(): Promise<JobStatus[]> {
    const response = await fetch(`${API_BASE}/jobs`);

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Jobs fetch failed: ${error}`);
    }

    const data = await response.json();
    if (Array.isArray(data)) {
        return data;
    }
    if (Array.isArray(data?.jobs)) {
        return data.jobs;
    }
    return [];
}

/**
 * Get interaction messages from a job
 */
export async function getJobMessages(jobId: string): Promise<JobMessages> {
    const response = await fetch(`${API_BASE}/messages/${jobId}`);

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Messages fetch failed: ${error}`);
    }

    return response.json();
}

/**
 * Get download URL
 */
export function getDownloadUrl(jobId: string, fileType: 'report' | 'pdf' | 'log'): string {
    return `${API_BASE}/download/${jobId}/${fileType}`;
}

/**
 * Submit user response to an agent question
 */
export async function submitResponse(jobId: string, messageId: string, response: string): Promise<void> {
    const apiResponse = await fetch(`${API_BASE}/response/${jobId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message_id: messageId, response })
    });

    if (!apiResponse.ok) {
        const error = await apiResponse.text();
        throw new Error(`Response submission failed: ${error}`);
    }
}

/**
 * Poll and wait for task completion
 */
export async function waitForCompletion(
    jobId: string,
    onProgress?: (status: JobStatus) => void,
    pollInterval = 2000
): Promise<JobResult> {
    while (true) {
        const status = await checkStatus(jobId);

        if (onProgress) {
            onProgress(status);
        }

        if (status.status === 'completed') {
            return getResult(jobId);
        }

        if (status.status === 'failed') {
            throw new Error(status.error || 'Analysis failed');
        }

        // Wait before checking again
        await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
}
