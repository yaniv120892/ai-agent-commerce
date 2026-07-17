"use client";

import { FormEvent, useState } from "react";

type ChatComposerProperties = {
  disabled: boolean;
  onSubmit: (content: string) => void;
};

export function ChatComposer({ disabled, onSubmit }: ChatComposerProperties) {
  const [content, setContent] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    const trimmedContent = content.trim();

    if (trimmedContent.length === 0 || disabled) {
      return;
    }

    onSubmit(trimmedContent);
    setContent("");
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
