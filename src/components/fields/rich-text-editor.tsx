"use client";

import { useState } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Markdown } from "tiptap-markdown";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useMessages } from "@/i18n/client";
import type { Messages } from "@/i18n/en-US";

/** tiptap-markdown adds this to editor.storage but ships no module augmentation. */
type MarkdownStorage = { markdown: { getMarkdown: () => string } };

type Mode = "markdown" | "richtext";
type View = "visual" | "source";

type Labels = Messages["documents"]["richText"];

type Tool = {
  key: keyof Labels;
  label: string;
  /** What `isActive` is asked about to light the button up. */
  mark: string;
  run: (editor: Editor) => void;
};

const TOOLS: readonly Tool[] = [
  { key: "bold", label: "B", mark: "bold", run: (e) => e.chain().focus().toggleBold().run() },
  { key: "italic", label: "I", mark: "italic", run: (e) => e.chain().focus().toggleItalic().run() },
  { key: "heading", label: "H2", mark: "heading", run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { key: "quote", label: "“”", mark: "blockquote", run: (e) => e.chain().focus().toggleBlockquote().run() },
  { key: "bulletList", label: "• List", mark: "bulletList", run: (e) => e.chain().focus().toggleBulletList().run() },
  { key: "numberedList", label: "1. List", mark: "orderedList", run: (e) => e.chain().focus().toggleOrderedList().run() },
  { key: "taskList", label: "☑ List", mark: "taskList", run: (e) => e.chain().focus().toggleTaskList().run() },
  { key: "codeBlock", label: "</>", mark: "codeBlock", run: (e) => e.chain().focus().toggleCodeBlock().run() },
  {
    key: "table",
    label: "▦ Table",
    mark: "table",
    run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
];

/** Shown only while the cursor is inside a table. */
const TABLE_TOOLS: readonly { key: keyof Labels; run: (editor: Editor) => void }[] = [
  { key: "addRow", run: (e) => e.chain().focus().addRowAfter().run() },
  { key: "addColumn", run: (e) => e.chain().focus().addColumnAfter().run() },
  { key: "deleteRow", run: (e) => e.chain().focus().deleteRow().run() },
  { key: "deleteColumn", run: (e) => e.chain().focus().deleteColumn().run() },
  { key: "deleteTable", run: (e) => e.chain().focus().deleteTable().run() },
];

/**
 * One editor for both markdown and rich text fields, as the stack table asks.
 * The value travels in a hidden input so the form still works as a plain POST:
 * markdown fields serialize to markdown source, richtext fields to HTML that the
 * server sanitizes again on write.
 *
 * Text pasted in is read as Markdown, so a `.md` file pasted whole keeps its
 * headings, lists, tables, and checklists instead of arriving as literal `#`
 * and `|` characters. Shift+paste keeps it plain. A markdown field also offers
 * the source itself, for people who would rather write or paste it as text.
 */
export function RichTextEditor({
  name,
  mode,
  value,
  onChange,
  ariaLabelledBy,
}: {
  name: string;
  mode: Mode;
  /** Controlled by the form so structural edits never discard it. */
  value: string;
  onChange: (next: string) => void;
  ariaLabelledBy?: string;
}) {
  const t = useMessages();
  const labels = t.documents.richText;
  const [view, setView] = useState<View>("visual");

  const editor = useEditor({
    // Rendering on the server would not match the client's ProseMirror output.
    immediatelyRender: false,
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: false } }),
      Markdown.configure({
        html: mode === "richtext",
        transformPastedText: true,
        transformCopiedText: mode === "markdown",
      }),
    ],
    // Seeded once; the editor owns the document from then on.
    content: value,
    editorProps: {
      attributes: {
        class: "prose-editor min-h-40 w-full px-3 py-2 outline-none",
        ...(ariaLabelledBy ? { "aria-labelledby": ariaLabelledBy } : {}),
      },
    },
    onUpdate: ({ editor: instance }) => {
      // An empty document still serializes to "<p></p>"; store a blank instead.
      if (instance.isEmpty) {
        onChange("");
        return;
      }
      onChange(
        mode === "markdown"
          ? (instance.storage as unknown as MarkdownStorage).markdown.getMarkdown()
          : instance.getHTML(),
      );
    },
  });

  // Button states follow the selection; the editor itself does not re-render
  // this component on every keystroke.
  const active = useEditorState({
    editor,
    selector: ({ editor: instance }) => ({
      marks: TOOLS.map((tool) => (instance ? instance.isActive(tool.mark) : false)),
      inTable: instance ? instance.isActive("table") : false,
    }),
  });

  function show(next: View) {
    if (next === view) return;
    if (next === "visual" && editor) {
      // The source may have changed; the visual view starts from it again.
      // tiptap-markdown's setContent takes Markdown, so the source goes in as is.
      editor.commands.setContent(value);
    }
    setView(next);
  }

  const sourceShown = mode === "markdown" && view === "source";

  return (
    <div className="rounded-md border focus-within:ring-2 focus-within:ring-[var(--ring)]">
      <div className="flex flex-wrap items-center gap-1 border-b p-1">
        {!sourceShown &&
          TOOLS.map((tool, index) => (
            <button
              key={tool.key}
              type="button"
              title={labels[tool.key]}
              aria-label={labels[tool.key]}
              aria-pressed={active?.marks[index] ?? false}
              onClick={() => editor && tool.run(editor)}
              className={cn(
                "rounded px-2 py-1 text-xs font-medium hover:bg-[var(--muted)]",
                active?.marks[index] && "bg-[var(--muted)]",
              )}
            >
              {tool.label}
            </button>
          ))}
        {!sourceShown && active?.inTable && (
          <span className="flex flex-wrap items-center gap-1 border-l pl-1" role="group" aria-label={labels.table}>
            {TABLE_TOOLS.map((tool) => (
              <button
                key={tool.key}
                type="button"
                onClick={() => editor && tool.run(editor)}
                className="rounded px-2 py-1 text-xs hover:bg-[var(--muted)]"
              >
                {labels[tool.key]}
              </button>
            ))}
          </span>
        )}
        {mode === "markdown" && (
          <span
            role="group"
            aria-label={labels.view}
            className="ml-auto flex items-center gap-0.5 rounded-md border p-0.5 text-xs"
          >
            {(["visual", "source"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={view === option}
                onClick={() => show(option)}
                className={cn(
                  "rounded px-2 py-0.5 font-medium hover:bg-[var(--muted)]",
                  view === option && "bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-[var(--primary)]",
                )}
              >
                {labels[option]}
              </button>
            ))}
          </span>
        )}
      </div>
      {/* Stays mounted while the source is shown, so the visual view keeps its state. */}
      <div className={cn(sourceShown && "hidden")}>
        <EditorContent editor={editor} />
      </div>
      {sourceShown && (
        <Textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-labelledby={ariaLabelledBy}
          spellCheck={false}
          className="min-h-40 rounded-none border-0 font-mono text-xs focus-visible:ring-0"
          placeholder={labels.sourceHint}
        />
      )}
      <input type="hidden" name={name} value={value} />
    </div>
  );
}
