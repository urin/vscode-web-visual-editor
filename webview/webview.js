const vscode = acquireVsCodeApi();

class App {
  codeEdits = [];
  operation = '';
  keyboard = {
    // Combined state
    shiftOrCtrl: false,
    arrow: false,
    // Each key
    Shift: false,
    Control: false,
    ArrowUp: false,
    ArrowDown: false,
    ArrowLeft: false,
    ArrowRight: false
  };
  startX = 0;
  startY = 0;
  currentX = 0;
  currentY = 0;
  selector = null;
  selectables = [];
  selected = new Set();

  // Emit code edit event to extension
  emitCodeEdits() {
    if (this.codeEdits.length > 0) {
      const data = this.codeEdits.map(edit => {
        const el = edit.element;
        return {
          element:
            el.tagName.toLowerCase() + (el.id ? '#' + el.id : '')
            + Array.from(el.classList).filter(c => !c.startsWith('wve')).map(c => `.${c}`).join(''),
          codeRange: {
            start: +edit.element.dataset.wveCodeStart,
            end: +edit.element.dataset.wveCodeEnd
          },
          operations: edit.operations
        };
      });
      vscode.postMessage({ type: 'edit', data });
      this.codeEdits = [];
    }
  }
  // Select element
  select(element) {
    if (this.selected.has(element)) { return; }
    if (this.selected.values().some(s => s.contains(element) || element.contains(s))) {
      return;
    }
    if (this.codeEdits.some(
      c => c.element !== element && (c.element.contains(element) || element.contains(c.element))
    )) {
      return;
    }
    this.selected.add(element);
    element.setAttribute('wve-selected', '');
    const updated = this.codeEdits.some(edit => {
      if (edit.element === element) {
        const toggled = edit.operations.some(o => {
          if (o.type === 'deselect') {
            o.type = 'select';
            return true;
          }
        });
        if (!toggled) {
          edit.operations.push({ type: 'select' });
        }
        return true;
      }
    });
    if (!updated) {
      this.codeEdits.push({
        element, operations: [{ type: 'select' }]
      });
    }
  }
  // Deselect element
  deselect(element = null) {
    if (!element) {
      document.body.querySelectorAll('[wve-selected]').forEach(el => { this.deselect(el); });
      return;
    }
    if (!this.selected.has(element)) { return; }
    if (this.codeEdits.some(
      c => c.element !== element && (c.element.contains(element) || element.contains(c.element))
    )) {
      return;
    }
    this.selected.delete(element);
    element.removeAttribute('wve-selected');
    const updated = this.codeEdits.some(edit => {
      if (edit.element === element) {
        const toggled = edit.operations.some(o => {
          if (o.type === 'select') {
            o.type = 'deselect';
            return true;
          }
        });
        if (!toggled) {
          edit.operations.push({ type: 'deselect' });
        }
        return true;
      }
    });
    if (!updated) {
      this.codeEdits.push({
        element, operations: [{ type: 'deselect' }]
      });
    }
  }
  // Deselect if the element is selected, otherwise select it
  toggleSelection(el) {
    if (this.selected.has(el)) {
      this.deselect(el);
    } else {
      this.select(el);
    }
  }
  // Put moving operation
  movementToCode() {
    this.selected.forEach(element => {
      const operation = { type: 'move', style: element.getAttribute('style') };
      const updated = this.codeEdits.some(edit => {
        if (edit.element === element) {
          edit.operations.push(operation);
          return true;
        }
      });
      if (!updated) {
        this.codeEdits.push({ element, operations: [operation] });
      }
    });
  }

  // Event handlers
  // NOTE Define as arrow functions so that `this` is correctly referenced

  // Draw a rectangle of the selection area
  drawSelector = () => {
    if (this.operation !== 'selecting') { return; }
    requestAnimationFrame(this.drawSelector);
    const [width, height] = [
      Math.abs(this.currentX - this.startX),
      Math.abs(this.currentY - this.startY)
    ];
    const selector = this.selector;
    selector.style.width = width + 'px';
    selector.style.height = height + 'px';
    selector.style.left = Math.min(this.startX, this.currentX) + 'px';
    selector.style.top = Math.min(this.startY, this.currentY) + 'px';
    selector.style.display = 'block';
  };

