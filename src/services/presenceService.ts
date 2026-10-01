/**
 * Real-time In-Memory Presence Service
 * Tracks active visitors and admin users lightweight in-memory with zero DB overhead.
 */

interface ActiveUser {
  clientId: string;
  role: 'ADMIN' | 'PUBLIC';
  path?: string;
  lastSeen: number;
}

class PresenceService {
  private activeUsers: Map<string, ActiveUser> = new Map();
  private readonly TTL_MS = 90 * 1000; // 90 seconds timeout

  constructor() {
    // Prune stale visitors periodically
    const timer = setInterval(() => this.cleanup(), 60 * 1000);
    if (timer.unref) {
      timer.unref(); // Prevent blocking process exit
    }
  }

  public recordPing(clientId: string, role: 'ADMIN' | 'PUBLIC', path?: string): void {
    if (!clientId) return;
    this.activeUsers.set(clientId, {
      clientId,
      role,
      path: path || '/',
      lastSeen: Date.now()
    });
  }

  public recordLeave(clientId: string): void {
    if (!clientId) return;
    this.activeUsers.delete(clientId);
  }

  public getOnlineStats(): { total: number; admin: number; public: number } {
    this.cleanup();
    let admin = 0;
    let pub = 0;

    for (const user of this.activeUsers.values()) {
      if (user.role === 'ADMIN') {
        admin++;
      } else {
        pub++;
      }
    }

    // Since stats are fetched by an admin, admin count must be at least 1
    if (admin === 0) admin = 1;

    return {
      total: admin + pub,
      admin,
      public: pub
    };
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [id, user] of this.activeUsers.entries()) {
      if (now - user.lastSeen > this.TTL_MS) {
        this.activeUsers.delete(id);
      }
    }
  }
}

export const presenceService = new PresenceService();
