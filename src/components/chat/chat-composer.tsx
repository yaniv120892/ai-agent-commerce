"use client";

import { FormEvent, useState } from "react";

import { MESSAGE_CONTENT_MAX_LENGTH } from "@/domain/conversations/constants";

type ChatComposerProperties = {
  disabled: boolean;
  onSubmit: (content: string) => void;
};

export function ChatComposer({ disabled, onSubmit }: ChatComposerProperties) {
  const [content, setContent] = useState("");
  const isOverLimit = content.length > MESSAGE_CONTENT_MAX_LENGTH;

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    const trimmedContent = content.trim();

    if (
      trimmedContent.length === 0 ||
      trimmedContent.length > MESSAGE_CONTENT_MAX_LENGTH ||
      disabled
    ) {
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
        maxLength={MESSAGE_CONTENT_MAX_LENGTH}
        name="message"
        onChange={(event) => setContent(event.target.value)}
        placeholder="Ask about products, budgets, or categories"
        rows={3}
        value={content}
      />
      <div className="chat-composer__footer">
        <span
          className={`chat-composer__counter${isOverLimit ? " chat-composer__counter--over" : ""}`}
        >
          {content.length.toLocaleString("en-US")}/
          {MESSAGE_CONTENT_MAX_LENGTH.toLocaleString("en-US")}
        </span>
        <button
          disabled={disabled || content.trim().length === 0 || isOverLimit}
          type="submit"
        >
          Send
        </button>
      </div>
    </form>
  );
}
