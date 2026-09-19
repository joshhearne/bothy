"use client";

import { useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";

/** tiptap-markdown adds this to editor.storage but ships no module augmentation. */
type MarkdownStorage = { markdown: { getMarkdown: () => string } };
import { cn } from "@/lib/utils";

type Mode = "markdown" | "richtext";

const TOOLBAR = [
  { label: "B", title: "Bold", mark: "bold", run: (e: Editor) => e.chain().focus().toggleBold().run() },
  { label: "I", title: "Italic", mark: "italic", run: (e: Editor) => e.chain().focus().toggleItalic().run() },
  { label: "H2", title: "Heading", mark: "heading", run: (e: Editor) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { label: "“”", title: "Quote", mark: "blockquote", run: (e: Editor) => e.chain().focus().toggleBlockquote().run() },
  { label: "• List", title: "Bullet list", mark: "bulletList", run: (e: Editor) => e.chain().focus().toggleBulletList().run() },
  { label: "1. List", title: "Numbered list", mark: "orderedList", run: (e: Editor) => e.chain().focus().toggleOrderedList().run() },
  { label: "</>", title: "Code block", mark: "codeBlock", run: (e: Editor) => e.chain().focus().toggleCodeBlock().run() },
] as const;

/**
 * One editor for both markdown and rich text fields, as the stack table asks.
 * The value travels in a hidden input so the form still works as a plain POST:
 * markdown fields serialize to markdown source, richtext fields to HTML that the
 * server sanitizes again on write.
 */
export function RichTextEditor({
  name,
  mode,
  defaultValue = "",
  ariaLabelledBy,
}: {
  name: string;
  mode: Mode;
  defaultValue?: string;
  ariaLabelledBy?: string;
}) {
  const [value, setValue] = useState(defaultValue);

  const editor = useEditor({
    // Rendering on the server would not match the client's ProseMirror output.
    immediatelyRender: false,
    extensions: [StarterKit, Markdown.configure({ html: mode === "richtext" })],
    content: defaultValue,
    editorProps: {
      attributes: {
        class: "prose-editor min-h-40 w-full px-3 py-2 outline-none",
        ...(ariaLabelledBy ? { "aria-labelledby": ariaLabelledBy } : {}),
      },
    },
    onUpdate: ({ editor: instance }) => {
      // An empty document still serializes to "<p></p>"; store a blank instead.
      if (instance.isEmpty) {
        setValue("");
        return;
      }
      setValue(
        mode === "markdown"
          ? (instance.storage as unknown as MarkdownStorage).markdown.getMarkdown()
          : instance.getHTML(),
      );
    },
  });

  return (
    <div className="rounded-md border focus-within:ring-2 focus-within:ring-[var(--ring)]">
      <div className="flex flex-wrap gap-1 border-b p-1">
        {TOOLBAR.map((item) => (
          <button
            key={item.label}
            type="button"
            title={item.title}
            aria-pressed={editor?.isActive(item.mark) ?? false}
            onClick={() => editor && item.run(editor)}
            className={cn(
              "rounded px-2 py-1 text-xs font-medium hover:bg-[var(--muted)]",
              editor?.isActive(item.mark) && "bg-[var(--muted)]",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      <EditorContent editor={editor} />
      <input type="hidden" name={name} value={value} />
    </div>
  );
}
