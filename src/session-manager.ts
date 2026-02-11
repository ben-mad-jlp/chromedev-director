import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Session registry entry
 */
interface SessionEntry {
  targetId: string;
  createdAt: string;
  lastUsed: string;
}

/**
 * Session registry structure
 */
interface SessionRegistry {
  sessions: Record<string, SessionEntry>;
}

/**
 * Manages persistent Chrome tab sessions for Claude instances.
 * Each session gets a dedicated, persistent Chrome tab that reuses across tests.
 */
export class SessionManager {
  private registryPath: string;
  private registry: SessionRegistry = { sessions: {} };

  constructor(storageDir: string) {
    this.registryPath = path.join(storageDir, 'sessions.json');
  }

  /**
   * Load session registry from disk
   */
  async load(): Promise<void> {
    try {
      const data = await fs.readFile(this.registryPath, 'utf-8');
      this.registry = JSON.parse(data);
    } catch {
      // File doesn't exist yet, use empty registry
      this.registry = { sessions: {} };
    }
  }

  /**
   * Save session registry to disk
   */
  async save(): Promise<void> {
    await fs.writeFile(
      this.registryPath,
      JSON.stringify(this.registry, null, 2)
    );
  }

  /**
   * Get Chrome targetId for a session
   */
  getTargetId(sessionId: string): string | undefined {
    return this.registry.sessions[sessionId]?.targetId;
  }

  /**
   * Register a session with its Chrome tab targetId
   */
  async registerSession(sessionId: string, targetId: string): Promise<void> {
    this.registry.sessions[sessionId] = {
      targetId,
      createdAt: this.registry.sessions[sessionId]?.createdAt || new Date().toISOString(),
      lastUsed: new Date().toISOString()
    };
    await this.save();
  }

  /**
   * Update last used timestamp for a session
   */
  async updateLastUsed(sessionId: string): Promise<void> {
    if (this.registry.sessions[sessionId]) {
      this.registry.sessions[sessionId].lastUsed = new Date().toISOString();
      await this.save();
    }
  }

  /**
   * Unregister a session (remove from registry)
   */
  async unregisterSession(sessionId: string): Promise<void> {
    delete this.registry.sessions[sessionId];
    await this.save();
  }

  /**
   * List all registered sessions
   */
  listSessions(): Array<{ sessionId: string; targetId: string; createdAt: string; lastUsed: string }> {
    if (!this.registry || !this.registry.sessions) {
      return [];
    }
    return Object.entries(this.registry.sessions).map(([sessionId, data]) => ({
      sessionId,
      ...data
    }));
  }
}
