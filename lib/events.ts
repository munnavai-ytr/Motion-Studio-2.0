type Listener<T = any> = (data: T) => void;

class AppEventEmitter {
  private events: Map<string, Set<Listener>> = new Map();

  on<T = any>(event: string, listener: Listener<T>): () => void {
    if (!this.events.has(event)) {
      this.events.set(event, new Set());
    }
    this.events.get(event)!.add(listener);
    return () => this.off(event, listener);
  }

  off(event: string, listener: Listener) {
    const listeners = this.events.get(event);
    if (listeners) {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.events.delete(event);
      }
    }
  }

  emit<T = any>(event: string, data?: T) {
    const listeners = this.events.get(event);
    if (listeners) {
      listeners.forEach((fn) => {
        try {
          fn(data);
        } catch (e) {
          console.error('[AppEvents] Listener error:', e);
        }
      });
    }
  }
}

export const appEvents = new AppEventEmitter();
