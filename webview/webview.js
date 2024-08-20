const vscode = acquireVsCodeApi();

class App {
  operation = '';
  keyboard = {
    shiftOrCtrl: false,
    shift: false,
    ctrl: false
  };
  startX = 0;
  startY = 0;
  currentX = 0;
  currentY = 0;
  selector = null;
  selectables = [];
  selected = [];
  // Add class attributes to the selected elements, excluding ancestor elements of the selected elements
  organizeSelection() {
    this.selected = this.selected.filter(el => {
      const shouldRemove = this.selected.some(other => other !== el && el.contains(other));
      el.classList[shouldRemove ? 'remove' : 'add']('wve-selected');
      return !shouldRemove;
    });
  }
  // Deselect if the element is selected, otherwise add it
  toggleSelection(el) {
    const index = this.selected.indexOf(el);
    if (index < 0) {
      this.selected.push(el);
      el.classList.add('wve-selected');
    } else {
      this.selected.splice(index, 1);
      el.classList.remove('wve-selected');
    }
  }

  // Event handlers
  // NOTE Define as arrow functions so that `this` is correctly referenced

  // Draw a rectangle of the selection area
  drawSelector = () => {
    if (this.operation !== 'selecting') { return; }
    requestAnimationFrame(this.drawSelector);
    const [width, height] = [
      Math.abs(this.currentX - this.startX), Math.abs(this.currentY - this.startY)
    ];
    const selector = this.selector;
    selector.style.width = width + 'px';
    selector.style.height = height + 'px';
    selector.style.left = Math.min(this.startX, this.currentX) + 'px';
    selector.style.top = Math.min(this.startY, this.currentY) + 'px';
    selector.style.display = 'block';
  };

  onKeyDown = event => {
    switch (event.key) {
    case 'Shift':
      this.keyboard.shift = true;
      break;
    case 'Control':
      this.keyboard.ctrl = true;
      break;
    }
    this.keyboard.shiftOrCtrl = this.keyboard.shift || this.keyboard.ctrl;
  };

  onKeyUp = event => {
    switch (event.key) {
    case 'Shift':
      this.keyboard.shift = false;
      break;
    case 'Control':
      this.keyboard.ctrl = false;
      break;
    }
    this.keyboard.shiftOrCtrl = this.keyboard.shift || this.keyboard.ctrl;
  };

  onMouseDown = event => {
    this.startX = this.currentX = event.pageX;
    this.startY = this.currentY = event.pageY;
    // Determine whether to select or edit the element based on the click position
    const atSelected = this.selected.some(el => {
      const rect = el.getBoundingClientRect();
      return (
        rect.left <= this.currentX && this.currentX <= rect.right
        && rect.top <= this.currentY && this.currentY <= rect.bottom
      );
    });
    if (!atSelected || this.keyboard.shiftOrCtrl) {
      this.operation = 'selecting';
    } else if (atSelected) {
      this.operation = 'editing';
    } else {
      this.operation = '';
      return;
    }
    // Process at the start of selection
    if (this.operation === 'selecting') {
      if (!this.keyboard.shiftOrCtrl) {
        this.selected.forEach(el => el.classList.remove('wve-selected'));
        this.selected = [];
      }
      if (this.selectables.includes(event.target)) {
        this.toggleSelection(event.target);
        this.organizeSelection();
      }
      this.drawSelector();
    }
    document.addEventListener('mouseup', this.onMouseUp, { once: true });
    document.addEventListener('mousemove', this.onMouseMove);
  };

  onMouseMove = event => {
    const dx = event.pageX - this.currentX;
    const dy = event.pageY - this.currentY;
    this.currentX = event.pageX;
    this.currentY = event.pageY;
    if (this.operation !== 'editing') { return; }
    this.selected.forEach(el => {
      const propX = el.dataset.wvePropX;
      const propY = el.dataset.wvePropY;
      const styles = el.computedStyleMap();
      el.style[propX] = styles.get(propX).value + (propX === 'left' ? dx : -dx) + 'px';
      el.style[propY] = styles.get(propY).value + (propY === 'top' ? dy : -dy) + 'px';
    });
  };

