import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface CustomModel {
  /** 与输入框发送的 model ref 一致；本地添加为 custom-* */
  ref: string
  id: string
  name: string
  provider: string
  baseUrl: string
  apiKey: string
  description: string
  createdAt: string
}

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
  /** 输入框当前选择的模型 ref（与 /api/openclaw/models 的 chatOptions.ref 一致） */
  selectedModelRef: string
  selectedAgent: string
  customModels: CustomModel[]

  setActiveConversation: (id: string | null) => void
  addConversation: (conversation: Conversation) => void
  deleteConversation: (id: string) => void
  addMessage: (conversationId: string, message: Message) => void
  updateMessage: (conversationId: string, messageId: string, updates: Partial<Message>) => void
  setIsStreaming: (streaming: boolean) => void
  setSelectedModelRef: (ref: string) => void
  setSelectedAgent: (agent: string) => void
  toggleThinkingExpanded: (conversationId: string, messageId: string) => void
  addCustomModel: (model: CustomModel) => void
  deleteCustomModel: (id: string) => void
}

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      conversations: [],
      activeConversationId: null,
      isStreaming: false,
      selectedModelRef: 'default',
      selectedAgent: '虾灵感',
      customModels: [],

      setActiveConversation: (id) => set({ activeConversationId: id }),

      addConversation: (conversation) =>
        set((state) => ({
          conversations: [conversation, ...state.conversations],
          activeConversationId: conversation.id,
        })),

      deleteConversation: (id) =>
        set((state) => ({
          conversations: state.conversations.filter((c) => c.id !== id),
          activeConversationId:
            state.activeConversationId === id ? state.conversations[0]?.id || null : state.activeConversationId,
        })),

      addMessage: (conversationId, message) =>
        set((state) => ({
          conversations: state.conversations.map((conv) =>
            conv.id === conversationId
              ? { ...conv, messages: [...conv.messages, message], updatedAt: new Date() }
              : conv,
          ),
        })),

      updateMessage: (conversationId, messageId, updates) =>
        set((state) => ({
          conversations: state.conversations.map((conv) =>
            conv.id === conversationId
              ? {
                  ...conv,
                  messages: conv.messages.map((msg) =>
                    msg.id === messageId ? { ...msg, ...updates } : msg,
                  ),
                }
              : conv,
          ),
        })),

      setIsStreaming: (streaming) => set({ isStreaming: streaming }),

      setSelectedModelRef: (ref) => set({ selectedModelRef: ref }),

      setSelectedAgent: (agent) => set({ selectedAgent: agent }),

      toggleThinkingExpanded: (conversationId, messageId) =>
        set((state) => ({
          conversations: state.conversations.map((conv) =>
            conv.id === conversationId
              ? {
                  ...conv,
                  messages: conv.messages.map((msg) =>
                    msg.id === messageId ? { ...msg, thinkingExpanded: !msg.thinkingExpanded } : msg,
                  ),
                }
              : conv,
          ),
        })),

      addCustomModel: (model) =>
        set((state) => ({ customModels: [...state.customModels, model] })),

      deleteCustomModel: (id) =>
        set((state) => ({ customModels: state.customModels.filter((m) => m.id !== id) })),
    }),
    {
      name: 'xclaw-chat-store',
      partialize: (state) => ({
        selectedModelRef: state.selectedModelRef,
        selectedAgent: state.selectedAgent,
        customModels: state.customModels,
      }),
    },
  ),
)
