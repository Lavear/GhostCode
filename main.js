require.config({
  paths: {
    vs: "https://unpkg.com/monaco-editor@0.45.0/min/vs"
  }
});

require(["vs/editor/editor.main"], function () {

  const editor = monaco.editor.create(
    document.getElementById("editor"),
    {
      value: "",
      language: "python",
      theme: "vs-dark",
      fontSize: 20,
      lineHeight: 24,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      padding: { top: 16 },
      automaticLayout: true,
      autoClosingBrackets: "never",
      autoClosingQuotes: "never",
      autoSurround: "never"
    }
  );

  const model = editor.getModel();
  const tabSize = editor.getOption(monaco.editor.EditorOption.tabSize) || 4;

  class InlineGhost {
    constructor(editor) {
      this.editor = editor;
      this.lines = [];
      this.lineIndex = 0;
      this.colConsumed = 0;
      this.isMismatch = false;
      this.anchorPosition = null;
      this.lockedPosition = null;
      this.nodes = [];
      this.indentText = "";
      
      const fontInfo = editor.getOption(monaco.editor.EditorOption.fontInfo);
      this.fontInfo = fontInfo;
      this.charWidth = fontInfo.typicalHalfwidthCharacterWidth;
      this.lineHeight = fontInfo.lineHeight;
    }

    stripComment(text) {
        if (!text) return "";
        return text.split('  # ')[0]; 
    }

    createNode() {
      const node = document.createElement("div");
      node.className = "ghost-text";
      node.style.position = "absolute";
      node.style.pointerEvents = "none";
      node.style.whiteSpace = "pre";
      node.style.fontFamily = this.fontInfo.fontFamily;
      node.style.fontSize = `${this.fontInfo.fontSize}px`;
      node.style.lineHeight = `${this.fontInfo.lineHeight}px`;
      node.style.zIndex = "10"; 
      this.editor.getDomNode().appendChild(node);
      return node;
    }

    computeIndent() {
      const lineText = model.getLineContent(this.lockedPosition.lineNumber);
      const leading = lineText.match(/^\s*/)?.[0] ?? "";
      const needsBlockIndent = lineText.trimEnd().endsWith(":");
      this.indentText = leading + (needsBlockIndent ? " ".repeat(tabSize) : "");
    }

    ensureLinesExist(count) {
      const insertAt = this.lockedPosition.lineNumber;
      const needed = count - 1;
      if (needed <= 0) return;
      model.applyEdits([{
          range: new monaco.Range(insertAt, model.getLineMaxColumn(insertAt), insertAt, model.getLineMaxColumn(insertAt)),
          text: "\n".repeat(needed),
          forceMoveMarkers: true
      }]);
    }

    // --- NEW: APPEND METHOD (For F8) ---
    append(newText) {
       if (!newText) return;
       const newLines = newText.replace(/\r/g, "").split("\n");
       
       // Add new lines to existing
       this.lines = this.lines.concat(newLines);
       
       // Ensure editor has enough space
       this.ensureLinesExist(this.lines.length);
       
       // Add new DOM nodes
       newLines.forEach(() => this.nodes.push(this.createNode()));
       
       this.updatePosition();
    }

    show(text) {
      this.hide(false);
      this.lines = text.replace(/\r/g, "").split("\n");
      this.lineIndex = 0;
      this.colConsumed = 0;
      this.isMismatch = false;
      this.lockedPosition = this.editor.getPosition();
      this.anchorPosition = this.lockedPosition;
      this.computeIndent();
      this.ensureLinesExist(this.lines.length);
      this.editor.setPosition(this.lockedPosition);
      this.editor.focus();
      this.lines.forEach(() => this.nodes.push(this.createNode()));
      this.updatePosition();
    }

    hide(restoreCaret = true) {
      this.nodes.forEach(n => n.remove());
      this.nodes = [];
      this.lines = [];
      this.lineIndex = 0;
      this.colConsumed = 0;
      this.isMismatch = false;
      this.anchorPosition = null;
      this.lockedPosition = null;
      this.indentText = "";
      if (window.ghostEnabled) window.ghostEnabled = false;
    }

    accept() {
      if (!this.anchorPosition) return;
      const rawRemainingLines = this.lines.slice(this.lineIndex);
      const cleanLines = rawRemainingLines.map(line => this.stripComment(line));
      const fullCleanText = cleanLines.join("\n");
      const textToInsert = fullCleanText.slice(this.colConsumed);

      if (textToInsert) {
        this.editor.trigger('keyboard', 'type', { text: textToInsert });
      }
      this.hide();
    }

    updatePosition() {
      if (!this.anchorPosition) return;

      const cursorPosition = this.editor.getPosition();
      const cursorCoords = this.editor.getScrolledVisiblePosition(cursorPosition);
      const startOfLine = this.editor.getScrolledVisiblePosition({
        lineNumber: this.anchorPosition.lineNumber + this.lineIndex,
        column: 1
      });

      if (!cursorCoords || !startOfLine) return;

      this.nodes.forEach((node, i) => {
        if (i < this.lineIndex) {
          node.textContent = "";
          return;
        }

        const lineText = this.lines[i] ?? "";
        const codeOnly = this.stripComment(lineText);
        
        // Vanishing Trick
        if (i === this.lineIndex) {
            if (this.colConsumed >= codeOnly.length && !this.isMismatch) {
                 node.textContent = ""; 
                 return;
            }
        }

        const visibleText = i === this.lineIndex ? lineText.slice(this.colConsumed) : lineText;
        node.textContent = visibleText;

        if (this.isMismatch) {
            node.style.color = "#ef1818"; 
            node.style.textDecoration = "line-through";
            node.style.opacity = "0.8";
        } else {
            node.style.color = "#ff9c50"; 
            node.style.textDecoration = "none";
            node.style.opacity = "1.0";
        }

        const topOffset = (i - this.lineIndex) * this.lineHeight;
        node.style.top = `${cursorCoords.top + topOffset}px`;

        if (i === this.lineIndex) {
           node.style.left = `${cursorCoords.left}px`;
        } else {
           const left = startOfLine.left + (this.colConsumed * this.charWidth);
           node.style.left = `${left}px`;
        }
      });
    }

    onType() {
      if (!this.lines.length) return;

      const pos = this.editor.getPosition();
      const expectedLine = this.lockedPosition.lineNumber + this.lineIndex;

      if (pos.lineNumber > expectedLine) {
        this.lineIndex++;
        this.colConsumed = 0;
        this.isMismatch = false; 
        this.updatePosition();
        return;
      }

      if (pos.lineNumber < expectedLine) {
        this.hide();
        return;
      }

      const lineText = model.getLineContent(pos.lineNumber);
      const baseColumn = this.lineIndex === 0 ? this.lockedPosition.column - 1 : 0;
      const typed = lineText.slice(baseColumn, pos.column - 1);
      const ghostLine = this.lines[this.lineIndex] ?? "";
      const codePart = this.stripComment(ghostLine);

      let i = 0;
      while (i < typed.length && i < codePart.length && typed[i] === codePart[i]) {
        i++;
      }

      this.colConsumed = i;

      if (typed.length > i) {
        this.isMismatch = true;
      } else {
        this.isMismatch = false;
      }

      this.updatePosition();
    }
  }

  const ghost = new InlineGhost(editor);
  window.ghostEnabled = false;

  // --- REUSABLE FETCH FUNCTION ---
  async function fetchGhostText(currentCode, currentCursor) {
     const problem = document.getElementById("intent").value; 
     try {
        const res = await fetch("http://localhost:3000/suggest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            problem,
            language: "python",
            code: currentCode,
            cursor: currentCursor
          })
        });
        const data = await res.json();
        return data.ghost && data.ghost.trim() ? data.ghost : null;
     } catch (e) {
        console.error(e);
        return null;
     }
  }

  // --- TRIGGER: CTRL + SPACE ---
  async function toggleGhost() {
    if (window.ghostEnabled) {
      ghost.hide(true);
      window.ghostEnabled = false;
      return;
    }
    
    // Standard Request: Send current editor state
    const text = await fetchGhostText(editor.getValue(), editor.getPosition());
    if (text) {
       ghost.show(text);
       window.ghostEnabled = true;
    }
  }

  // --- TRIGGER: F8 (EXTEND) ---
  async function extendGhost() {
     if (!window.ghostEnabled || !ghost.lines.length) return;

     // 1. Construct "Projected" Code
     // We assume the ghost text is appended at the cursor.
     // (Simplification: just appending text to EOF or current block)
     const originalCode = editor.getValue();
     const ghostText = ghost.lines.join("\n");
     
     // NOTE: A robust implementation would insert ghostText exactly at cursor index.
     // For now, we append it to the context sent to LLM to simulate it being there.
     const combinedCode = originalCode + "\n" + ghostText;
     
     // 2. Calculate "Projected" Cursor
     // We tell the LLM the cursor is at the END of the ghost text
     const lines = combinedCode.split("\n");
     const lastLineIndex = lines.length;
     const lastLineLength = lines[lines.length - 1].length + 1;
     
     const projectedCursor = { lineNumber: lastLineIndex, column: lastLineLength };

     // 3. Fetch Next Part
     const nextPart = await fetchGhostText(combinedCode, projectedCursor);
     
     // 4. Append
     if (nextPart) {
         ghost.append("\n" + nextPart); // Add newline separation
     }
  }

  // COMMANDS
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Space, toggleGhost);
  
  // F8 Keybinding
  editor.addCommand(monaco.KeyCode.F8, extendGhost);

  editor.addCommand(monaco.KeyCode.Tab, function () {
    if (window.ghostEnabled && ghost.anchorPosition) {
      ghost.accept();
    } else {
      editor.trigger('keyboard', 'tab', null);
    }
  });

  editor.addCommand(monaco.KeyCode.Escape, function () {
    if (window.ghostEnabled && ghost.anchorPosition) {
      ghost.hide();
      window.ghostEnabled = false;
    }
  });

  editor.onDidChangeModelContent((e) => {
    if (window.ghostEnabled && ghost.anchorPosition && !e.isFlush) {
       ghost.onType();
    }
  });

  editor.onDidScrollChange(() => {
    if (window.ghostEnabled) ghost.updatePosition();
  });

});