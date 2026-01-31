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
      fontSize: 16,
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
  const tabSize =
    editor.getOption(monaco.editor.EditorOption.tabSize) || 4;

  // =====================================================
  // INLINE GHOST (MULTILINE + INDENT + CONSUMPTION)
  // =====================================================

  class InlineGhost {
    constructor(editor) {
      this.editor = editor;

      this.lines = [];
      this.lineIndex = 0;
      this.colConsumed = 0;

      this.anchorPosition = null;
      this.lockedPosition = null;
      this.nodes = [];
      this.indentText = "";

      const fontInfo = editor.getOption(
        monaco.editor.EditorOption.fontInfo
      );

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
      this.editor.getDomNode().appendChild(node);
      return node;
    }

    computeIndent() {
      const lineText =
        model.getLineContent(this.lockedPosition.lineNumber);

      const leading =
        lineText.match(/^\s*/)?.[0] ?? "";

      const needsBlockIndent =
        lineText.trimEnd().endsWith(":");

      this.indentText =
        leading + (needsBlockIndent ? " ".repeat(tabSize) : "");
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

      this.lockedPosition = this.editor.getPosition();
      this.anchorPosition = this.lockedPosition;

      this.computeIndent();
      this.ensureLinesExist(this.lines.length);

      this.lines.forEach(() => {
        this.nodes.push(this.createNode());
      });

      this.updatePosition();
    }

    hide(restoreCaret = true) {
      this.nodes.forEach(n => n.remove());
      this.nodes = [];

      if (restoreCaret && this.lockedPosition) {
        const line =
          this.lockedPosition.lineNumber + this.lineIndex;

        const column =
          (this.lineIndex === 0
            ? this.lockedPosition.column
            : this.indentText.length + 1) +
          this.colConsumed;

        this.editor.setPosition({ lineNumber: line, column });
        this.editor.focus();
      }

      this.lines = [];
      this.lineIndex = 0;
      this.colConsumed = 0;
      this.anchorPosition = null;
      this.lockedPosition = null;
      this.indentText = "";
    }

    updatePosition() {
      if (!this.anchorPosition) return;

      const base =
        this.editor.getScrolledVisiblePosition(this.anchorPosition);
      if (!base) return;

      this.nodes.forEach((node, i) => {
        if (i < this.lineIndex) {
          node.textContent = "";
          return;
        }

        const lineText = this.lines[i] ?? "";
        const visibleText =
          i === this.lineIndex
            ? lineText.slice(this.colConsumed)
            : lineText;

        const prefix =
          i === 0 ? "" : this.indentText;

        node.textContent = prefix + visibleText;

        node.style.top =
          `${base.top + i * this.lineHeight}px`;

        const leftOffset =
          i === this.lineIndex
            ? (i === 0
                ? this.colConsumed
                : this.indentText.length + this.colConsumed)
            : this.indentText.length;

        node.style.left =
          `${base.left + leftOffset * this.charWidth}px`;
      });
    }

    onType() {
      if (!this.lines.length) return;

      const pos = this.editor.getPosition();
      const expectedLine =
        this.lockedPosition.lineNumber + this.lineIndex;

      const lineText =
        model.getLineContent(pos.lineNumber);

      // 🔴 DO NOT advance line here anymore
      if (pos.lineNumber !== expectedLine) return;

      const baseColumn =
        this.lineIndex === 0
          ? this.lockedPosition.column - 1
          : this.indentText.length;

      const typed =
        lineText.slice(baseColumn, pos.column - 1);

      const ghostLine =
        this.lines[this.lineIndex] ?? "";

      let i = this.colConsumed;
      while (
        i < ghostLine.length &&
        typed === ghostLine.slice(0, i + 1)
      ) {
        i++;
      }

      this.colConsumed = i;
      this.updatePosition();
    }

    // =====================================================
    // 🔥 NEW: CONTROL ENTER (THIS IS THE FIX)
    // =====================================================
    handleEnter() {
      if (!this.lines.length) return false;

      const pos = this.editor.getPosition();

      model.applyEdits([
        {
          range: new monaco.Range(
            pos.lineNumber,
            pos.column,
            pos.lineNumber,
            pos.column
          ),
          text: "\n" + this.indentText,
          forceMoveMarkers: true
        }
      ]);

      this.lineIndex++;
      this.colConsumed = 0;

      this.updatePosition();
      return true;
    }
  }

  const ghost = new InlineGhost(editor);
  let ghostEnabled = false;

  // =====================================================
  // CTRL + SPACE TOGGLE
  // =====================================================

  async function toggleGhost() {
    if (ghostEnabled) {
      ghost.hide(true);
      ghostEnabled = false;
      return;
    }

    const pos = editor.getPosition();
    const code = editor.getValue();
    const problem =
      document.getElementById("intent").value;

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
      ghostEnabled = true;
    }
  }

  editor.addCommand(
    monaco.KeyMod.CtrlCmd | monaco.KeyCode.Space,
    toggleGhost
  );

  // =====================================================
  // 🔥 ENTER OVERRIDE (CRITICAL)
  // =====================================================
  editor.addCommand(
    monaco.KeyCode.Enter,
    () => {
      if (ghostEnabled && ghost.handleEnter()) return;
      editor.trigger("keyboard", "type", { text: "\n" });
    }
  );

  editor.onDidChangeModelContent(() => {
    if (ghostEnabled) ghost.onType();
  });

  editor.onDidScrollChange(() => {
    if (ghostEnabled) ghost.updatePosition();
  });

});
