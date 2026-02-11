import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SessionInfo } from '@/lib/types';
import * as api from '@/lib/api';

interface SessionStore {
  // State
  sessions: SessionInfo[];
  selectedSessionId: string | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchSessions: () => Promise<void>;
  registerSession: (sessionId: string) => Promise<SessionInfo>;
  deleteSession: (sessionId: string) => Promise<void>;
  selectSession: (sessionId: string | null) => void;
  refreshSessions: () => Promise<void>;
}

export const useSessionStore = create<SessionStore>()(
  persist(
    (set, get) => ({
      // Initial state
      sessions: [],
      selectedSessionId: null,
      isLoading: false,
      error: null,

      // Fetch all sessions from API
      fetchSessions: async () => {
        set({ isLoading: true, error: null });
        try {
          const sessions = await api.listSessions();
          set({ sessions, isLoading: false });
        } catch (error: any) {
          set({ error: error.message, isLoading: false });
          console.error('Failed to fetch sessions:', error);
        }
      },

      // Register a new session
      registerSession: async (sessionId: string) => {
        set({ isLoading: true, error: null });
        try {
          const session = await api.registerSession(sessionId);
          const sessions = [...get().sessions, session];
          set({ sessions, selectedSessionId: sessionId, isLoading: false });
          return session;
        } catch (error: any) {
          set({ error: error.message, isLoading: false });
          console.error('Failed to register session:', error);
          throw error;
        }
      },

      // Delete a session
      deleteSession: async (sessionId: string) => {
        set({ isLoading: true, error: null });
        try {
          await api.deleteSession(sessionId);
          const sessions = get().sessions.filter(s => s.sessionId !== sessionId);
          const selectedSessionId = get().selectedSessionId === sessionId ? null : get().selectedSessionId;
          set({ sessions, selectedSessionId, isLoading: false });
        } catch (error: any) {
          set({ error: error.message, isLoading: false });
          console.error('Failed to delete session:', error);
          throw error;
        }
      },

      // Select a session for test execution
      selectSession: (sessionId: string | null) => {
        set({ selectedSessionId: sessionId });
      },

      // Refresh sessions (refetch from API)
      refreshSessions: async () => {
        await get().fetchSessions();
      },
    }),
    {
      name: 'session-store',
      partialize: (state) => ({
        selectedSessionId: state.selectedSessionId,
      }),
    }
  )
);
