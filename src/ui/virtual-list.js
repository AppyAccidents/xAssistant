class VirtualList {
  constructor({ viewport, listLayer, rowHeight = 120, overscan = 6, renderRow }) {
    this.viewport = viewport;
    this.listLayer = listLayer;
    this.rowHeight = rowHeight;
    this.overscan = overscan;
    this.renderRow = renderRow;
    this.items = [];

    this.onScroll = this.onScroll.bind(this);
    this.viewport.addEventListener('scroll', this.onScroll);
  }

  setItems(items) {
    this.items = Array.isArray(items) ? items : [];
    this.render();
  }

  onScroll() {
    this.render();
  }

  render() {
    const viewportHeight = this.viewport.clientHeight || 0;
    const scrollTop = this.viewport.scrollTop || 0;
    const totalHeight = this.items.length * this.rowHeight;

    const startIndex = Math.max(0, Math.floor(scrollTop / this.rowHeight) - this.overscan);
    const visibleCount = Math.ceil(viewportHeight / this.rowHeight) + this.overscan * 2;
    const endIndex = Math.min(this.items.length, startIndex + visibleCount);

    this.listLayer.style.height = `${totalHeight}px`;
    this.listLayer.innerHTML = '';

    for (let index = startIndex; index < endIndex; index += 1) {
      const row = this.renderRow(this.items[index], index);
      row.style.position = 'absolute';
      row.style.top = `${index * this.rowHeight}px`;
      row.style.left = '0';
      row.style.right = '0';
      this.listLayer.appendChild(row);
    }
  }

  destroy() {
    this.viewport.removeEventListener('scroll', this.onScroll);
  }
}

module.exports = {
  VirtualList
};
