import { AppWindow, SquareCode } from "lucide-react";
import type { ReactNode } from "react";
import type { EditorId } from "../lib/editors";

type EditorIconProps = {
  id: string;
  editor: EditorId;
};

export function EditorIcon({ id, editor }: EditorIconProps) {
  if (editor === "code" || editor === "code-insiders") {
    return <VsCodeIcon id={id} />;
  }
  if (editor === "cursor") {
    return <CursorIcon id={id} />;
  }
  if (editor === "default") {
    return <AppWindow id={id} className="size-3.5 shrink-0" aria-hidden="true" />;
  }
  return <SquareCode id={id} className="size-3.5 shrink-0" aria-hidden="true" />;
}

function MenuGlyph({ id, children }: { id: string; children: ReactNode }) {
  return (
    <svg id={id} viewBox="0 0 24 24" className="size-3.5 shrink-0" aria-hidden="true">
      {children}
    </svg>
  );
}

function VsCodeIcon({ id }: { id: string }) {
  return (
    <MenuGlyph id={id}>
      <path id={`${id}-ribbon`} fill="#23a8f2" d="M17.2 2.4 9.7 8.5 5.5 5.6 2.8 6.9v10.2l2.7 1.3 4.2-2.9 7.5 6.1 3.3-1.6V4l-3.3-1.6Zm.1 3.7v11.8l-5.6-4.5 5.6-7.3Z" />
      <path id={`${id}-fold`} fill="#0078d4" d="M2.8 6.9 9.7 12l-6.9 5.1V6.9Z" />
    </MenuGlyph>
  );
}

function CursorIcon({ id }: { id: string }) {
  return (
    <MenuGlyph id={id}>
      <path id={`${id}-mark`} fill="currentColor" d="M5.2 3.2 19.4 12.1 11.8 13.4 9.3 20.8 5.2 3.2Z" />
    </MenuGlyph>
  );
}