  onMouseUp = event => {
    document.removeEventListener('mousemove', this.onMouseMove);
    if (this.operation === 'selecting') {
      const selectorRect = this.selector.getBoundingClientRect();
      if (selectorRect.width > 0 && selectorRect.height > 0) {
        const targets = this.selectables.filter(el => {
          const rect = el.getBoundingClientRect();
          return !(
            rect.top > selectorRect.bottom ||
            rect.right < selectorRect.left ||
            rect.bottom < selectorRect.top ||
            rect.left > selectorRect.right
          );
        });
        if (this.keyboard.shiftOrCtrl) {
          targets.forEach(this.toggleSelection);
        } else {
          this.selected = targets;
        }
        this.organizeSelection();
      }
      this.selector.style.display = 'none';
    } else {
      if (this.startX !== this.currentX || this.startY !== this.currentY) {
        vscode.postMessage({
          type: 'move',
          data: this.selected.map(el => {
            return {
              code: {
                start: +el.dataset.wveCodeStart,
                end: +el.dataset.wveCodeEnd
              },
              style:
                el.getAttribute('style')
            };
          })
        });
      }
    }
    this.operation = '';
  };
};

const app = new App();

// Keep update the state of the keyboard being pressed
document.addEventListener('keydown', app.onKeyDown);
document.addEventListener('keyup', app.onKeyUp);

// Copy and cut events
function postMessageOnCopyAndCut(event) {
  vscode.postMessage({
    type: event.type,
    data: app.selected.map(el => {
      return {
        code: {
          start: +el.dataset.wveCodeStart,
          end: +el.dataset.wveCodeEnd
        }
      };
    })
  });
}
document.addEventListener('copy', postMessageOnCopyAndCut);
document.addEventListener('cut', postMessageOnCopyAndCut);
document.addEventListener('paste', event => {
  vscode.postMessage({
    type: 'paste',
    data: event.clipboardData.getData('text')
  });
});

// Initial display
document.addEventListener('DOMContentLoaded', async () => {
  // Remove Visual Studio Code default styles
  document.getElementById('_defaultStyles')?.remove();
  // Prepare selectable elements
  document.body.querySelectorAll('*').forEach(el => {
    const styles = el.computedStyleMap();
    const position = styles.get('position').value;
    if (position === 'static' || position === 'sticky') { return; }
    const props = {
      left: styles.get('left'), right: styles.get('right'),
      top: styles.get('top'), bottom: styles.get('bottom')
    };
    // Ignore if both left & right, top & bottom are specified
    if ((props.left.value !== 'auto' && props.right.value !== 'auto')
      || (props.top.value !== 'auto' && props.bottom.value !== 'auto')) {
      return;
    }
    // Default to left, top if not specified
    const propX = props.left.value !== 'auto' ? 'left' : props.right.value !== 'auto' ? 'right' : 'left';
    const propY = props.top.value !== 'auto' ? 'top' : props.bottom.value !== 'auto' ? 'bottom' : 'top';
    const x = props[propX];
    const y = props[propY];
    // Ignore units except for px
    if ((x.value !== 'auto' && x.unit !== 'px') || (y.value !== 'auto' && y.unit !== 'px')) {
      return;
    }
    el.style[propX] = x.value === 'auto' ? '0' : x.toString();
    el.style[propY] = y.value === 'auto' ? '0' : y.toString();
    el.classList.add('wve-selectable');
    el.setAttribute('draggable', 'false');
    el.dataset.wvePropX = propX;
    el.dataset.wvePropY = propY;
    app.selectables.push(el);
  });
  // Add selector
  app.selector = document.createElement('div');
  app.selector.id = 'selector';
  document.body.append(app.selector);
  // Click (drag start) event
  document.addEventListener('mousedown', app.onMouseDown);
});