  // Keyboard events
  setStateKeyboardPress(key) {
    this.keyboard[key] = true;
  }
  setStateKeyboardRelease(key) {
    this.keyboard[key] = false;
  }
  updateKeyboardCombinedState() {
    const kbd = this.keyboard;
    const prev = Object.assign({}, kbd);
    kbd.shiftOrControl = kbd.Shift || kbd.Control;
    kbd.arrow = kbd.ArrowUp || kbd.ArrowDown || kbd.ArrowLeft || kbd.ArrowRight;
    return prev;
  }
  onKeyDown = event => {
    switch (event.key) {
      case 'Escape':
        this.deselect();
        this.emitCodeEdits();
        break;
      case 'Shift':
      case 'Control':
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight':
        this.setStateKeyboardPress(event.key);
        break;
    }
    this.updateKeyboardCombinedState();

    if (this.operation === '') {
      const kbd = this.keyboard;
      if ((kbd.ArrowUp || kbd.ArrowDown) && !(kbd.ArrowUp && kbd.ArrowDown)) {
        this.selected.forEach(el => {
          const propY = el.dataset.wvePropY;
          const dy = (
            ((propY === 'top' && kbd.ArrowDown) ||
              (propY === 'bottom' && kbd.ArrowUp)) ? 1 : -1
          );
          const styles = el.computedStyleMap();
          el.style[propY] = styles.get(propY).value + dy + 'px';
        });
      }
      if ((kbd.ArrowLeft || kbd.ArrowRight) && !(kbd.ArrowLeft && kbd.ArrowRight)) {
        this.selected.forEach(el => {
          const propX = el.dataset.wvePropX;
          const dx = (
            ((propX === 'left' && kbd.ArrowRight) ||
              (propX === 'right' && kbd.ArrowLeft)) ? 1 : -1
          );
          const styles = el.computedStyleMap();
          el.style[propX] = styles.get(propX).value + dx + 'px';
        });
      }
    }
  };

  onKeyUp = event => {
    switch (event.key) {
      case 'Shift':
      case 'Control':
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight':
        this.setStateKeyboardRelease(event.key);
        break;
    }
    const prev = this.updateKeyboardCombinedState();
    if (prev.arrow && !this.keyboard.arrow) {
      this.movementToCode();
      this.emitCodeEdits();
    }
  };

  onMouseDown = event => {
    this.startX = this.currentX = event.pageX;
    this.startY = this.currentY = event.pageY;
    // Determine whether to select or edit the element based on the click position
    const atSelected = this.selected.values().some(el => {
      const rect = el.getBoundingClientRect();
      return (
        rect.left <= this.currentX && this.currentX <= rect.right
        && rect.top <= this.currentY && this.currentY <= rect.bottom
      );
    });
    if (!atSelected || this.keyboard.shiftOrControl) {
      this.operation = 'selecting';
    } else if (atSelected) {
      this.operation = 'editing';
    } else {
      this.operation = '';
      return;
    }
    // Process at the start of selection
    if (this.operation === 'selecting') {
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
      if (!this.keyboard.shiftOrControl) { this.deselect(); }
      const selectorRect = this.selector.getBoundingClientRect();
      if (selectorRect.width > 0 && selectorRect.height > 0) {
        const targets = this.selectables.filter(el => {
          const rect = el.getBoundingClientRect();
          return !(
            selectorRect.right < rect.left ||
            rect.right < selectorRect.left ||
            selectorRect.bottom < rect.top ||
            rect.bottom < selectorRect.top
          ) && !(
            rect.left <= selectorRect.left &&
            selectorRect.right <= rect.right &&
            rect.top <= selectorRect.top &&
            selectorRect.bottom <= rect.bottom
          );
        });
        if (this.keyboard.shiftOrControl) {
          targets.forEach(el => this.toggleSelection(el));
        } else {
          targets.forEach(el => this.select(el));
        }
      } else if (this.selectables.includes(event.target)) {
        if (this.keyboard.shiftOrControl) {
          this.toggleSelection(event.target);
        } else {
          this.select(event.target);
        }
      }
      this.selector.style.display = 'none';
    } else {
      if (this.startX !== this.currentX || this.startY !== this.currentY) {
        this.movementToCode();
      }
    }
    this.operation = '';
    this.emitCodeEdits();
  };
};

const app = new App();

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
  app.selected = new Set(Array.from(document.querySelectorAll('[wve-selected]')));
  // Add selector
  app.selector = document.createElement('div');
  app.selector.id = 'selector';
  document.body.appendChild(app.selector);
  // Click (drag start) event
  document.addEventListener('mousedown', app.onMouseDown);
  // Keep update the state of the keyboard being pressed
  document.addEventListener('keydown', app.onKeyDown);
  document.addEventListener('keyup', app.onKeyUp);
  // Copy and cut events
  function postMessageOnCopyAndCut(event) {
    vscode.postMessage({
      type: event.type,
      data: Array.from(app.selected).map(el => {
        return {
          codeRange: {
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
});