"use client";

import { FormEvent, KeyboardEvent, useState } from "react";

type ChatComposerProperties = {
  disabled: boolean;
  onSubmit: (content: string) => void;
};

export function ChatComposer({ disabled, onSubmit }: ChatComposerProperties) {
  const [content, setContent] = useState("");

  function submitMessage(): void {
    const trimmedContent = content.trim();

    if (trimmedContent.length === 0 || disabled) {
      return;
    }

    onSubmit(trimmedContent);
    setContent("");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    submitMessage();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitMessage();
    }
  }

  return (
    <form className="chat-composer" onSubmit={handleSubmit}>
      <label className="sr-only" htmlFor="chat-message">
        Message
      </label>
      <textarea
        disabled={disabled}
        id="chat-message"
        name="message"
        onChange={(event) => setContent(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask about products, budgets, or categories"
        rows={3}
        value={content}
      />
      <button disabled={disabled || content.trim().length === 0} type="submit">
        Send
      </button>
    </form>
  );
}
