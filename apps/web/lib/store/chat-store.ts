import { create } from 'zustand'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  isStreaming?: boolean
  thinkingContent?: string
  thinkingExpanded?: boolean
}

export interface Conversation {
  id: string
  title: string
  messages: Message[]
  createdAt: Date
  updatedAt: Date
}

interface ChatState {
  conversations: Conversation[]
  activeConversationId: string | null
  isStreaming: boolean
  selectedModel: string
  selectedAgent: string
  
  // Actions
  setActiveConversation: (id: string | null) => void
  addConversation: (conversation: Conversation) => void
  deleteConversation: (id: string) => void
  addMessage: (conversationId: string, message: Message) => void
  updateMessage: (conversationId: string, messageId: string, updates: Partial<Message>) => void
  setIsStreaming: (streaming: boolean) => void
  setSelectedModel: (model: string) => void
  setSelectedAgent: (agent: string) => void
  toggleThinkingExpanded: (conversationId: string, messageId: string) => void
}

export const useChatStore = create<ChatState>((set) => ({
  conversations: [],
  activeConversationId: null,
  isStreaming: false,
  selectedModel: '默认大模型',
  selectedAgent: '虾灵感',
  
  setActiveConversation: (id) => set({ activeConversationId: id }),
  
  addConversation: (conversation) =>
    set((state) => ({
      conversations: [conversation, ...state.conversations],
      activeConversationId: conversation.id,
    })),
    
  deleteConversation: (id) =>
    set((state) => ({
      conversations: state.conversations.filter((c) => c.id !== id),
      activeConversationId: state.activeConversationId === id 
        ? state.conversations[0]?.id || null 
        : state.activeConversationId,
    })),
    
  addMessage: (conversationId, message) =>
    set((state) => ({
      conversations: state.conversations.map((conv) =>
        conv.id === conversationId
          ? { ...conv, messages: [...conv.messages, message], updatedAt: new Date() }
          : conv
      ),
    })),
    
  updateMessage: (conversationId, messageId, updates) =>
    set((state) => ({
      conversations: state.conversations.map((conv) =>
        conv.id === conversationId
          ? {
              ...conv,
              messages: conv.messages.map((msg) =>
                msg.id === messageId ? { ...msg, ...updates } : msg
              ),
            }
          : conv
      ),
    })),
    
  setIsStreaming: (streaming) => set({ isStreaming: streaming }),
  
  setSelectedModel: (model) => set({ selectedModel: model }),
  
  setSelectedAgent: (agent) => set({ selectedAgent: agent }),
  
  toggleThinkingExpanded: (conversationId, messageId) =>
    set((state) => ({
      conversations: state.conversations.map((conv) =>
        conv.id === conversationId
          ? {
              ...conv,
              messages: conv.messages.map((msg) =>
                msg.id === messageId
                  ? { ...msg, thinkingExpanded: !msg.thinkingExpanded }
                  : msg
              ),
            }
          : conv
      ),
    })),
}))
