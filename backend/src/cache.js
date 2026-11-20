// Tiny in-memory TTL cache. Fine for a single backend replica; use Redis when scaling out.
class TtlCache {
  constructor(maxEntries = 500) {
    this.map = new Map();
    this.maxEntries = maxEntries;
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expires < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key); // re-insert to update order
    this.map.set(key, entry);
    return entry.value;
  }

  set(key, value, ttlMs) {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxEntries) {
      this.map.delete(this.map.keys().next().value); // evict least-recently-used
    }
    this.map.set(key, { value, expires: Date.now() + ttlMs });
  }
}

module.exports = { TtlCache };
