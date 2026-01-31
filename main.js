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

  // =====================================================
  // INLINE GHOST CLASS
  // =====================================================

  class InlineGhost {
    constructor(editor) {
      this.editor = editor;

      this.lines = [];
      this.lineIndex = 0;
      this.colConsumed = 0;
      this.isMismatch = false; // Track if user typed something wrong

      this.anchorPosition = null;
      this.lockedPosition = null;
      this.nodes = [];
      this.indentText = "";

      const fontInfo = editor.getOption(monaco.editor.EditorOption.fontInfo);

      this.fontInfo = fontInfo;
      this.charWidth = fontInfo.typicalHalfwidthCharacterWidth;
      this.lineHeight = fontInfo.lineHeight;
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
      node.style.zIndex = "10"; // Ensure it sits above text
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

      model.applyEdits([
        {
          range: new monaco.Range(
            insertAt,
            model.getLineMaxColumn(insertAt),
            insertAt,
            model.getLineMaxColumn(insertAt)
          ),
          text: "\n".repeat(needed),
          forceMoveMarkers: true
        }
      ]);
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

      this.lines.forEach(() => {
        this.nodes.push(this.createNode());
      });

      this.updatePosition();
    }

    hide(restoreCaret = true) {
      this.nodes.forEach(n => n.remove());
      this.nodes = [];

      if (restoreCaret && this.lockedPosition) {
        // Optional: logic to restore caret if needed, 
        // typically we just leave it where the user typed.
      }

      this.lines = [];
      this.lineIndex = 0;
      this.colConsumed = 0;
      this.isMismatch = false;
      this.anchorPosition = null;
      this.lockedPosition = null;
      this.indentText = "";
      
      // Update external state tracking if necessary
      if (window.ghostEnabled) window.ghostEnabled = false;
    }

    // --- NEW: ACCEPT METHOD ---
    accept() {
      if (!this.anchorPosition) return;

      // Construct the text to insert
      // We take all remaining lines from the current lineIndex
      // And slice the first line by what we have already consumed
      const textToInsert = this.lines
        .slice(this.lineIndex)
        .join("\n")
        .slice(this.colConsumed);

      if (textToInsert) {
        this.editor.trigger('keyboard', 'type', { text: textToInsert });
      }
      
      this.hide();
    }

    updatePosition() {
      if (!this.anchorPosition) return;

      // 1. Get exact coordinates of the user's current cursor
      // We use this to anchor the active line so it flows naturally
      const cursorPosition = this.editor.getPosition();
      const cursorCoords = this.editor.getScrolledVisiblePosition(cursorPosition);

      // 2. Get the coordinates of Column 1 for the current ghost line
      // We use this to anchor subsequent lines to preserve indentation
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
        
        // Slice the ghost text based on what the user has typed
        const visibleText =
          i === this.lineIndex
            ? lineText.slice(this.colConsumed)
            : lineText;

        node.textContent = visibleText;

        // --- STYLING (Mismatch vs Normal) ---
        if (this.isMismatch) {
            node.style.color = "#ef1818"; // Red
            node.style.textDecoration = "line-through";
            node.style.opacity = "0.8";
        } else {
            node.style.color = "#ff9c50"; // Grey
            node.style.textDecoration = "none";
            node.style.opacity = "1.0";
        }

        // --- POSITIONING ---
        // Vertical
        const topOffset = (i - this.lineIndex) * this.lineHeight;
        node.style.top = `${cursorCoords.top + topOffset}px`;

        // Horizontal
        if (i === this.lineIndex) {
           // Active Line: Position exactly after the cursor
           node.style.left = `${cursorCoords.left}px`;
        } else {
           // Subsequent Lines: Position based on Column 1 to match indentation
           // We add indentation text length * char width if strictly needed,
           // but normally indentation is part of the string in 'lines'.
           
           // However, since we used 'computeIndent' to pad the text visually 
           // in the previous logic, we rely on 'startOfLine'.
           // But remember: 'startOfLine' is Column 1. 
           // If 'lines[i]' has spaces, they will render from Column 1.
           
           // Correct logic using your previous fix:
           // If we are consuming characters on subsequent lines (rare, usually 0),
           // we shift right.
           const left = startOfLine.left + (this.colConsumed * this.charWidth);
           node.style.left = `${left}px`;
        }
      });
    }

    onType() {
      if (!this.lines.length) return;

      const pos = this.editor.getPosition();
      const expectedLine = this.lockedPosition.lineNumber + this.lineIndex;

      // 1. Detect ENTER → move to next ghost line
      if (pos.lineNumber > expectedLine) {
        this.lineIndex++;
        this.colConsumed = 0;
        this.isMismatch = false; // Reset mismatch on new line
        this.updatePosition();
        return;
      }

      // 2. Detect Cursor moved away → hide
      if (pos.lineNumber < expectedLine) {
        this.hide();
        return;
      }

      const lineText = model.getLineContent(pos.lineNumber);

      // Determine where the user started typing on this specific line
      const baseColumn =
        this.lineIndex === 0
          ? this.lockedPosition.column - 1
          : 0;

      // Extract what the user has typed
      const typed = lineText.slice(baseColumn, pos.column - 1);
      const ghostLine = this.lines[this.lineIndex] ?? "";

      // 3. Calculate Overlap
      let i = 0;
      while (
        i < typed.length &&
        i < ghostLine.length &&
        typed[i] === ghostLine[i]
      ) {
        i++;
      }

      // The consumption is the matching part
      this.colConsumed = i;

      // 4. Check for Mismatch
      // If user typed more characters than matched the ghost, it's a mismatch.
      if (typed.length > i) {
        this.isMismatch = true;
      } else {
        this.isMismatch = false;
      }

      this.updatePosition();
    }
  }

  const ghost = new InlineGhost(editor);
  // Expose ghostEnabled to window to track state if needed, 
  // or just use a local variable managed by toggleGhost
  window.ghostEnabled = false;

  // =====================================================
  // CTRL + SPACE TOGGLE
  // =====================================================

  async function toggleGhost() {
    if (window.ghostEnabled) {
      ghost.hide(true);
      window.ghostEnabled = false;
      return;
    }

    const pos = editor.getPosition();
    const code = editor.getValue();
    const problem = document.getElementById("intent").value; // Ensure this element exists in your HTML

    try {
        const res = await fetch("http://localhost:3000/suggest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            problem,
            language: "python",
            code,
            cursor: pos
          })
        });

        const data = await res.json();

        if (data.ghost && data.ghost.trim()) {
          ghost.show(data.ghost);
          window.ghostEnabled = true;
        }
    } catch (e) {
        console.error("Failed to fetch suggestion", e);
    }
  }

  editor.addCommand(
    monaco.KeyMod.CtrlCmd | monaco.KeyCode.Space,
    toggleGhost
  );

  // =====================================================
  // NEW KEYBINDINGS: TAB & ESCAPE
  // =====================================================

  // TAB: Accept Suggestion
  editor.addCommand(monaco.KeyCode.Tab, function () {
    if (window.ghostEnabled && ghost.anchorPosition) {
      ghost.accept();
    } else {
      // Pass Tab to default handler (indentation)
      editor.trigger('keyboard', 'tab', null);
    }
  });

  // ESCAPE: Reject Suggestion
  editor.addCommand(monaco.KeyCode.Escape, function () {
    if (window.ghostEnabled && ghost.anchorPosition) {
      ghost.hide();
      window.ghostEnabled = false;
    }
  });

  // =====================================================
  // EVENT LISTENERS
  // =====================================================

  editor.onDidChangeModelContent((e) => {
    // Check if we have a ghost active
    if (window.ghostEnabled && ghost.anchorPosition) {
       // Avoid running onType during the acceptance flush
       if (!e.isFlush) {
           ghost.onType();
       }
    }
  });

  editor.onDidScrollChange(() => {
    if (window.ghostEnabled) ghost.updatePosition();
  });

});