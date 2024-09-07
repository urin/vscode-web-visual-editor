class App {
  codeEdits = [];
  operation = '';
  keyboard = {
    shiftOrCtrl: false,
    arrow: false,
  };
  mouse = {
    start: {
      viewportX: 0,
      viewportY: 0,
      pageX: 0,
      pageY: 0,
    },
    current: {
      viewportX: 0,
      viewportY: 0,
      pageX: 0,
      pageY: 0,
    }
  };
  toolbar = null;
  zoom = '1';
  linkCode = false;
  userElements = Array.from(document.body.querySelectorAll('*'));
  selector = null;
  movables = [];
  selected = new Set();
  movers = new Set();
  moversBeforeEdit = null;

  initMovables() {
    this.userElements.forEach(el => {
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
      el.setAttribute('wve-movable', '');
      el.setAttribute('draggable', 'false');
      el.dataset.wvePropX = propX;
      el.dataset.wvePropY = propY;
      if (x.value !== 'auto') { el.style[propX] = x.toString(); }
      if (y.value !== 'auto') { el.style[propY] = y.toString(); }
      this.movables.push(el);
    });
  }
  initSelector() {
    this.selector = document.createElement('div');
    this.selector.id = 'wve-selector';
    this.selector.style.display = 'none';
    document.body.appendChild(this.selector);
  }
  initToolbar() {
    const fragment = new DocumentFragment();
    this.toolbar = document.createElement('div');
    this.toolbar.id = 'wve-toolbar';
    fragment.appendChild(this.toolbar);
    const controls = {
      toolbarZoomValue: 'wve-zoom-value',
      toolbarZoomIn: 'wve-zoom-in',
      toolbarZoomOut: 'wve-zoom-out',
      toolbarGroupAlign: 'wve-group-align',
      toolbarLinkCode: 'wve-link-code',
    };
    this.toolbar.innerHTML = `
      <fieldset>
        <button id="${controls.toolbarZoomIn}" type="button" class="wve-button">zoom_in</button>
        <span id="${controls.toolbarZoomValue}">100%</span>
        <button id="${controls.toolbarZoomOut}" type="button" class="wve-button">zoom_out</button>
        <label class="wve-button">
          dataset_linked
          <input id="${controls.toolbarLinkCode}" type="checkbox">
        </label>
      </fieldset>
      <fieldset id="${controls.toolbarGroupAlign}" disabled>
        <button type="button" class="wve-button" id="align-vertical-top">align_vertical_top</button>
        <button type="button" class="wve-button" id="align-vertical-center">align_vertical_center</button>
        <button type="button" class="wve-button" id="align-vertical-bottom">align_vertical_bottom</button>
        <button type="button" class="wve-button" id="align-horizontal-left">align_horizontal_left</button>
        <button type="button" class="wve-button" id="align-horizontal-center">align_horizontal_center</button>
        <button type="button" class="wve-button" id="align-horizontal-right">align_horizontal_right</button>
      </fieldset>
    `;
    Object.entries(controls).forEach(([key, id]) => {
      this[key] = fragment.getElementById(id);
    });
    this.toolbarZoomIn.addEventListener('click', event => { this.updateZoom(1); });
    this.toolbarZoomOut.addEventListener('click', event => { this.updateZoom(-1); });
    this.toolbarGroupAlign.addEventListener('click', this.onClickGroupAlign);
    this.toolbarLinkCode.addEventListener('change', event => {
      this.linkCode = event.target.checked;
    });
    document.body.appendChild(fragment);
  }

  shortNameOf(el) {
    return (
      el.tagName.toLowerCase() + (el.id ? '#' + el.id : '')
      + Array.from(el.classList).filter(c => !c.startsWith('wve')).map(c => `.${c}`).join('')
    );
  }
  realPositionOf(event) {
    return Object.fromEntries(
      ['clientX', 'clientY', 'pageX', 'pageY'].map(
        key => [key, Math.round(event[key] / +this.zoom)]
      )
    );
  }
  moveElement(el, dx, dy) {
    if (dx === 0 && dy === 0) { return; }
    dx = Math.trunc(dx);
    dy = Math.trunc(dy);
    const styles = el.computedStyleMap();
    if (dx !== 0) {
      const propX = el.dataset.wvePropX;
      const valueX = styles.get(propX).value;
      const x = valueX === 'auto' ? 0 : valueX;
      el.style[propX] = x + (propX === 'left' ? dx : -dx) + 'px';
    }
    if (dy !== 0) {
      const propY = el.dataset.wvePropY;
      const valueY = styles.get(propY).value;
      const y = valueY === 'auto' ? 0 : valueY;
      el.style[propY] = y + (propY === 'top' ? dy : -dy) + 'px';
    }
  }
  // Emit code edit event to extension
  emitCodeEdits() {
    if (this.codeEdits.length === 0) { return; }
    const data = this.codeEdits.map(edit => {
      const element = edit.element;
      return {
        element: this.shortNameOf(element),
        codeRange: {
          start: +element.dataset.wveCodeStart,
          end: +element.dataset.wveCodeEnd
        },
        operations: edit.operations
      };
    });
    vscode.postMessage({ type: 'edit', data });
    this.codeEdits = [];
    this.moversBeforeEdit.clear();
  }

  emitSelectionChange() {
    if (this.linkCode) {
      vscode.postMessage({
        type: 'select',
        data: Array.from(this.selected).map(el => {
          return {
            codeRange: {
              start: el.dataset.wveCodeStart,
              end: el.dataset.wveCodeEnd
            }
          };
        })
      });
    }
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
    if (element.hasAttribute('wve-movable')) {
      this.movers.add(element);
    }
    if (this.movers.size > 1) { this.toolbarGroupAlign.removeAttribute('disabled'); }
    this.emitSelectionChange();
  }
  // Deselect element
  deselect(element = null) {
    if (!element) {
      this.selected.values().forEach(el => { this.deselect(el); });
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
    this.movers.delete(element);
    if (this.movers.size < 2) { this.toolbarGroupAlign.setAttribute('disabled', ''); }
    this.emitSelectionChange();
  }
  // Deselect if the element is selected, otherwise select it
  toggleSelection(el) {
    if (this.selected.has(el)) {
      this.deselect(el);
    } else {
      this.select(el);
    }
  }
  beginStyleEdit() {
    this.moversBeforeEdit = new Map(this.movers.values().map(el => [el, el.cloneNode(true)]));
  }
  finishStyleEdit(type) {
    this.movers.forEach(element => {
      const style = element.getAttribute('style');
      if (style === this.moversBeforeEdit.get(element).getAttribute('style')) { return; }
      const operation = { type, style };
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
      Math.abs(this.mouse.current.pageX - this.mouse.start.pageX),
      Math.abs(this.mouse.current.pageY - this.mouse.start.pageY)
    ];
    const selector = this.selector;
    selector.style.width = width + 'px';
    selector.style.height = height + 'px';
    selector.style.left = Math.min(this.mouse.start.pageX, this.mouse.current.pageX) + 'px';
    selector.style.top = Math.min(this.mouse.start.pageY, this.mouse.current.pageY) + 'px';
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
    kbd.shiftOrControl = kbd.Shift || kbd.Control;
    kbd.arrow = kbd.ArrowUp !== kbd.ArrowDown || kbd.ArrowLeft !== kbd.ArrowRight;
  }
  onKeyDown = event => {
    const kbd = this.keyboard;
    const prev = { ...kbd };
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
      if (!kbd.arrow || this.movers.size === 0) { return; }
      if (!prev.arrow) { this.beginStyleEdit(); }
      const dx = kbd.ArrowRight ? 1 : kbd.ArrowLeft ? -1 : 0;
      const dy = kbd.ArrowDown ? 1 : kbd.ArrowUp ? -1 : 0;
      this.movers.forEach(el => { this.moveElement(el, dx, dy); });
      // Disable scroll
      event.preventDefault();
    }
  };

  onKeyUp = event => {
    const kbd = this.keyboard;
    const prev = { ...kbd };
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
    this.updateKeyboardCombinedState();
    if (prev.arrow && !this.keyboard.arrow) {
      this.finishStyleEdit('move');
      this.emitCodeEdits();
    }
    if (event.key === 'Delete' && this.selected.length > 0) {
      vscode.postMessage({
        type: 'delete',
        data: Array.from(this.selected).map(el => {
          return {
            codeRange: {
              start: +el.dataset.wveCodeStart,
              end: +el.dataset.wveCodeEnd
            }
          };
        })
      });
    }
  };

  onMouseDown = event => {
    if (this.toolbar.contains(event.target)) { return; }
    const pos = this.realPositionOf(event);
    this.mouse.start.viewportX = this.mouse.current.viewportX = pos.clientX;
    this.mouse.start.viewportY = this.mouse.current.viewportY = pos.clientY;
    this.mouse.start.pageX = this.mouse.current.pageX = pos.pageX;
    this.mouse.start.pageY = this.mouse.current.pageY = pos.pageY;
    // Determine whether to select or edit the element based on the click position
    const atMovers = this.movers.values().some(el => {
      const rect = el.getBoundingClientRect();
      return (
        rect.left <= this.mouse.current.viewportX && this.mouse.current.viewportX <= rect.right
        && rect.top <= this.mouse.current.viewportY && this.mouse.current.viewportY <= rect.bottom
      );
    });
    if (atMovers && !this.keyboard.Control) {
      this.operation = 'moving';
      this.beginStyleEdit();
    } else {
      this.operation = 'selecting';
      this.selector.style.display = 'block';
      if (!this.keyboard.Control) { this.deselect(); }
    }
    // Process at the start of selection
    if (this.operation === 'selecting') {
      this.drawSelector();
    }
    document.addEventListener('mouseup', this.onMouseUp, { once: true });
    document.addEventListener('mousemove', this.onMouseMove);
  };

  onMouseMove = event => {
    const pos = this.realPositionOf(event);
    const dx = pos.clientX - this.mouse.current.viewportX;
    const dy = pos.clientY - this.mouse.current.viewportY;
    this.mouse.current.viewportX += dx;
    this.mouse.current.viewportY += dy;
    this.mouse.current.pageX = pos.pageX;
    this.mouse.current.pageY = pos.pageY;
    if (this.operation !== 'moving') { return; }
    if (this.keyboard.Shift) {
      const absDx = Math.abs(pos.clientX - this.mouse.start.viewportX);
      const absDy = Math.abs(pos.clientY - this.mouse.start.viewportY);
      const horizontal = absDx > absDy;
      this.movers.forEach(el => {
        const propFixed = horizontal ? el.dataset.wvePropY : el.dataset.wvePropX;
        el.style[propFixed] = this.moversBeforeEdit.get(el).style[propFixed];
        if (horizontal) {
          this.moveElement(el, dx, 0);
        } else {
          this.moveElement(el, 0, dy);
        }
      });
    } else {
      this.movers.forEach(el => this.moveElement(el, dx, dy));
    }
  };

  onMouseUp = event => {
    document.removeEventListener('mousemove', this.onMouseMove);
    if (this.operation === 'selecting') {
      if (this.mouse.start.viewportX !== this.mouse.current.viewportX
        || this.mouse.start.viewportY !== this.mouse.current.viewportY) {
        const selectorRect = this.selector.getBoundingClientRect();
        const targets = this.userElements.filter(el => {
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
        if (this.keyboard.Control) {
          targets.forEach(el => this.toggleSelection(el));
        } else {
          targets.forEach(el => this.select(el));
        }
      } else if (event.target !== document.body) {
        if (this.keyboard.Control) {
          this.toggleSelection(event.target);
        } else {
          this.select(event.target);
        }
      }
      this.selector.style.display = 'none';
    } else {
      if (this.mouse.start.viewportX !== this.mouse.current.viewportX
        || this.mouse.start.viewportY !== this.mouse.current.viewportY) {
        this.finishStyleEdit('move');
      }
    }
    this.operation = '';
    this.emitCodeEdits();
  };

  onCopyAndCut = event => {
    vscode.postMessage({
      type: event.type,
      data: Array.from(this.selected).map(el => {
        return {
          codeRange: {
            start: +el.dataset.wveCodeStart,
            end: +el.dataset.wveCodeEnd
          }
        };
      })
    });
  };
  onPaste = event => {
    vscode.postMessage({
      type: 'paste',
      data: event.clipboardData.getData('text')
    });
  };

  updateZoom(sign) {
    const steps = ['0.5', '0.67', '0.8', '0.9', '1', '1.1', '1.25', '1.5', '2'];
    if (sign) {
      this.zoom = steps[steps.indexOf(this.zoom) + sign];
    } else {
      this.zoom = sessionStorage.getItem('zoom') || '1';
    }
    sessionStorage.setItem('zoom', this.zoom);
    document.documentElement.style.setProperty('--wve-zoom', this.zoom);
    this.toolbarZoomValue.textContent = (
      this.zoom.replace(/^0/, ' ').replace('.', '').padEnd(3, '0') + '%'
    );
    const stepIndex = steps.indexOf(this.zoom);
    if (stepIndex < 0) { return; }
    if (stepIndex === 0) {
      this.toolbarZoomOut.setAttribute('disabled', '');
    } else if (stepIndex === steps.length - 1) {
      this.toolbarZoomIn.setAttribute('disabled', '');
    } else {
      this.toolbarZoomIn.removeAttribute('disabled');
      this.toolbarZoomOut.removeAttribute('disabled');
    }
  }

  onClickGroupAlign = event => {
    if (this.operation !== '' || this.movers.size < 2) { return; }
    this.beginStyleEdit();
    const [direction, alignTo] = event.target.id.split('-').slice(1);
    const movers = Array.from(this.movers);
    const anchors = movers.map(el => {
      const rect = el.getBoundingClientRect();
      if (alignTo === 'center') {
        if (direction === 'vertical') {
          return (rect.top + rect.bottom) / 2;
        } else {
          return (rect.left + rect.right) / 2;
        }
      } else {
        return rect[alignTo];
      }
    });
    const destination = (alignTo === 'center' ? anchors[0]
      : Math[{ left: 'min', right: 'max', top: 'min', bottom: 'max' }[alignTo]](...anchors)
    );
    movers.forEach((el, index) => {
      const dx = direction === 'vertical' ? 0 : destination - anchors[index];
      const dy = direction === 'horizontal' ? 0 : destination - anchors[index];
      this.moveElement(el, dx, dy);
    });
    this.finishStyleEdit();
    this.emitCodeEdits();
  };
};

const vscode = acquireVsCodeApi();

// Initial display
document.addEventListener('DOMContentLoaded', async () => {
  const app = new App();
  // Remove Visual Studio Code default styles
  document.getElementById('_defaultStyles')?.remove();
  app.initMovables();
  app.initSelector();
  app.initToolbar();
  app.updateZoom();
  document.addEventListener('mousedown', app.onMouseDown);
  document.addEventListener('keydown', app.onKeyDown);
  document.addEventListener('keyup', app.onKeyUp);
  document.addEventListener('copy', app.onCopyAndCut);
  document.addEventListener('cut', app.onCopyAndCut);
  document.addEventListener('paste', app.onPaste);
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
