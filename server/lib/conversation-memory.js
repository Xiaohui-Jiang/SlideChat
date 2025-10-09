import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const DEFAULT_CONFIG = {
    maxContextTokens: 2800,
    maxRecentMessages: 12,
    summaryTriggerMessages: 18,
    summaryRetainRecentMessages: 8,
    estimateTokenFactor: 4
};

function estimateTokens(text = '', factor = DEFAULT_CONFIG.estimateTokenFactor) {
    if (!text) return 0;
    return Math.ceil(text.length / factor);
}

export class ConversationMemoryStore {
    constructor({
        storagePath = path.join(process.cwd(), 'data', 'memory'),
        config = {},
        summarizer = null
    } = {}) {
        this.storagePath = storagePath;
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.summarizer = summarizer;
        this.conversations = new Map();

        fs.mkdirSync(this.storagePath, { recursive: true });
        this._loadExistingConversations();
    }

    _conversationFilePath(conversationId) {
        return path.join(this.storagePath, `${conversationId}.json`);
    }

    _loadExistingConversations() {
        const files = fs.readdirSync(this.storagePath).filter((file) => file.endsWith('.json'));
        for (const file of files) {
            try {
                const data = fs.readFileSync(path.join(this.storagePath, file), 'utf-8');
                const conversation = JSON.parse(data);
                if (conversation && conversation.id) {
                    this.conversations.set(conversation.id, conversation);
                }
            } catch (error) {
                console.warn(`⚠️ Failed to load conversation file ${file}:`, error.message);
            }
        }
    }

    _persistConversation(conversationId) {
        const conversation = this.conversations.get(conversationId);
        if (!conversation) return;

        try {
            fs.writeFileSync(
                this._conversationFilePath(conversationId),
                JSON.stringify(conversation, null, 2),
                'utf-8'
            );
        } catch (error) {
            console.error(`Failed to persist conversation ${conversationId}:`, error);
        }
    }

    listConversations() {
        return Array.from(this.conversations.values()).map(({ messages, ...rest }) => ({
            ...rest,
            messageCount: messages?.length || 0
        }));
    }

    getConversation(conversationId) {
        return this.conversations.get(conversationId) || null;
    }

    createConversation({ userId = 'anonymous', metadata = {} } = {}) {
        const conversationId = crypto.randomUUID();
        const now = Date.now();
        const conversation = {
            id: conversationId,
            userId,
            metadata,
            createdAt: now,
            updatedAt: now,
            summary: '',
            summaryUpdatedAt: null,
            lastSummarizedMessageIndex: 0,
            messages: []
        };

        this.conversations.set(conversationId, conversation);
        this._persistConversation(conversationId);

        return conversation;
    }

    appendMessage(conversationId, { role, content, name = null, metadata = {} }) {
        const conversation = this.conversations.get(conversationId);
        if (!conversation) {
            throw new Error(`Conversation ${conversationId} not found`);
        }

        const message = {
            id: crypto.randomUUID(),
            role,
            content,
            name,
            metadata,
            createdAt: Date.now(),
            tokenEstimate: estimateTokens(content, this.config.estimateTokenFactor)
        };

        conversation.messages.push(message);
        conversation.updatedAt = Date.now();

        this._persistConversation(conversationId);
        return message;
    }

    getContext(conversationId, { maxTokens = this.config.maxContextTokens } = {}) {
        const conversation = this.conversations.get(conversationId);
        if (!conversation) {
            throw new Error(`Conversation ${conversationId} not found`);
        }

        const contextMessages = [];
        let tokenBudget = maxTokens;

        for (let i = conversation.messages.length - 1; i >= 0; i -= 1) {
            const message = conversation.messages[i];
            const estimatedTokens = message.tokenEstimate ?? estimateTokens(message.content);

            if (contextMessages.length >= this.config.maxRecentMessages) {
                break;
            }

            if (estimatedTokens > tokenBudget && contextMessages.length > 0) {
                break;
            }

            tokenBudget -= estimatedTokens;
            contextMessages.unshift(message);
        }

        return {
            summary: conversation.summary,
            messages: contextMessages
        };
    }

    async maybeSummarize(conversationId) {
        if (!this.summarizer) return null;

        const conversation = this.conversations.get(conversationId);
        if (!conversation) return null;

        const { messages } = conversation;
        if (messages.length < this.config.summaryTriggerMessages) {
            return null;
        }

        const cutoffIndex = Math.max(
            messages.length - this.config.summaryRetainRecentMessages,
            conversation.lastSummarizedMessageIndex
        );

        if (cutoffIndex <= conversation.lastSummarizedMessageIndex) {
            return null;
        }

        const messagesToSummarize = messages.slice(0, cutoffIndex);
        if (messagesToSummarize.length === 0) {
            return null;
        }

        try {
            const summaryText = await this.summarizer({
                existingSummary: conversation.summary,
                messages: messagesToSummarize
            });

            conversation.summary = summaryText;
            conversation.summaryUpdatedAt = Date.now();
            conversation.lastSummarizedMessageIndex = cutoffIndex;
            this._persistConversation(conversationId);

            return summaryText;
        } catch (error) {
            console.error(`Failed to summarize conversation ${conversationId}:`, error);
            return null;
        }
    }
}

export default ConversationMemoryStore;
