import React, { useState, useEffect } from 'react';
import { ChatPanel } from './ChatPanel';
import {
    submitAnalysis,
    checkStatus,
    getResult,
    getAllJobs,
    getJobMessages,
    getDownloadUrl,
    type AnalysisRequest,
    type JobStatus,
    type JobResult,
    type AgentMessage
} from '../lib/multiagent-api';
import type { ChatMessage } from '../types';

/**
 * Enhanced Multiagent Analysis component with integrated chat interface
 * Shows agent's real-time activity and interactions
 */
export function MultiagentAnalysisWithChat() {
    const [dataPath, setDataPath] = useState('');
    const [command, setCommand] = useState('Analyze cell types and spatial patterns in this sample');
    const [currentJobId, setCurrentJobId] = useState<string | null>(null);
    const [result, setResult] = useState<JobResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [jobsList, setJobsList] = useState<JobStatus[]>([]);

    // Chat messages - integrates agent activity into chat
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
        {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: '👋 Hello! I can help you analyze single-cell RNA-seq data.\n\nTo get started:\n1. Enter your data file path (.h5ad format)\n2. Describe the analysis you want\n3. Click "Start Analysis"\n\nI\'ll show you my progress here in the chat!',
            ts: Date.now(),
        },
    ]);

    // Load historical jobs
    useEffect(() => {
        loadJobs();
    }, []);

    // Poll for agent messages during analysis
    useEffect(() => {
        if (!currentJobId || !loading) return;

        const interval = setInterval(async () => {
            try {
                const { messages, step_messages } = await getJobMessages(currentJobId);

                // Convert agent messages to chat format
                const newChatMessages = [...messages, ...step_messages].map(msg => ({
                    id: crypto.randomUUID(),
                    role: 'assistant' as const,
                    content: formatAgentMessage(msg),
                    ts: new Date(msg.timestamp).getTime(),
                }));

                // Add new messages without duplicates
                if (newChatMessages.length > 0) {
                    setChatMessages(prev => {
                        const existingContent = new Set(prev.map(m => m.content));
                        const filtered = newChatMessages.filter(m => !existingContent.has(m.content));
                        return [...prev, ...filtered];
                    });
                }
            } catch (error) {
                console.error('Failed to fetch agent messages:', error);
            }
        }, 2000);

        return () => clearInterval(interval);
    }, [currentJobId, loading]);

    const formatAgentMessage = (msg: AgentMessage): string => {
        if (msg.type === 'step') {
            const emoji = msg.status === 'running' ? '⏳' : msg.status === 'completed' ? '✅' : '📍';
            return `${emoji} **${msg.step}**: ${msg.status}\n${msg.details || ''}`;
        } else if (msg.type === 'prompt') {
            return `❓ ${msg.content}${msg.auto_answered ? ' *(auto-answered)*' : ''}`;
        } else if (msg.type === 'confirm') {
            return `✓ ${msg.content}${msg.auto_answered ? ' *(auto-confirmed)*' : ''}`;
        } else {
            return msg.content;
        }
    };

    const loadJobs = async () => {
        try {
            const jobs = await getAllJobs();
            setJobsList(jobs);
        } catch (error: any) {
            console.error('Failed to load jobs:', error);
        }
    };

    const addChatMessage = (role: 'user' | 'assistant', content: string) => {
        setChatMessages(prev => [...prev, {
            id: crypto.randomUUID(),
            role,
            content,
            ts: Date.now(),
        }]);
    };

    const handleChatSend = async (text: string) => {
        // User sends a message
        addChatMessage('user', text);

        // Check if it looks like analysis request
        if (text.toLowerCase().includes('analyze') || text.toLowerCase().includes('data')) {
            addChatMessage('assistant', 'Please use the form below to submit your analysis. Fill in the data path and click "Start Analysis".');
        } else if (currentJobId && loading) {
            addChatMessage('assistant', `Analysis is currently running (Job ID: ${currentJobId.slice(0, 8)}...). You can see the progress updates above!`);
        } else {
            addChatMessage('assistant', 'I understand. Use the form below to configure and start your analysis.');
        }
    };

    const handleSubmit = async () => {
        if (!dataPath.trim()) {
            addChatMessage('assistant', '⚠️ Please enter a data file path before starting analysis.');
            return;
        }

        try {
            setLoading(true);

            // Notify user
            addChatMessage('user', `Start analysis: ${command}\nData: ${dataPath}`);
            addChatMessage('assistant', '🚀 Starting analysis... I\'ll keep you updated on my progress!');

            // Submit task
            const { job_id } = await submitAnalysis({
                data_path: dataPath,
                command: command,
                planner: 'llm',
                auto_mode: true
            });

            setCurrentJobId(job_id);
            addChatMessage('assistant', `✅ Analysis task submitted!\n📋 Job ID: ${job_id.slice(0, 8)}...\n\nWait for updates...`);

            // Poll for completion
            let completed = false;
            while (!completed) {
                await new Promise(resolve => setTimeout(resolve, 3000));

                const status = await checkStatus(job_id);

                if (status.status === 'completed') {
                    const finalResult = await getResult(job_id);
                    setResult(finalResult);
                    addChatMessage('assistant', `🎉 Analysis completed!\n\n${finalResult.summary || 'Results are ready!'}\n\nCheck the Results section below to download reports.`);
                    completed = true;
                    loadJobs();
                } else if (status.status === 'failed') {
                    addChatMessage('assistant', `❌ Analysis failed: ${status.error || 'Unknown error'}`);
                    completed = true;
                    loadJobs();
                }
            }
        } catch (error: any) {
            addChatMessage('assistant', `❌ Error: ${error.message}`);
            console.error('Analysis error:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleViewJob = async (jobId: string) => {
        try {
            setLoading(true);
            setCurrentJobId(jobId);
            const status = await checkStatus(jobId);

            if (status.status === 'completed') {
                const jobResult = await getResult(jobId);
                setResult(jobResult);
                addChatMessage('assistant', `📄 Loaded job ${jobId.slice(0, 8)}...\n\n${jobResult.summary || 'Results loaded successfully!'}`);
            } else {
                addChatMessage('assistant', `Job ${jobId.slice(0, 8)}... status: ${status.status}`);
                setResult(null);
            }
        } catch (error: any) {
            addChatMessage('assistant', `Failed to load job: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="h-full flex overflow-hidden">
            {/* Left: Analysis Configuration */}
            <div className="flex-1 overflow-auto p-6">
                <h2 className="text-2xl font-bold mb-6">🧬 Single-Cell Biological Data Analysis</h2>

                {/* Submit Analysis Form */}
                <div className="bg-white rounded-lg shadow-md p-6 mb-6">
                    <h3 className="text-lg font-semibold mb-4">New Analysis Task</h3>

                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Data File Path (.h5ad)
                            </label>
                            <input
                                type="text"
                                placeholder="e.g., ./data/sample.h5ad"
                                value={dataPath}
                                onChange={(e) => setDataPath(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                disabled={loading}
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Analysis Command
                            </label>
                            <textarea
                                placeholder="Describe the analysis you want to perform..."
                                value={command}
                                onChange={(e) => setCommand(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 h-24"
                                disabled={loading}
                            />
                        </div>

                        <button
                            onClick={handleSubmit}
                            disabled={loading}
                            className={`w-full py-2 px-4 rounded-md font-medium transition-colors ${loading
                                    ? 'bg-gray-400 cursor-not-allowed'
                                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                                }`}
                        >
                            {loading ? '⏳ Analyzing...' : '🚀 Start Analysis'}
                        </button>
                    </div>
                </div>

                {/* Analysis Results */}
                {result && result.status === 'completed' && (
                    <div className="bg-white rounded-lg shadow-md p-6 mb-6">
                        <h3 className="text-lg font-semibold mb-4">📊 Analysis Results</h3>

                        {result.summary && (
                            <div className="mb-6">
                                <h4 className="text-md font-semibold mb-2 text-gray-700">Summary</h4>
                                <div className="bg-gray-50 p-4 rounded-md border border-gray-200">
                                    <p className="text-gray-700 whitespace-pre-wrap">{result.summary}</p>
                                </div>
                            </div>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            {result.pdf_url && (
                                <a
                                    href={getDownloadUrl(currentJobId!, 'pdf')}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center justify-center px-4 py-3 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
                                >
                                    📄 Download PDF
                                </a>
                            )}

                            {result.report_url && (
                                <a
                                    href={getDownloadUrl(currentJobId!, 'report')}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center justify-center px-4 py-3 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
                                >
                                    📝 Download Report
                                </a>
                            )}

                            {result.log_url && (
                                <a
                                    href={getDownloadUrl(currentJobId!, 'log')}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center justify-center px-4 py-3 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
                                >
                                    📊 Download Log
                                </a>
                            )}
                        </div>
                    </div>
                )}

                {/* Job History */}
                {jobsList.length > 0 && (
                    <div className="bg-white rounded-lg shadow-md p-6">
                        <h3 className="text-lg font-semibold mb-4">📋 Job History</h3>

                        <div className="space-y-2">
                            {jobsList.slice(0, 5).map((job) => (
                                <div
                                    key={job.job_id}
                                    className="flex items-center justify-between p-3 border border-gray-200 rounded-md hover:bg-gray-50 cursor-pointer"
                                    onClick={() => handleViewJob(job.job_id)}
                                >
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="font-mono text-sm text-gray-600">
                                                {job.job_id.slice(0, 8)}...
                                            </span>
                                            <span className={`px-2 py-1 rounded text-xs font-medium ${job.status === 'completed'
                                                    ? 'bg-green-100 text-green-800'
                                                    : job.status === 'failed'
                                                        ? 'bg-red-100 text-red-800'
                                                        : job.status === 'running'
                                                            ? 'bg-blue-100 text-blue-800'
                                                            : 'bg-gray-100 text-gray-800'
                                                }`}>
                                                {job.status}
                                            </span>
                                        </div>
                                        <div className="text-xs text-gray-500 mt-1">
                                            {new Date(job.created_at).toLocaleString('en-US')}
                                        </div>
                                    </div>

                                    {job.status === 'completed' && (
                                        <button className="text-blue-600 hover:text-blue-800 text-sm font-medium">
                                            View Results →
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Right: Chat Panel - Shows Agent Activity */}
            <div className="w-96 flex-shrink-0">
                <ChatPanel
                    messages={chatMessages}
                    loading={loading}
                    onSend={handleChatSend}
                    agentName="Multiagent"
                    className="h-full"
                />
            </div>
        </div>
    );
}
