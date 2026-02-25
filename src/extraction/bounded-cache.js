class BoundedMap {
  constructor(limit = 5000) {
    this.limit = limit;
    this.map = new Map();
  }

  set(key, value) {
    if (this.map.has(key)) {
      this.map.delete(key);
    }

    this.map.set(key, value);

    if (this.map.size > this.limit) {
      const oldestKey = this.map.keys().next().value;
      this.map.delete(oldestKey);
    }
  }

  get(key) {
    return this.map.get(key);
  }

  values() {
    return Array.from(this.map.values());
  }

  clear() {
    this.map.clear();
  }

  get size() {
    return this.map.size;
  }
}

module.exports = {
  BoundedMap
};
