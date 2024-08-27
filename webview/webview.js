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

  shortName(el) {
    return (
      el.tagName.toLowerCase() + (el.id ? '#' + el.id : '')
      + Array.from(el.classList).filter(c => !c.startsWith('wve')).map(c => `.${c}`).join('')
    );
  }
  // Emit code edit event to extension
  emitCodeEdits() {
    if (this.codeEdits.length === 0) { return; }
    const data = this.codeEdits.map(edit => {
      const element = edit.element;
      return {
        element: this.shortName(element),
        codeRange: {
          start: +element.dataset.wveCodeStart,
          end: +element.dataset.wveCodeEnd
        },
        operations: edit.operations
      };
    });
    vscode.postMessage({ type: 'edit', data });
    this.codeEdits = [];
    this.selectedBeforeEdit.clear();
  }
  // Select element
  select(element) {
    if (this.selected.has(element)) { return; }
    if (this.selected.values().some(s => s.contains(element) || element.contains(s))) {
      return;
    }
    if (this.codeEdits.some(edit => (
      edit.element !== element && (edit.element.contains(element) || element.contains(edit.element))
    ))) {
      return;
    }
    this.selected.add(element);
    element.setAttribute('wve-selected', '');
  }
  // Deselect element
  deselect(element = null) {
    if (!element) {
      document.body.querySelectorAll('[wve-selected]').forEach(el => { this.deselect(el); });
      return;
    }
    if (!this.selected.has(element)) { return; }
    if (this.codeEdits.some(edit => (
      edit.element !== element && (edit.element.contains(element) || element.contains(edit.element))
    ))) {
      return;
    }
    this.selected.delete(element);
    element.removeAttribute('wve-selected');
  }
  // Deselect if the element is selected, otherwise select it
  toggleSelection(el) {
    if (this.selected.has(el)) {
      this.deselect(el);
    } else {
      this.select(el);
    }
  }
  beginEdit() {
    this.selectedBeforeEdit = new Map(
      Array.from(
        document.body.querySelectorAll('[wve-selected]')
      ).map(
        s => [s, s.cloneNode(true)]
      )
    );
  }
  finishEdit(type) {
    this.selected.forEach(element => {
      const operation = {
        type,
        style: element.getAttribute('style')
      };
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
    const prev = { ...kbd };
    kbd.shiftOrControl = kbd.Shift || kbd.Control;
    kbd.arrow = ((kbd.ArrowUp || kbd.ArrowDown) && !(kbd.ArrowUp && kbd.ArrowDown))
      || ((kbd.ArrowLeft || kbd.ArrowRight) && !(kbd.ArrowLeft && kbd.ArrowRight));
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
    const prev = this.updateKeyboardCombinedState();

    if (this.operation === '') {
      const kbd = this.keyboard;
      if (!kbd.arrow) { return; }
      if (this.selected.size > 0 && !prev.arrow) {
        this.beginEdit();
      }
      if (kbd.ArrowUp || kbd.ArrowDown) {
        this.selected.forEach(el => {
          const propY = el.dataset.wvePropY;
          const dy = (
            ((propY === 'top' && kbd.ArrowDown) ||
              (propY === 'bottom' && kbd.ArrowUp)) ? 1 : -1
          );
          const styles = el.computedStyleMap();
          const value = styles.get(propY).value;
          const y = value === 'auto' ? 0 : value;
          el.style[propY] = y + dy + 'px';
        });
      }
      if (kbd.ArrowLeft || kbd.ArrowRight) {
        this.selected.forEach(el => {
          const propX = el.dataset.wvePropX;
          const dx = (
            ((propX === 'left' && kbd.ArrowRight) ||
              (propX === 'right' && kbd.ArrowLeft)) ? 1 : -1
          );
          const styles = el.computedStyleMap();
          const value = styles.get(propX).value;
          const x = value === 'auto' ? 0 : value;
          el.style[propX] = x + dx + 'px';
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
      this.finishEdit('move');
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
      this.selector.style.display = 'block';
    } else if (atSelected) {
      this.operation = 'editing';
      this.beginEdit();
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
      const valueX = styles.get(propX).value;
      const valueY = styles.get(propY).value;
      const x = valueX === 'auto' ? 0 : valueX;
      const y = valueY === 'auto' ? 0 : valueY;
      el.style[propX] = x + (propX === 'left' ? dx : -dx) + 'px';
      el.style[propY] = y + (propY === 'top' ? dy : -dy) + 'px';
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
        this.finishEdit('move');
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
    el.classList.add('wve-selectable');
    el.setAttribute('draggable', 'false');
    el.dataset.wvePropX = propX;
    el.dataset.wvePropY = propY;
    if (x.value !== 'auto') { el.style[propX] = x.toString(); }
    if (y.value !== 'auto') { el.style[propY] = y.toString(); }
    app.selectables.push(el);
  });
  app.selected = new Set(Array.from(document.body.querySelectorAll('[wve-selected]')));
  // Add selector
  app.selector = document.createElement('div');
  app.selector.id = 'selector';
  app.selector.style.display = 'none';
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
  // Message from extension host
  window.addEventListener('message', ({ data }) => {
    const { type, data: ranges } = data;
    document.body.querySelectorAll('[data-wve-code-start]').forEach((element, index) => {
      switch (type) {
        case 'codeRanges':
          element.setAttribute('data-wve-code-start', ranges[index].start);
          element.setAttribute('data-wve-code-end', ranges[index].end);
          break;
      }
    });
  });
});
