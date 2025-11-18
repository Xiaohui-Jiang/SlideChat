import React, { useState, useEffect, useRef } from 'react';
import { ChatPanel } from './ChatPanel';
import {
    submitAnalysis,
    checkStatus,
    getResult,
    getAllJobs,
    getJobMessages,
    submitResponse,
    type AnalysisRequest,
    type JobStatus,
    type JobResult,
    type AgentMessage
} from '../lib/multiagent-api';
import type { ChatMessage } from '../types';

/**
 * Fully chat-integrated multiagent analysis interface
 * All interactions happen through the chat - no separate forms
 */

interface ChatMultiagentProps {
    onResultUpdate?: (result: JobResult | null) => void;
}

// Helper to generate sequential job names
function generateJobName(existingCount: number): string {
    return `Job ${existingCount + 1}`;
}

export function ChatMultiagent({ onResultUpdate }: ChatMultiagentProps = {}) {
    const [currentJobId, setCurrentJobId] = useState<string | null>(null);
    const [currentJobName, setCurrentJobName] = useState<string | null>(null);
    const [result, setResult] = useState<JobResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [jobsList, setJobsList] = useState<JobStatus[]>([]);
    const [awaitingJobId, setAwaitingJobId] = useState(false);

    // Conversation state - simplified to match agent.py flow
    type ConversationState = 'idle' | 'awaiting_path' | 'awaiting_command' | 'running' | 'awaiting_response';
    const [conversationState, setConversationState] = useState<ConversationState>('idle');
    const [pendingDataPath, setPendingDataPath] = useState('');
    const [pendingQuestion, setPendingQuestion] = useState<AgentMessage | null>(null);

    // Chat messages
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
        {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: 'Hello! I\'m your Biological Analysis Assistant. How can I help you today?',
            ts: Date.now(),
        },
    ]);

    const seenMessageIdsRef = useRef<Set<string>>(new Set());

    // Session ID for chat memory - persistent across page reloads
    const [sessionId] = useState(() => {
        const stored = localStorage.getItem('chat_session_id');
        if (stored) return stored;
        const newId = crypto.randomUUID();
        localStorage.setItem('chat_session_id', newId);
        return newId;
    });

    // Job name mapping (jobId -> friendly name)
    const [jobNames, setJobNames] = useState<Record<string, string>>(() => {
        const stored = localStorage.getItem('job_names');
        return stored ? JSON.parse(stored) : {};
    });

    // Save job names to localStorage
    useEffect(() => {
        localStorage.setItem('job_names', JSON.stringify(jobNames));
    }, [jobNames]);

    // Load historical jobs
    useEffect(() => {
        loadJobs();
    }, []);

    // Notify parent component when result changes
    useEffect(() => {
        if (onResultUpdate) {
            onResultUpdate(result);
        }
    }, [result, onResultUpdate]);

    // Poll for agent messages during analysis or while awaiting user response
    useEffect(() => {
        const shouldPoll = Boolean(currentJobId && conversationState !== 'idle');
        console.log('[ChatMultiagent] useEffect triggered:', {
            currentJobId,
            loading,
            conversationState,
            shouldPoll
        });

        if (!currentJobId) {
            console.log('[ChatMultiagent] Not polling - no currentJobId');
            return;
        }

        if (!shouldPoll) {
            console.log('[ChatMultiagent] Not polling - no active run or pending response');
            return;
        }

        console.log('[ChatMultiagent] Starting polling for job:', currentJobId);

        const pollMessages = async () => {
            try {
                console.log('[ChatMultiagent] Polling...');
                const result = await getJobMessages(currentJobId);
                console.log('[ChatMultiagent] Raw API response:', JSON.stringify(result, null, 2));

                const { messages, step_messages, pending } = result;
                const allMessages = [...messages, ...step_messages];

                // Debug logging
                console.log('[ChatMultiagent] Parsed:', {
                    messageCount: messages.length,
                    stepCount: step_messages.length,
                    totalMessages: allMessages.length,
                    seenMessages: seenMessageIdsRef.current.size,
                    hasPending: !!pending,
                    pendingType: pending?.type,
                    pendingRequiresResponse: pending?.requires_response
                });

                const newMessages = allMessages.filter((msg) => {
                    const key = getMessageKey(msg);
                    if (!key) {
                        return true;
                    }
                    if (seenMessageIdsRef.current.has(key)) {
                        return false;
                    }
                    seenMessageIdsRef.current.add(key);
                    return true;
                });

                if (newMessages.length > 0) {
                    console.log('[ChatMultiagent] Adding new messages:', newMessages.length, newMessages);
                    newMessages.forEach(msg => {
                        const formatted = formatAgentMessage(msg);
                        console.log('[ChatMultiagent] Formatted message:', formatted);
                        addChatMessage('assistant', formatted);
                    });
                }

                // Check for pending questions in interactive mode (separate from regular messages)
                if (pending && pending.requires_response && !pending.response) {
                    console.log('[ChatMultiagent] Found unanswered pending question:', pending);
                    // 只在还没显示这个问题时才显示
                    if (!pendingQuestion || pendingQuestion.message_id !== pending.message_id) {
                        console.log('[ChatMultiagent] Showing new pending question');
                        setPendingQuestion(pending);
                        if (conversationState !== 'awaiting_response') {
                            setConversationState('awaiting_response');
                        }
                        if (loading) {
                            console.log('[ChatMultiagent] Pausing loading indicator for user response');
                            setLoading(false);
                        }

                        const pendingKey = getMessageKey(pending);
                        if (!pendingKey || !seenMessageIdsRef.current.has(pendingKey)) {
                            if (pendingKey) {
                                seenMessageIdsRef.current.add(pendingKey);
                            }
                            addChatMessage('assistant', pending.content);
                        }
                    }
                } else if (pendingQuestion && (!pending || pending.response)) {
                    // Question was answered, resume running
                    console.log('[ChatMultiagent] Question answered, resuming');
                    setPendingQuestion(null);
                    if (conversationState === 'awaiting_response') {
                        setConversationState('running');
                    }
                    if (!loading) {
                        console.log('[ChatMultiagent] Resuming loading indicator after response handled');
                        setLoading(true);
                    }
                }

                // Check if job completed
                const status = await checkStatus(currentJobId);
                console.log('[ChatMultiagent] Job status:', status.status);
                if (status.status === 'completed') {
                    setLoading(false);
                    setConversationState('idle');
                    const jobResult = await getResult(currentJobId);
                    setResult(jobResult);

                    // Display comprehensive results
                    const resultsMessage = formatCompletionResults(currentJobId, jobResult);
                    addChatMessage('assistant', resultsMessage);
                } else if (status.status === 'failed') {
                    setLoading(false);
                    setConversationState('idle');
                    addChatMessage('assistant', `Analysis failed: ${status.error || 'Unknown error'}`);
                }
            } catch (error) {
                console.error('Failed to fetch agent messages:', error);
            }
        };

        // Run immediately to avoid waiting for the first interval tick
        void pollMessages();
        const interval = setInterval(pollMessages, 2000);

        return () => clearInterval(interval as unknown as number);
    }, [currentJobId, loading, conversationState, pendingQuestion]);

    const formatAgentMessage = (msg: AgentMessage): string => {
        let content = msg.content;
        
        // Handle JSON blocks with long paths - extract and format key info
        if (content.includes('{') && content.includes('}')) {
            // Pattern: JSON with file_path that's too long (>40 chars)
            content = content.replace(/"file_path":\s*"([^"]{40,})"/g, (match, path) => {
                const parts = path.split('/');
                const filename = parts[parts.length - 1];
                // If filename itself is too long (>50 chars), truncate it
                if (filename.length > 50) {
                    const ext = filename.split('.').pop();
                    const nameWithoutExt = filename.substring(0, filename.lastIndexOf('.'));
                    const truncated = nameWithoutExt.substring(0, 30) + '...' + (ext ? '.' + ext : '');
                    return `"file_path":\n    ".../${truncated}"`;
                }
                return `"file_path":\n    ".../${filename}"`;
            });
            
            // Pattern: Other long paths in JSON
            content = content.replace(/"([^"]+)":\s*"(\/[^"]{50,})"/g, (match, key, path) => {
                if (path.startsWith('/')) {
                    const parts = path.split('/');
                    const filename = parts[parts.length - 1];
                    if (filename.length > 50) {
                        const ext = filename.split('.').pop();
                        const nameWithoutExt = filename.substring(0, filename.lastIndexOf('.'));
                        const truncated = nameWithoutExt.substring(0, 30) + '...' + (ext ? '.' + ext : '');
                        return `"${key}":\n    ".../${truncated}"`;
                    }
                    return `"${key}":\n    ".../${filename}"`;
                }
                return match;
            });
        }
        
        // Pattern 1: Any string longer than 60 chars should be word-wrapped
        // Split long continuous strings (no spaces) into chunks
        content = content.replace(/[^\s]{70,}/g, (match) => {
            // Skip if it's inside quotes (already handled above)
            if (match.includes('"')) return match;
            
            // Check if it's a path
            if (match.includes('/')) {
                const parts = match.split('/');
                const filename = parts[parts.length - 1];
                return `.../${filename}`;
            }
            
            // Otherwise, insert word breaks every 60 chars
            return match.match(/.{1,60}/g)?.join('\n') || match;
        });
        
        // Pattern 2: "saved to /very/long/path" -> show just filename
        content = content.replace(/saved to\s+(\/[^\s]+\/([^\/\s]+\.(h5|h5ad|txt|pdf|json|csv)))/gi, 
            (match, fullPath, filename) => {
                if (fullPath.length > 60) {
                    return `saved to .../${filename}`;
                }
                return match;
            });
        
        // Pattern 3: Shorten only extremely long adata_id values (>60 chars)
        content = content.replace(/"adata_id":\s*"([^"]{60,})"/g, (match, id) => {
            const parts = id.split('_');
            if (parts.length > 3) {
                return `"adata_id": "...${parts.slice(-2).join('_')}"`;
            }
            return match;
        });
        
        if (msg.type === 'display') {
            return content;
        } else if (msg.type === 'step') {
            return `[${msg.step}] ${content}`;
        } else if (msg.type === 'prompt' || msg.type === 'confirm') {
            return content;
        }
        return content;
    };

    const getMessageKey = (msg: AgentMessage): string | null => {
        if (msg.message_id) return msg.message_id;
        if (msg.timestamp) return `${msg.type}-${msg.timestamp}`;
        if (msg.content) return `${msg.type}-${msg.content}`;
        return null;
    };

    const formatCompletionResults = (jobId: string, jobResult: JobResult): string => {
        const jobName = jobNames[jobId] || jobId.substring(0, 8);
        const downloadLinks: string[] = [];

        if (jobResult.report_url) {
            downloadLinks.push(`• [Text Report](${jobResult.report_url})`);
        }
        if (jobResult.pdf_url) {
            downloadLinks.push(`• [PDF Report](${jobResult.pdf_url})`);
        }
        if (jobResult.log_url) {
            downloadLinks.push(`• [Analysis Log](${jobResult.log_url})`);
        }

        let message = `**Analysis Complete**\n\nJob: **${jobName}**\n\n`;

        if (jobResult.summary) {
            // Clean up summary - remove long file paths and format nicely
            let cleanSummary = jobResult.summary;
            
            // Extract key statistics
            const cellMatch = cleanSummary.match(/(\d+,?\d*)\s+cells/i);
            const typeMatch = cleanSummary.match(/(\d+)\s+cell\s+types/i);
            const popMatches = cleanSummary.match(/([A-Za-z\s\/]+):\s+(\d+)\s+\((\d+\.?\d*)%\)/g);
            
            // Build formatted summary
            let formattedSummary = '';
            
            if (cellMatch && typeMatch) {
                formattedSummary += `**Key Results:**\n`;
                formattedSummary += `• Total cells: **${cellMatch[1]}**\n`;
                formattedSummary += `• Cell types: **${typeMatch[1]}**\n\n`;
            }
            
            if (popMatches && popMatches.length > 0) {
                formattedSummary += `**Top Populations:**\n`;
                popMatches.slice(0, 3).forEach(match => {
                    const parts = match.match(/([A-Za-z\s\/]+):\s+(\d+)\s+\((\d+\.?\d*)%\)/);
                    if (parts) {
                        formattedSummary += `• ${parts[1].trim()}: ${parts[2]} (${parts[3]}%)\n`;
                    }
                });
                formattedSummary += '\n';
            }
            
            // Add note about saved data without showing full path
            if (cleanSummary.includes('saved to')) {
                formattedSummary += `Data saved successfully.\n\n`;
            }
            
            message += formattedSummary || `${cleanSummary}\n\n`;
        }

        if (downloadLinks.length > 0) {
            message += `**Download Results:**\n${downloadLinks.join('\n')}\n\n`;
        }

        message += 'Ask me questions about this analysis, or type "start" to begin a new one.';

        return message;
    };

    const loadJobs = async (): Promise<JobStatus[]> => {
        try {
            const jobs = await getAllJobs();
            setJobsList(jobs);
            return jobs;
        } catch (error: any) {
            console.error('Failed to load jobs:', error);
            return [];
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

    const handleSendMessage = async (message: string) => {
        const trimmed = message.trim();
        if (!trimmed) return;

        // Add user message
        addChatMessage('user', trimmed);

        // Parse message
        const lowerMessage = trimmed.toLowerCase();

        // Store current state for status command (before early returns)
        const currentState = conversationState;

        // Handle conversation flow
        if (conversationState === 'awaiting_path') {
            // Check for special commands first
            if (lowerMessage === 'example') {
                const examplePath = '/Users/jiachengsang/Desktop/Biological_agent/slidechat/langchain_multiagent_forfront/20k_NSCLC_DTC_3p_nextgem_intron_donor_1_count_sample_feature_bc_matrix.h5';
                setPendingDataPath(examplePath);
                setConversationState('awaiting_command');
                addChatMessage('assistant', 'Using example dataset. What analysis would you like me to perform?');
                return;
            }
            // User provided data path
            setPendingDataPath(trimmed);
            setConversationState('awaiting_command');
            addChatMessage('assistant', 'What analysis would you like me to perform?');
            return;
        }

        if (conversationState === 'awaiting_command') {
            // User provided command - start analysis in interactive mode (default)
            await startAnalysis(pendingDataPath, trimmed);
            return;
        }

        if (conversationState === 'awaiting_response') {
            // 用户正在回答 Agent 的问题
            if (pendingQuestion) {
                try {
                    await submitResponse(currentJobId!, pendingQuestion.message_id!, trimmed);
                    // 不显示额外确认消息，让 Agent 自己显示
                    setPendingQuestion(null);
                    setConversationState('running');
                    if (!loading) {
                        setLoading(true);
                    }
                } catch (error: any) {
                    addChatMessage('assistant', `Error: ${error.message}`);
                }
            }
            return;
        }

        // Parse commands in idle/running state
        if (lowerMessage === 'start' || lowerMessage === 'begin' || lowerMessage === 'new analysis') {
            setConversationState('awaiting_path');
            addChatMessage('assistant',
                'Please provide the full path to your data file (.h5 format), or type "example" to use demo dataset:'
            );
        } else if (lowerMessage.startsWith('result ')) {
            const jobId = trimmed.substring(7).trim();
            await handleGetResult(jobId);
        } else if (lowerMessage.startsWith('use job ') || lowerMessage.startsWith('attach ')) {
            const parts = trimmed.split(/\s+/);
            const jobId = parts[parts.length - 1];
            await attachToJob(jobId);
        } else if (lowerMessage === 'help' || lowerMessage === '?' || lowerMessage === 'commands') {
            addChatMessage('assistant',
                '**Available Commands:**\n\n' +
                '• `start` - Begin a new analysis\n' +
                '• `example` - Use example dataset (when prompted for path)\n' +
                '• `result <job_id>` - Get results for a specific job\n' +
                '• `use job <job_id>` - Attach to a running job\n' +
                '• `help` - Show this help message\n' +
                '• `status` - Show current status\n' +
                '• `cancel` - Cancel current operation\n\n' +
                'During analysis, answer questions when prompted.'
            );
        } else if (lowerMessage === 'status') {
            let statusText: string;
            switch (currentState) {
                case 'idle':
                    statusText = 'Ready to start a new analysis';
                    break;
                case 'awaiting_path':
                    statusText = 'Waiting for data file path';
                    break;
                case 'awaiting_command':
                    statusText = 'Waiting for analysis command';
                    break;
                case 'running':
                    statusText = 'Analysis in progress';
                    break;
                case 'awaiting_response':
                    statusText = 'Waiting for your response';
                    break;
            }

            const jobInfo = currentJobId && currentJobName 
                ? `\n**Active Job:** ${currentJobName}` 
                : '';

            addChatMessage('assistant',
                `**Current Status:** ${statusText}${jobInfo}`
            );
        } else if (lowerMessage === 'cancel') {
            setConversationState('idle');
            setPendingDataPath('');
            addChatMessage('assistant', 'Cancelled. Type "start" to begin a new analysis.');
        } else {
            // Unknown command - use GPT for general conversation
            try {
                setLoading(true);
                const { simpleChat } = await import('../lib/api');
                
                // Include current job info if available
                const jobInfo = currentJobId && currentJobName 
                    ? { jobId: currentJobId, jobName: currentJobName }
                    : undefined;
                
                const response = await simpleChat(trimmed, sessionId, jobInfo);
                addChatMessage('assistant', response);
            } catch (error: any) {
                console.error('Chat error:', error);
                addChatMessage('assistant',
                    'I didn\'t understand that. Type "help" for available commands or "start" to begin an analysis.'
                );
            } finally {
                setLoading(false);
            }
        }
    };

    const findLatestActiveJob = (jobs: JobStatus[]): JobStatus | undefined => {
        if (!jobs.length) return undefined;
        const sorted = [...jobs].sort((a, b) => {
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });
        return sorted.find(job => job.status === 'running' || job.status === 'pending') ?? sorted[0];
    };

    // Poll backend job list if job_id was missing from submission response
    useEffect(() => {
        console.log('[ChatMultiagent] Awaiting jobId effect:', {
            awaitingJobId,
            currentJobId,
            conversationState
        });
        if (!awaitingJobId || currentJobId || conversationState === 'idle') {
            return;
        }

        let cancelled = false;
        let attempts = 0;

        const pollForJobId = async () => {
            if (cancelled) return;
            attempts += 1;

            try {
                const jobs = await getAllJobs();
                console.log('[ChatMultiagent] Job list while awaiting job_id:', jobs);
                setJobsList(jobs);
                const latest = findLatestActiveJob(jobs);
                if (latest) {
                    console.log('[ChatMultiagent] Detected job from job list:', latest.job_id);
                    setCurrentJobId(latest.job_id);
                    
                    // Generate and store job name if not exists
                    if (!jobNames[latest.job_id]) {
                        const name = generateJobName(Object.keys(jobNames).length);
                        setJobNames(prev => ({ ...prev, [latest.job_id]: name }));
                        setCurrentJobName(name);
                    }
                    
                    setAwaitingJobId(false);
                    return;
                }
            } catch (error) {
                console.error('[ChatMultiagent] Failed to fetch jobs while awaiting job_id:', error);
            }

            if (attempts >= 10) {
                console.warn('[ChatMultiagent] Failed to detect job_id after multiple attempts');
                setAwaitingJobId(false);
                setLoading(false);
                setConversationState('idle');
                addChatMessage('assistant', 'Failed to detect the analysis job. Please try again in a moment.');
                return;
            }

            setTimeout(pollForJobId, 1000);
        };

        pollForJobId();

        return () => {
            cancelled = true;
        };
    }, [awaitingJobId, currentJobId, conversationState]);

    const startAnalysis = async (dataPath: string, command: string) => {
        console.log('[ChatMultiagent] startAnalysis called:', { dataPath, command });

        try {
            console.log('[ChatMultiagent] setLoading(true) called');
            setLoading(true);

            setConversationState('running');
            seenMessageIdsRef.current.clear();
            setPendingQuestion(null);
            setResult(null);

            addChatMessage('assistant', `Received command: ${command}`);

            const request: AnalysisRequest = {
                data_path: dataPath,
                command: command,
                planner: 'llm',
                auto_mode: false,  // Interactive mode
                session_id: sessionId,  // Link to chat session
            };

            console.log('[ChatMultiagent] Submitting analysis request...', request);

            try {
                const result = await submitAnalysis(request);
                console.log('[ChatMultiagent] submitAnalysis returned:', result);

                let job_id = result.job_id;
                console.log('[ChatMultiagent] Extracted job_id:', job_id);

                if (job_id) {
                    setCurrentJobId(job_id);
                    setAwaitingJobId(false);
                    console.log('[ChatMultiagent] setCurrentJobId called with:', job_id);
                    
                    // Generate and store friendly job name
                    const jobName = generateJobName(Object.keys(jobNames).length);
                    setJobNames(prev => ({ ...prev, [job_id]: jobName }));
                    setCurrentJobName(jobName);
                    
                    addChatMessage('assistant', `Analysis started: **${jobName}**\n\nI'll update you as the analysis progresses. This may take a few minutes.`);
                } else {
                    console.warn('[ChatMultiagent] No job_id in response, will poll job list');
                    setAwaitingJobId(true);
                    addChatMessage('assistant', 'Job submitted. Detecting job status...');
                }

                await loadJobs();
            } catch (submitError: any) {
                console.error('[ChatMultiagent] submitAnalysis error:', submitError);
                throw submitError;
            }
        } catch (error: any) {
            console.error('[ChatMultiagent] startAnalysis error:', error);
            setLoading(false);
            setConversationState('idle');
            addChatMessage('assistant', `Failed to start analysis: ${error.message}`);
        }
    };

    const handleGetResult = async (jobId: string) => {
        try {
            const jobResult = await getResult(jobId);

            if (jobResult.status === 'completed') {
                const resultsMessage = formatCompletionResults(jobId, jobResult);
                addChatMessage('assistant', resultsMessage);
            } else {
                addChatMessage('assistant',
                    `Job \`${jobId.substring(0, 8)}...\` is currently **${jobResult.status}**. Please wait for it to complete.`
                );
            }
        } catch (error: any) {
            addChatMessage('assistant', `Failed to get result: ${error.message}`);
        }
    };

    const attachToJob = async (jobId: string) => {
        if (!jobId) {
            addChatMessage('assistant', 'Please provide a job ID to attach.');
            return;
        }

        try {
            console.log('[ChatMultiagent] attachToJob called with:', jobId);

            setLoading(true);
            console.log('[ChatMultiagent] setLoading(true) - should start polling');

            setCurrentJobId(jobId);
            console.log('[ChatMultiagent] setCurrentJobId:', jobId);

            setConversationState('running');
            seenMessageIdsRef.current.clear();

            addChatMessage('assistant', `Attached to job ${jobId.substring(0, 8)}...`);

            // Fetch immediate status to give feedback
            const status = await checkStatus(jobId);
            console.log('[ChatMultiagent] Job status:', status);

            if (status.status === 'completed') {
                const jobResult = await getResult(jobId);
                setResult(jobResult);
                addChatMessage('assistant', `Job ${jobId.substring(0, 8)}... already completed.`);
                setConversationState('idle');
                setLoading(false);
            } else {
                console.log('[ChatMultiagent] Job is', status.status, '- polling should start');
            }
        } catch (error: any) {
            console.error('[ChatMultiagent] attachToJob error:', error);
            addChatMessage('assistant', `Failed to attach to job: ${error.message}`);
            setLoading(false);
        }
    };

    return (
        <div className="h-full flex flex-col bg-gradient-to-br from-purple-50 to-indigo-50">
            {/* Header */}
            <div className="bg-white shadow-sm border-b border-gray-200 p-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-lg flex items-center justify-center text-white font-bold text-lg">
                            AI
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-gray-800">Analysis Chat</h2>
                            <p className="text-sm text-gray-500">
                                {conversationState === 'idle' && 'Ready'}
                                {conversationState === 'awaiting_path' && 'Waiting for file path'}
                                {conversationState === 'awaiting_command' && 'Waiting for command'}
                                {conversationState === 'running' && !pendingQuestion && 'Running'}
                                {conversationState === 'awaiting_response' && pendingQuestion && 'Waiting for response'}
                            </p>
                        </div>
                    </div>

                    {/* Status indicators */}
                    {currentJobId && (
                        <div className="flex items-center space-x-2 text-sm">
                            <span className="text-gray-600">Active Job:</span>
                            <code className="text-xs bg-indigo-100 text-indigo-800 px-2 py-1 rounded">
                                {currentJobId.substring(0, 8)}...
                            </code>
                        </div>
                    )}
                </div>
            </div>

            {/* Chat Interface - Full Width */}
            <div className="flex-1 flex flex-col min-h-0 p-4">
                <ChatPanel
                    messages={chatMessages}
                    onSend={handleSendMessage}
                    loading={loading}
                    agentName="Analysis Assistant"
                />
            </div>

            {/* Quick Actions Footer */}
            <div className="bg-white border-t border-gray-200 p-2">
                <div className="flex justify-center">
                    <button
                        onClick={() => handleSendMessage('start')}
                        disabled={loading || conversationState !== 'idle'}
                        className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                    >
                        Start Analysis
                    </button>
                </div>
            </div>
        </div>
    );
}
